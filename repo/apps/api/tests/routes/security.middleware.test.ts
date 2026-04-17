/**
 * Route-level security middleware integration coverage.
 *
 * The major route suites still skip CSRF / Idempotency-Key / IP rate-limit so
 * suite churn stays low. This file is the representative coverage that mirrors
 * production: every test below mounts the full middleware stack (no skips) and
 * exercises the most important mutating endpoints — auth login, listings
 * create, attachments upload, admin purge, and promo create — so that a
 * regression in middleware interaction will be caught before it ships.
 *
 * Per the audit: "Keep isolated middleware tests where useful, but add
 * representative route-level coverage with the security middleware enabled
 * for the most important mutating endpoints."
 */
import supertest from 'supertest';
import Koa from 'koa';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import { hashPassword } from '../../src/services/password';
import { createProductionTestApp } from '../helpers/testApp';
import { InMemoryRepository } from '../../src/storage/repository';

// Replace storage so the attachments POST in this test does not touch disk.
jest.mock('../../src/storage/repository', () => {
  const actual = jest.requireActual('../../src/storage/repository') as {
    InMemoryRepository: unknown;
  };
  const storage = new (actual.InMemoryRepository as new () => InMemoryRepository)();
  (global as Record<string, unknown>).__securityTestStorage = storage;
  return { ...actual, storageRepository: storage };
});

let testKnex: KnexType;

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

beforeAll(async () => {
  testKnex = createTestKnex();
  await runTestMigrations(testKnex);
  setAuditKnex(testKnex);
  setDefaultKnex(testKnex);
});

afterAll(async () => {
  resetAuditKnex();
  resetDefaultKnex();
  await dropTestTables(testKnex);
  await testKnex.destroy();
});

beforeEach(async () => {
  // The IP rate-limit middleware is stateful and process-global; clear the
  // counter store between tests to avoid bleed-through.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { clearAllRateLimits } = require('../../src/services/rateLimit');
  clearAllRateLimits?.();
  await testKnex('idempotency_keys').delete();
  await testKnex('attachments').delete();
  await testKnex('attachment_revisions').delete();
  await testKnex('listing_status_history').delete();
  await testKnex('listing_revisions').delete();
  await testKnex('listings').delete();
  await testKnex('promo_slots').delete();
  await testKnex('promo_collections').delete();
});

/** Full prod stack — NO middleware skipped. This is the whole point of this file. */
function createFullStackApp(): Koa {
  return createProductionTestApp({});
}

async function ensureOffice(officeId = 1): Promise<void> {
  const exists = await testKnex('offices').where({ id: officeId }).first();
  if (!exists) {
    await testKnex('offices').insert({
      id: officeId,
      name: 'Test Office',
      code: `OFF${officeId}`,
      active: 1,
    });
  }
}

async function ensureConsentVersion(): Promise<number> {
  const cv = await testKnex('consent_versions').orderBy('effective_from', 'desc').first();
  if (cv) return cv.id;
  const [id] = await testKnex('consent_versions').insert({
    version: '1.0',
    body_md: 'Test consent',
    effective_from: formatDatetime(new Date('2024-01-01')),
  });
  return id;
}

