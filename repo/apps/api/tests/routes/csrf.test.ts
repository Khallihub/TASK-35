import supertest from 'supertest';
import Koa from 'koa';
import { v4 as uuidv4 } from 'uuid';
import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import { hashPassword } from '../../src/services/password';
import { createProductionTestApp } from '../helpers/testApp';

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

/**
 * Build the Koa app via the production-mirror factory with CSRF enabled
 * (this is the focus of this isolated middleware test). Idempotency is
 * skipped because the suite does not currently send Idempotency-Key on its
 * mutation calls, and the IP rate-limit middleware is skipped to avoid
 * cross-test counter pollution. errorMiddleware, bodyParser, csrf, and
 * the full route table stay on.
 */
function createAppWithCsrf(): Koa {
  return createProductionTestApp({
    skipIdempotency: true,
    skipIpRateLimit: true,
  });
}

async function createUserAndLogin(role = 'regular_user'): Promise<{
  accessToken: string;
  userId: number;
}> {
  const username = `csrf_user_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'TestPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();

  const officeExists = await testKnex('offices').where({ id: 1 }).first();
  if (!officeExists) {
    await testKnex('offices').insert({ id: 1, name: 'Test Office', code: 'OFF1', active: 1 });
  }

  const [userId] = await testKnex('users').insert({
    username,
    password_hash: hash,
    role,
    office_id: 1,
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: now,
    updated_at: now,
  });

  // Consent
  let cvId: number;
  const cv = await testKnex('consent_versions').orderBy('effective_from', 'desc').first();
  if (cv) {
    cvId = cv.id;
  } else {
    const [vid] = await testKnex('consent_versions').insert({
      version: '1.0',
      body_md: 'Test consent',
      effective_from: new Date('2024-01-01'),
    });
    cvId = vid;
  }
  await testKnex('consent_records').insert({
    user_id: userId,
    consent_version_id: cvId,
    accepted_at: now,
    ip: '127.0.0.1',
  });

  // Login (via the CSRF-free auth/login path which is in CSRF_SKIP_PATHS)
  const app = createAppWithCsrf();
  const nonceRes = await supertest(app.callback()).get('/api/v1/auth/nonce/login');
  const nonce = nonceRes.body.data.nonce;
  const loginRes = await supertest(app.callback())
    .post('/api/v1/auth/login')
    .send({ username, password, nonce });

  expect(loginRes.status).toBe(200);
  return { accessToken: loginRes.body.data.accessToken, userId };
}

describe('CSRF middleware', () => {
  it('returns CSRF token on authenticated GET request', async () => {
    const { accessToken } = await createUserAndLogin();
    const app = createAppWithCsrf();

    const res = await supertest(app.callback())
      .get('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['x-csrf-token']).toBeTruthy();
    expect(typeof res.headers['x-csrf-token']).toBe('string');
    expect(res.headers['x-csrf-token'].length).toBeGreaterThan(10);
  });

  it('rejects mutating request with missing CSRF token -> 403', async () => {
    const { accessToken } = await createUserAndLogin();
    const app = createAppWithCsrf();

    const res = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', uuidv4())
      .send({ city: 'Boston', state_code: 'MA', beds: 2, baths: 1, price_usd_cents: 100000, area_sqft: 500 });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/CSRF token missing/);
  });

  it('rejects mutating request with invalid CSRF token -> 403', async () => {
    const { accessToken } = await createUserAndLogin();
    const app = createAppWithCsrf();

    const res = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
      .set('Idempotency-Key', uuidv4())
      .send({ city: 'Boston', state_code: 'MA', beds: 2, baths: 1, price_usd_cents: 100000, area_sqft: 500 });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/CSRF token invalid/);
  });

  it('accepts mutating request with valid CSRF token -> success', async () => {
    const { accessToken } = await createUserAndLogin();
    const app = createAppWithCsrf();

    // Step 1: GET to obtain the CSRF token
    const getRes = await supertest(app.callback())
      .get('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(getRes.status).toBe(200);
    const csrfToken = getRes.headers['x-csrf-token'];
    expect(csrfToken).toBeTruthy();

    // Step 2: POST with the CSRF token
    const postRes = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', uuidv4())
      .send({ city: 'Boston', state_code: 'MA', beds: 2, baths: 1, price_usd_cents: 100000, area_sqft: 500 });

    expect(postRes.status).toBe(201);
    expect(postRes.body.ok).toBe(true);
  });

  it('allows pre-auth paths (login, refresh) without CSRF token', async () => {
    const app = createAppWithCsrf();

    // Login is in CSRF_SKIP_PATHS — should not require CSRF
    const nonceRes = await supertest(app.callback()).get('/api/v1/auth/nonce/login');
    const nonce = nonceRes.body.data.nonce;

    const username = `csrf_skip_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const password = 'TestPass@123!';
    const hash = await hashPassword(password);
    const now = new Date();

    await testKnex('users').insert({
      username,
      password_hash: hash,
      role: 'regular_user',
      office_id: 1,
      status: 'active',
      failed_login_count: 0,
      must_change_password: 0,
      created_at: now,
      updated_at: now,
    });

    // Login POST without CSRF — should succeed (it's in the skip list)
    const loginRes = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .send({ username, password, nonce });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.ok).toBe(true);
  });
});
