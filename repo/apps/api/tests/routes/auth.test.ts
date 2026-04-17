import supertest from 'supertest';
import Koa from 'koa';
import { v4 as uuidv4 } from 'uuid';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import { hashPassword } from '../../src/services/password';
import {
  createProductionTestApp,
  clearRateLimitStore,
  getCsrfToken,
} from '../helpers/testApp';
import { Knex as KnexType } from 'knex';

let testKnex: KnexType;

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

// Helper: create a test user
async function createUser(overrides: Partial<{
  username: string;
  password: string;
  role: string;
  failed_login_count: number;
  status: string;
}> = {}): Promise<{ id: number; username: string; password: string }> {
  const username = overrides.username ?? `testuser_${Date.now()}`;
  const password = overrides.password ?? 'TestPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();

  const [id] = await testKnex('users').insert({
    username,
    password_hash: hash,
    role: overrides.role ?? 'regular_user',
    status: overrides.status ?? 'active',
    failed_login_count: overrides.failed_login_count ?? 0,
    must_change_password: 0,
    created_at: now,
    updated_at: now,
  });

  return { id, username, password };
}

/**
 * Build the test Koa app via the production-mirror factory — full stack,
 * no skips. Auth tests now exercise the same errorMiddleware →
 * ipRateLimitMiddleware → bodyParser → csrfMiddleware → idempotencyMiddleware
 * pipeline that runs in production.
 *
 * - CSRF middleware natively skips `/api/v1/auth/login` and
 *   `/api/v1/auth/refresh`, so no token is required there.
 * - Logout sends a Bearer token, so it needs both an Idempotency-Key and a
 *   CSRF token (see the helper below).
 * - The IP rate-limit counter store is shared at the process level —
 *   `clearRateLimitStore()` runs in beforeEach to prevent cross-test bleed.
 */
function createTestApp(): Koa {
  return createProductionTestApp();
}

beforeEach(() => {
  clearRateLimitStore();
});

// Helper: fetch a single-use login nonce from the public endpoint
async function getLoginNonce(app: Koa): Promise<string> {
  const res = await supertest(app.callback())
    .get('/api/v1/auth/nonce/login');
  return res.body.data.nonce as string;
}