async function createUser(role: string, officeId = 1): Promise<{ userId: number; username: string; password: string }> {
  await ensureOffice(officeId);
  const username = `sec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'TestPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();

  const [userId] = await testKnex('users').insert({
    username,
    password_hash: hash,
    role,
    office_id: officeId,
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: formatDatetime(now),
    updated_at: formatDatetime(now),
  });

  const cvId = await ensureConsentVersion();
  await testKnex('consent_records').insert({
    user_id: userId,
    consent_version_id: cvId,
    accepted_at: formatDatetime(now),
    ip: '127.0.0.1',
  });

  return { userId: Number(userId), username, password };
}

/** Login via the full prod stack; idempotency required, CSRF skipped on login. */
async function loginFull(app: Koa, username: string, password: string): Promise<string> {
  const nonceRes = await supertest(app.callback()).get('/api/v1/auth/nonce/login');
  expect(nonceRes.status).toBe(200);
  const nonce = nonceRes.body.data.nonce;

  const loginRes = await supertest(app.callback())
    .post('/api/v1/auth/login')
    .set('Idempotency-Key', uuidv4())
    .send({ username, password, nonce });

  expect(loginRes.status).toBe(200);
  return loginRes.body.data.accessToken;
}

async function getCsrfToken(app: Koa, accessToken: string): Promise<string> {
  const res = await supertest(app.callback())
    .get('/api/v1/listings')
    .set('Authorization', `Bearer ${accessToken}`);
  expect(res.status).toBe(200);
  const csrf = res.headers['x-csrf-token'];
  expect(typeof csrf).toBe('string');
  expect(csrf.length).toBeGreaterThan(10);
  return csrf as string;
}

/** ── AUTH ───────────────────────────────────────────────────────────────── */
describe('auth/login under full prod middleware stack', () => {
  it('rejects login without Idempotency-Key (idempotency middleware enforced)', async () => {
    const { username, password } = await createUser('regular_user');
    const app = createFullStackApp();
    const nonceRes = await supertest(app.callback()).get('/api/v1/auth/nonce/login');
    const res = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .send({ username, password, nonce: nonceRes.body.data.nonce });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Idempotency-Key/);
  });

  it('accepts login with Idempotency-Key', async () => {
    const { username, password } = await createUser('regular_user');
    const app = createFullStackApp();
    const token = await loginFull(app, username, password);
    expect(token).toBeTruthy();
  });
});

/** ── LISTINGS ───────────────────────────────────────────────────────────── */
describe('listings.create under full prod middleware stack', () => {
  it('rejects POST without CSRF token', async () => {
    const { username, password } = await createUser('merchant');
    const app = createFullStackApp();
    const token = await loginFull(app, username, password);

    const res = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', uuidv4())
      .send({ city: 'Boston', state_code: 'MA' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/CSRF token missing/);
  });

  it('rejects POST without Idempotency-Key (with valid CSRF)', async () => {
    const { username, password } = await createUser('merchant');
    const app = createFullStackApp();
    const token = await loginFull(app, username, password);
    const csrf = await getCsrfToken(app, token);

    const res = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrf)
      .send({ city: 'Boston', state_code: 'MA' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Idempotency-Key/);
  });

  it('accepts POST with CSRF + Idempotency-Key', async () => {
    const { username, password } = await createUser('merchant');
    const app = createFullStackApp();
    const token = await loginFull(app, username, password);
    const csrf = await getCsrfToken(app, token);

    const res = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ city: 'Boston', state_code: 'MA', beds: 2, baths: 1, price_usd_cents: 100000, area_sqft: 500 });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  it('replaying the same Idempotency-Key returns the cached response', async () => {
    const { username, password } = await createUser('merchant');
    const app = createFullStackApp();
    const token = await loginFull(app, username, password);
    const csrf = await getCsrfToken(app, token);
    const idempotencyKey = uuidv4();
    const body = {
      city: 'Boston',
      state_code: 'MA',
      beds: 2,
      baths: 1,
      price_usd_cents: 100000,
      area_sqft: 500,
    };

    const first = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);
    expect(first.status).toBe(201);

    const second = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);
    expect(second.status).toBe(201);
    // Same listing id — proves the cached response was returned, not a fresh insert.
    expect(second.body.data.id).toBe(first.body.data.id);

    const count = await testKnex('listings').count<[{ c: number | string }]>('id as c').first();
    expect(Number(count?.c ?? 0)).toBe(1);
  });
});

/** ── ATTACHMENTS ────────────────────────────────────────────────────────── */
describe('attachments.upload under full prod middleware stack', () => {
  async function makeListing(merchantId: number, officeId: number): Promise<number> {
    const now = new Date();
    const [id] = await testKnex('listings').insert({
      office_id: officeId,
      created_by: merchantId,
      status: 'draft',
      version: 1,
      anomaly_flags: '[]',
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });
    return Number(id);
  }

  async function smallJpeg(): Promise<Buffer> {
    return sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
  }

  it('rejects multipart upload without CSRF token', async () => {
    const u = await createUser('merchant');
    const app = createFullStackApp();
    const token = await loginFull(app, u.username, u.password);
    const listingId = await makeListing(u.userId, 1);

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', uuidv4())
      .attach('file', await smallJpeg(), { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/CSRF/);
  });

  it('rejects multipart upload without Idempotency-Key', async () => {
    const u = await createUser('merchant');
    const app = createFullStackApp();
    const token = await loginFull(app, u.username, u.password);
    const csrf = await getCsrfToken(app, token);
    const listingId = await makeListing(u.userId, 1);

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrf)
      .attach('file', await smallJpeg(), { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Idempotency-Key/);
  });

  it('accepts multipart upload with CSRF + Idempotency-Key', async () => {
    const u = await createUser('merchant');
    const app = createFullStackApp();
    const token = await loginFull(app, u.username, u.password);
    const csrf = await getCsrfToken(app, token);
    const listingId = await makeListing(u.userId, 1);

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', await smallJpeg(), { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });
});

/** ── ADMIN PURGE ────────────────────────────────────────────────────────── */
describe('admin.purge_listing under full prod middleware stack', () => {
  it('rejects admin purge without CSRF token', async () => {
    const admin = await createUser('administrator');
    const app = createFullStackApp();
    const token = await loginFull(app, admin.username, admin.password);

    const now = new Date();
    const [listingId] = await testKnex('listings').insert({
      office_id: 1,
      created_by: admin.userId,
      status: 'draft',
      version: 1,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });

    const res = await supertest(app.callback())
      .post(`/api/v1/admin/purge/listing/${listingId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', 'whatever')
      .send({ confirm: `PURGE ${listingId}` });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/CSRF/);
  });

  it('rejects admin purge without Idempotency-Key (with valid CSRF)', async () => {
    const admin = await createUser('administrator');
    const app = createFullStackApp();
    const token = await loginFull(app, admin.username, admin.password);
    const csrf = await getCsrfToken(app, token);

    const now = new Date();
    const [listingId] = await testKnex('listings').insert({
      office_id: 1,
      created_by: admin.userId,
      status: 'draft',
      version: 1,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });

    const res = await supertest(app.callback())
      .post(`/api/v1/admin/purge/listing/${listingId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrf)
      .set('X-Nonce', 'whatever')
      .send({ confirm: `PURGE ${listingId}` });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Idempotency-Key/);
  });
});

/** ── ADMIN PURGE USER ───────────────────────────────────────────────────────
 *
 * The user-purge endpoint is irreversible and cascades across sessions,
 * listings, attachments, promos, and risk data — it deserves the same
 * representative full-stack middleware coverage as purge/listing.
 */
describe('admin.purge_user under full prod middleware stack', () => {
  async function seedTargetUserId(): Promise<number> {
    const now = new Date();
    const [id] = await testKnex('users').insert({
      username: `purge_target_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      password_hash: 'hash',
      role: 'regular_user',
      office_id: 1,
      status: 'active',
      failed_login_count: 0,
      must_change_password: 0,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });
    return Number(id);
  }

  it('rejects admin purge_user without CSRF token', async () => {
    await ensureOffice(1);
    const admin = await createUser('administrator');
    const app = createFullStackApp();
    const token = await loginFull(app, admin.username, admin.password);

    const targetId = await seedTargetUserId();

    const res = await supertest(app.callback())
      .post(`/api/v1/admin/purge/user/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', 'whatever')
      .send({ confirm: `PURGE ${targetId}` });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/CSRF/);
  });

  it('rejects admin purge_user without Idempotency-Key (with valid CSRF)', async () => {
    await ensureOffice(1);
    const admin = await createUser('administrator');
    const app = createFullStackApp();
    const token = await loginFull(app, admin.username, admin.password);
    const csrf = await getCsrfToken(app, token);

    const targetId = await seedTargetUserId();

    const res = await supertest(app.callback())
      .post(`/api/v1/admin/purge/user/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrf)
      .set('X-Nonce', 'whatever')
      .send({ confirm: `PURGE ${targetId}` });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Idempotency-Key/);
  });
});

