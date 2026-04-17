import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import Koa from 'koa';
import { AppError, ErrorCodes } from '../errors';
import { config } from '../config';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Routes to skip CSRF (pre-auth endpoints)
const CSRF_SKIP_PATHS = [
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
];

/**
 * Extract jti from Bearer token without throwing on invalid/expired tokens.
 * Returns null if no valid Bearer token is present.
 */
function extractJtiFromBearer(ctx: Koa.Context): string | null {
  const authHeader = ctx.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] }) as { jti?: string };
    return decoded.jti ?? null;
  } catch {
    return null;
  }
}

export function generateCsrfToken(jti: string): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return crypto
    .createHmac('sha256', config.jwt.secret)
    .update(`${jti}:${date}`)
    .digest('hex');
}

function verifyCsrfToken(token: string, jti: string): boolean {
  // Check today and yesterday (to handle day boundaries)
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  for (const date of [today, yesterday]) {
    const dateStr = date.toISOString().slice(0, 10);
    const expected = crypto
      .createHmac('sha256', config.jwt.secret)
      .update(`${jti}:${dateStr}`)
      .digest('hex');
    try {
      if (crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'))) {
        return true;
      }
    } catch {
      // ignore invalid hex
    }
  }
  return false;
}

export function csrfMiddleware(): Koa.Middleware {
  return async (ctx, next) => {
    const path = ctx.path;

    // Skip CSRF for pre-auth paths
    if (CSRF_SKIP_PATHS.some((skip) => path === skip || path.startsWith(skip))) {
      await next();
      return;
    }

    // On GET requests with auth context, set CSRF token header
    if (ctx.method === 'GET' && path.startsWith('/api/')) {
      const jti = ctx.state?.user?.jti ?? extractJtiFromBearer(ctx);
      if (jti) {
        ctx.set('X-CSRF-Token', generateCsrfToken(jti));
      }
      await next();
      return;
    }

    // On mutating requests, verify CSRF token
    if (MUTATING_METHODS.has(ctx.method) && path.startsWith('/api/')) {
      const jti = ctx.state?.user?.jti ?? extractJtiFromBearer(ctx);
      if (!jti) {
        // No Bearer token present — truly unauthenticated request (handled by route-level auth)
        await next();
        return;
      }

      const csrfToken = ctx.get('X-CSRF-Token');
      if (!csrfToken) {
        throw new AppError(ErrorCodes.FORBIDDEN, 'CSRF token missing', 403);
      }

      if (!verifyCsrfToken(csrfToken, jti)) {
        throw new AppError(ErrorCodes.FORBIDDEN, 'CSRF token invalid', 403);
      }
    }

    await next();
  };
}