describe('POST /api/v1/auth/login', () => {
  let app: Koa;

  beforeEach(() => {
    app = createTestApp();
  });

  it('returns tokens and user on successful login', async () => {
    const user = await createUser({ username: `logintest1_${Date.now()}` });
    const nonce = await getLoginNonce(app);

    const res = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: user.username, password: user.password, nonce });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.user.username).toBe(user.username);
    expect(res.body.data.user.password_hash).toBeUndefined();
  });

  it('returns 401 INVALID_CREDENTIALS on wrong password', async () => {
    const user = await createUser({ username: `logintest2_${Date.now()}` });
    const nonce = await getLoginNonce(app);

    const res = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: user.username, password: 'WrongPassword1!', nonce });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 with generic error after 10 failed login attempts (locked account)', async () => {
    const user = await createUser({ username: `lockedtest1_${Date.now()}` });

    // Make 10 bad attempts — each requires its own nonce
    for (let i = 0; i < 10; i++) {
      const nonce = await getLoginNonce(app);
      await supertest(app.callback())
        .post('/api/v1/auth/login')
        .set('Idempotency-Key', uuidv4())
        .send({ username: user.username, password: 'WrongPass1!', nonce });
    }

    // Even with correct password, locked account returns generic error (PRD §8.2)
    const nonce = await getLoginNonce(app);
    const res = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: user.username, password: user.password, nonce });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('POST /api/v1/auth/logout', () => {
  let app: Koa;

  beforeEach(() => {
    app = createTestApp();
  });

  it('requires auth - returns 401 without token', async () => {
    // Send Idempotency-Key so the request reaches the route-level auth
    // gate; otherwise the idempotency middleware would short-circuit with
    // a 400. The test target is the auth check, not idempotency.
    const res = await supertest(app.callback())
      .post('/api/v1/auth/logout')
      .set('Idempotency-Key', uuidv4());

    expect(res.status).toBe(401);
  });

  it('successfully logs out with valid token', async () => {
    const user = await createUser({ username: `logouttest1_${Date.now()}` });
    const nonce = await getLoginNonce(app);

    const loginRes = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: user.username, password: user.password, nonce });

    expect(loginRes.status).toBe(200);
    const { accessToken } = loginRes.body.data;

    // Logout is a Bearer-authed mutation, so it needs a CSRF token in
    // addition to Idempotency-Key under the production middleware stack.
    const csrf = await getCsrfToken(app, accessToken);

    const res = await supertest(app.callback())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  let app: Koa;

  beforeEach(() => {
    app = createTestApp();
  });

  it('returns new tokens with a valid refresh token', async () => {
    const user = await createUser({ username: `refreshtest1_${Date.now()}` });
    const nonce = await getLoginNonce(app);

    const loginRes = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: user.username, password: user.password, nonce });

    expect(loginRes.status).toBe(200);
    const { refreshToken } = loginRes.body.data;

    const res = await supertest(app.callback())
      .post('/api/v1/auth/refresh')
      .set('Idempotency-Key', uuidv4())
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.refreshToken).not.toBe(refreshToken);
  });

  it('returns 401 with invalid refresh token', async () => {
    const res = await supertest(app.callback())
      .post('/api/v1/auth/refresh')
      .set('Idempotency-Key', uuidv4())
      .send({ refreshToken: 'invalid.token.here' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/auth/me', () => {
  let app: Koa;

  beforeEach(() => {
    app = createTestApp();
  });

  it('returns current user with valid token (after consent accepted)', async () => {
    const user = await createUser({ username: `metest1_${Date.now()}` });

    // Insert a consent version so consent check passes
    const existing = await testKnex('consent_versions').where({ version: '1.0' }).first();
    let versionId: number;
    if (existing) {
      versionId = existing.id;
    } else {
      const [vid] = await testKnex('consent_versions').insert({
        version: '1.0',
        body_md: 'Test consent',
        effective_from: new Date('2024-01-01'),
      });
      versionId = vid;
    }

    // Record consent for the user
    await testKnex('consent_records').insert({
      user_id: user.id,
      consent_version_id: versionId,
      accepted_at: new Date(),
      ip: '127.0.0.1',
    });

    const nonce = await getLoginNonce(app);
    const loginRes = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: user.username, password: user.password, nonce });

    expect(loginRes.status).toBe(200);
    const { accessToken } = loginRes.body.data;

    const res = await supertest(app.callback())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.username).toBe(user.username);
    expect(res.body.data.password_hash).toBeUndefined();
  });

  it('returns 401 without a token', async () => {
    const res = await supertest(app.callback())
      .get('/api/v1/auth/me');

    expect(res.status).toBe(401);
  });
});

// ── Security regression tests: disabled/locked enforcement ──────────