/** ── PROMO ──────────────────────────────────────────────────────────────── */
describe('promo.create under full prod middleware stack', () => {
  it('rejects promo POST without CSRF token', async () => {
    const ops = await createUser('operations');
    const app = createFullStackApp();
    const token = await loginFull(app, ops.username, ops.password);

    const res = await supertest(app.callback())
      .post('/api/v1/promo')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', uuidv4())
      .send({
        title: 'Test',
        starts_at: new Date(Date.now() + 60_000).toISOString(),
        ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/CSRF/);
  });

  it('rejects promo POST without Idempotency-Key (with valid CSRF)', async () => {
    const ops = await createUser('operations');
    const app = createFullStackApp();
    const token = await loginFull(app, ops.username, ops.password);
    const csrf = await getCsrfToken(app, token);

    const res = await supertest(app.callback())
      .post('/api/v1/promo')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrf)
      .send({
        title: 'Test',
        starts_at: new Date(Date.now() + 60_000).toISOString(),
        ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Idempotency-Key/);
  });

  it('accepts promo POST with CSRF + Idempotency-Key', async () => {
    const ops = await createUser('operations');
    const app = createFullStackApp();
    const token = await loginFull(app, ops.username, ops.password);
    const csrf = await getCsrfToken(app, token);

    const res = await supertest(app.callback())
      .post('/api/v1/promo')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        title: 'Open Houses',
        starts_at: new Date(Date.now() + 60_000).toISOString(),
        ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });
});

/** ── IP RATE LIMIT MIDDLEWARE ──────────────────────────────────────────────
 *
 * Regression coverage for the audit finding:
 *   "The middleware checks counters but never increments them, so the advertised
 *    general API throttle and middleware-level failed-request throttle never
 *    activate."
 *
 * These tests assert the middleware actually trips 429 + Retry-After once the
 * relevant bucket fills — exercising the production middleware stack (no
 * skips) so the counter increment is wired end-to-end.
 */
describe('ipRateLimitMiddleware — general API throttle', () => {
  it('returns 429 with Retry-After after API_THROTTLE_MAX requests in the window', async () => {
    // The general-API bucket is 300 req / minute. Sending 301 requests from a
    // single IP via supertest lands them in the same bucket; the 301st must
    // be blocked with a 429 + Retry-After header.
    const app = createFullStackApp();

    // Use an unauthenticated cheap endpoint — 401 responses still count the
    // request against the general bucket because the middleware increments
    // before `next()`. /api/v1/auth/nonce/login returns 200 with no auth and
    // is the cheapest endpoint for volume tests.
    const agent = supertest(app.callback());
    let saw429 = false;
    let retryAfter: string | undefined;

    for (let i = 0; i < 305; i++) {
      const res = await agent.get('/api/v1/auth/nonce/login');
      if (res.status === 429) {
        saw429 = true;
        retryAfter = res.headers['retry-after'];
        expect(res.body.ok).toBe(false);
        expect(res.body.error.code).toBeDefined();
        break;
      }
    }

    expect(saw429).toBe(true);
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  }, 30_000);
});

describe('ipRateLimitMiddleware — failed-request throttle', () => {
  it('returns 429 with Retry-After after IP_RATE_LIMIT_MAX 401/403 responses', async () => {
    // The failed-request bucket is 30 req / 15 min. We fire >30 unauthenticated
    // requests to a protected endpoint (each returns 401), and expect the
    // middleware to flip the 31st+ response to 429 with Retry-After.
    const app = createFullStackApp();
    const agent = supertest(app.callback());

    let saw429 = false;
    let retryAfter: string | undefined;

    for (let i = 0; i < 40; i++) {
      // GET /api/v1/listings requires auth — no header → 401 from requireAuth.
      const res = await agent.get('/api/v1/listings');
      if (res.status === 429) {
        saw429 = true;
        retryAfter = res.headers['retry-after'];
        expect(res.body.ok).toBe(false);
        break;
      }
      expect(res.status).toBe(401);
    }

    expect(saw429).toBe(true);
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  }, 30_000);
});
