/**
 * Reusable test app factory that mirrors the production `createApp()` middleware
 * stack exactly — so integration tests exercise the same request pipeline that
 * runs in production (errorMiddleware + ipRateLimitMiddleware + bodyParser +
 * csrfMiddleware + idempotencyMiddleware + routes).
 *
 * Individual test suites can still build narrower Koa apps when they want to
 * test a middleware layer in isolation, but the default should be this factory
 * so routes-level defects in middleware interaction don't slip through.
 */
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { errorMiddleware } from '../../src/errors/middleware';
import { csrfMiddleware } from '../../src/middleware/csrf';
import { ipRateLimitMiddleware } from '../../src/middleware/ipRateLimit';
import { idempotencyMiddleware } from '../../src/middleware/idempotency';
import { mountRoutes } from '../../src/routes';

export interface CreateProductionTestAppOptions {
  /** Skip CSRF middleware for tests that don't send tokens. Default: false. */
  skipCsrf?: boolean;
  /** Skip the IP rate-limit middleware (useful to avoid cross-test counter leakage). Default: false. */
  skipIpRateLimit?: boolean;
  /** Skip the idempotency-key middleware. Default: false. */
  skipIdempotency?: boolean;
}

/**
 * Construct a Koa app with the full production middleware stack.
 * Prefer this factory over hand-rolled per-suite apps so tests remain
 * representative of production request handling.
 *
 * The `skip*` options are retained only for the narrow cases where a suite
 * intentionally isolates a single middleware layer (e.g., pure nonce/lockout
 * unit tests). New suites should default to the full stack — pair with
 * `authedRequest` / `freshIdempotencyKey` below and `clearAllRateLimits()`
 * in `beforeEach` so the shared counter store does not bleed across tests.
 */
export function createProductionTestApp(options: CreateProductionTestAppOptions = {}): Koa {
  const app = new Koa();
  app.use(errorMiddleware());
  if (!options.skipIpRateLimit) app.use(ipRateLimitMiddleware());
  app.use(bodyParser());
  if (!options.skipCsrf) app.use(csrfMiddleware());
  if (!options.skipIdempotency) app.use(idempotencyMiddleware());
  mountRoutes(app);
  return app;
}

/**
 * Generate a fresh UUIDv4 Idempotency-Key. The production idempotency
 * middleware rejects non-UUIDv4 keys, so every mutating supertest call must
 * use this (or uuidv4() directly).
 */
export function freshIdempotencyKey(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { v4 } = require('uuid') as { v4: () => string };
  return v4();
}

/**
 * Fetch a CSRF token scoped to the provided access token's jti.
 *
 * Under the full middleware stack, any authenticated GET to `/api/…` causes
 * `csrfMiddleware` to emit `X-CSRF-Token` as a response header *before*
 * the handler runs — so the header is present regardless of whether the
 * downstream handler returns 200, 403 (consent), or 404 (no such route).
 *
 * We probe `/api/v1/auth/nonce/publish` because it requires `requireAuth()`
 * but NOT `requireConsent()` — that lets suites that haven't seeded a
 * consent record still grab a CSRF token. A successful nonce response is
 * a harmless side-effect for the helper's caller.
 */
export async function getCsrfToken(app: Koa, accessToken: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const supertest = require('supertest') as typeof import('supertest');
  const res = await supertest(app.callback())
    .get('/api/v1/auth/nonce/publish')
    .set('Authorization', `Bearer ${accessToken}`);
  const token = res.headers['x-csrf-token'];
  if (!token || typeof token !== 'string') {
    throw new Error(
      `Expected X-CSRF-Token in response headers; got status ${res.status} and no token. ` +
        'Is the access token still valid?',
    );
  }
  return token;
}

/**
 * Clear all in-memory rate-limit counters. Call in `beforeEach` when the
 * suite runs under the full stack — the counter store is process-global so
 * tests otherwise bleed into each other and random 429s appear.
 */
export function clearRateLimitStore(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../../src/services/rateLimit') as {
    clearAllRateLimits?: () => void;
  };
  mod.clearAllRateLimits?.();
}