describe('disabled/locked account enforcement', () => {
  let app: Koa;

  beforeEach(() => {
    app = createTestApp();
  });

  it('rejects login for disabled accounts with generic error', async () => {
    const user = await createUser({ username: `disabled_login_${Date.now()}`, status: 'disabled' });
    const nonce = await getLoginNonce(app);

    const res = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: user.username, password: user.password, nonce });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects bearer token for account disabled after login', async () => {
    const user = await createUser({ username: `disabled_bearer_${Date.now()}` });
    const nonce = await getLoginNonce(app);

    const loginRes = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: user.username, password: user.password, nonce });

    expect(loginRes.status).toBe(200);
    const { accessToken } = loginRes.body.data;

    // Disable the user after they obtained a token
    await testKnex('users').where({ id: user.id }).update({ status: 'disabled' });

    const res = await supertest(app.callback())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(401);
  });

  it('rejects bearer token for account locked after login', async () => {
    const user = await createUser({ username: `locked_bearer_${Date.now()}` });
    const nonce = await getLoginNonce(app);

    const loginRes = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: user.username, password: user.password, nonce });

    expect(loginRes.status).toBe(200);
    const { accessToken } = loginRes.body.data;

    // Lock the user after they obtained a token
    const lockedUntil = new Date(Date.now() + 60 * 60 * 1000);
    await testKnex('users').where({ id: user.id }).update({ status: 'locked', locked_until: lockedUntil });

    const res = await supertest(app.callback())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(401);
  });

  it('rejects refresh for disabled accounts', async () => {
    const user = await createUser({ username: `disabled_refresh_${Date.now()}` });
    const nonce = await getLoginNonce(app);

    const loginRes = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: user.username, password: user.password, nonce });

    expect(loginRes.status).toBe(200);
    const { refreshToken } = loginRes.body.data;

    // Disable the user
    await testKnex('users').where({ id: user.id }).update({ status: 'disabled' });

    const res = await supertest(app.callback())
      .post('/api/v1/auth/refresh')
      .set('Idempotency-Key', uuidv4())
      .send({ refreshToken });

    expect(res.status).toBe(401);
  });

  it('rejects refresh for locked accounts', async () => {
    const user = await createUser({ username: `locked_refresh_${Date.now()}` });
    const nonce = await getLoginNonce(app);

    const loginRes = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: user.username, password: user.password, nonce });

    expect(loginRes.status).toBe(200);
    const { refreshToken } = loginRes.body.data;

    // Lock the user
    const lockedUntil = new Date(Date.now() + 60 * 60 * 1000);
    await testKnex('users').where({ id: user.id }).update({ status: 'locked', locked_until: lockedUntil });

    const res = await supertest(app.callback())
      .post('/api/v1/auth/refresh')
      .set('Idempotency-Key', uuidv4())
      .send({ refreshToken });

    expect(res.status).toBe(401);
  });

  it('rejects login for admin-locked accounts (no locked_until)', async () => {
    const user = await createUser({ username: `admin_locked_login_${Date.now()}` });

    // Admin sets locked status without locked_until (permanent lock)
    await testKnex('users').where({ id: user.id }).update({ status: 'locked', locked_until: null });

    const nonce = await getLoginNonce(app);
    const res = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: user.username, password: user.password, nonce });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');

    // Verify user is still locked (not auto-cleared)
    const userRow = await testKnex('users').where({ id: user.id }).first();
    expect(userRow.status).toBe('locked');
  });

  it('rejects refresh for admin-locked accounts (no locked_until)', async () => {
    const user = await createUser({ username: `admin_locked_refresh_${Date.now()}` });
    const nonce = await getLoginNonce(app);

    const loginRes = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: user.username, password: user.password, nonce });

    expect(loginRes.status).toBe(200);
    const { refreshToken } = loginRes.body.data;

    // Admin locks the user without locked_until (permanent lock)
    await testKnex('users').where({ id: user.id }).update({ status: 'locked', locked_until: null });

    const res = await supertest(app.callback())
      .post('/api/v1/auth/refresh')
      .set('Idempotency-Key', uuidv4())
      .send({ refreshToken });

    expect(res.status).toBe(401);

    // Verify user is still locked
    const userRow = await testKnex('users').where({ id: user.id }).first();
    expect(userRow.status).toBe('locked');
  });
});

describe('device fingerprint binding on refresh', () => {
  let app: Koa;

  beforeEach(() => {
    app = createTestApp();
  });

  it('allows refresh when fingerprint matches', async () => {
    const user = await createUser({ username: `fp_match_${Date.now()}` });
    const nonce = await getLoginNonce(app);
    const fingerprint = 'device-fp-' + Date.now();

    const loginRes = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .set('X-Device-Fingerprint', fingerprint)
      .send({ username: user.username, password: user.password, nonce });

    expect(loginRes.status).toBe(200);
    const { refreshToken } = loginRes.body.data;

    const res = await supertest(app.callback())
      .post('/api/v1/auth/refresh')
      .set('Idempotency-Key', uuidv4())
      .set('X-Device-Fingerprint', fingerprint)
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
  });

  it('revokes session on fingerprint mismatch', async () => {
    const user = await createUser({ username: `fp_mismatch_${Date.now()}` });
    const nonce = await getLoginNonce(app);
    const originalFp = 'original-fp-' + Date.now();
    const differentFp = 'different-fp-' + Date.now();

    const loginRes = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .set('X-Device-Fingerprint', originalFp)
      .send({ username: user.username, password: user.password, nonce });

    expect(loginRes.status).toBe(200);
    const { refreshToken } = loginRes.body.data;

    // Attempt refresh with a different fingerprint
    const res = await supertest(app.callback())
      .post('/api/v1/auth/refresh')
      .set('Idempotency-Key', uuidv4())
      .set('X-Device-Fingerprint', differentFp)
      .send({ refreshToken });

    expect(res.status).toBe(401);

    // Retry with original fingerprint — should also fail because session was revoked
    const retryRes = await supertest(app.callback())
      .post('/api/v1/auth/refresh')
      .set('Idempotency-Key', uuidv4())
      .set('X-Device-Fingerprint', originalFp)
      .send({ refreshToken });

    expect(retryRes.status).toBe(401);
  });
});
