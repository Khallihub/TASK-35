/**
 * Coverage tests for user endpoints not exercised elsewhere:
 *   POST /api/v1/users
 *   GET  /api/v1/users/:id
 */
import supertest from 'supertest';
import Koa from 'koa';
import { v4 as uuidv4 } from 'uuid';
import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import { hashPassword } from '../../src/services/password';
import {
  createProductionTestApp,
  clearRateLimitStore,
  getCsrfToken,
} from '../helpers/testApp';

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

function createTestApp(): Koa {
  return createProductionTestApp();
}

beforeEach(() => {
  clearRateLimitStore();
});

async function ensureOffice(id = 1): Promise<void> {
  const exists = await testKnex('offices').where({ id }).first();
  if (!exists) {
    await testKnex('offices').insert({ id, name: 'Test Office', code: `COVU${id}`, active: 1 });
  }
}

async function ensureConsentVersion(): Promise<number> {
  const existing = await testKnex('consent_versions').orderBy('effective_from', 'desc').first();
  if (existing) return existing.id;
  const [id] = await testKnex('consent_versions').insert({
    version: '1.0',
    body_md: 'Test consent',
    effective_from: new Date('2024-01-01'),
  });
  return id;
}

async function createAdminAndLogin(): Promise<{ accessToken: string; csrf: string; userId: number }> {
  await ensureOffice(1);
  const username = `cov_admin_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'AdminPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();
  const [userId] = await testKnex('users').insert({
    username,
    password_hash: hash,
    role: 'administrator',
    office_id: 1,
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: now,
    updated_at: now,
  });
  const cvId = await ensureConsentVersion();
  await testKnex('consent_records').insert({
    user_id: userId,
    consent_version_id: cvId,
    accepted_at: now,
    ip: '127.0.0.1',
  });
  const app = createTestApp();
  const nonceRes = await supertest(app.callback()).get('/api/v1/auth/nonce/login');
  const loginRes = await supertest(app.callback())
    .post('/api/v1/auth/login')
    .set('Idempotency-Key', uuidv4())
    .send({ username, password, nonce: nonceRes.body.data.nonce });
  expect(loginRes.status).toBe(200);
  const accessToken = loginRes.body.data.accessToken as string;
  const csrf = await getCsrfToken(app, accessToken);
  return { accessToken, csrf, userId: Number(userId) };
}

async function createRegularAndLogin(): Promise<{ accessToken: string; csrf: string }> {
  await ensureOffice(1);
  const username = `cov_reg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'UserPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();
  const [userId] = await testKnex('users').insert({
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
  const cvId = await ensureConsentVersion();
  await testKnex('consent_records').insert({
    user_id: userId,
    consent_version_id: cvId,
    accepted_at: now,
    ip: '127.0.0.1',
  });
  const app = createTestApp();
  const nonceRes = await supertest(app.callback()).get('/api/v1/auth/nonce/login');
  const loginRes = await supertest(app.callback())
    .post('/api/v1/auth/login')
    .set('Idempotency-Key', uuidv4())
    .send({ username, password, nonce: nonceRes.body.data.nonce });
  expect(loginRes.status).toBe(200);
  const accessToken = loginRes.body.data.accessToken as string;
  const csrf = await getCsrfToken(app, accessToken);
  return { accessToken, csrf };
}

describe('POST /api/v1/users', () => {
  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/users')
      .set('Idempotency-Key', uuidv4())
      .send({ username: 'x', password: 'y', role: 'regular_user' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const { accessToken, csrf } = await createRegularAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ username: 'x', password: 'y', role: 'regular_user' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields missing', async () => {
    const { accessToken, csrf } = await createAdminAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ username: 'only' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 on invalid role', async () => {
    const { accessToken, csrf } = await createAdminAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        username: `x_${Date.now()}`,
        password: 'Strong@123456',
        role: 'not_a_role',
        office_id: 1,
      });
    expect(res.status).toBe(400);
  });

  it('returns 400 when merchant/regular_user supplied without office_id', async () => {
    const { accessToken, csrf } = await createAdminAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        username: `noffice_${Date.now()}`,
        password: 'Strong@123456',
        role: 'merchant',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/office_id/i);
  });

  it('returns 400 on weak password', async () => {
    const { accessToken, csrf } = await createAdminAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        username: `weakpw_${Date.now()}`,
        password: 'abc',
        role: 'regular_user',
        office_id: 1,
      });
    expect(res.status).toBe(400);
  });

  it('creates a user with must_change_password=1', async () => {
    const { accessToken, csrf } = await createAdminAndLogin();
    const app = createTestApp();
    const username = `newuser_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const res = await supertest(app.callback())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        username,
        password: 'Strong@123456',
        role: 'operations',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.username).toBe(username.toLowerCase());
    expect(res.body.data.role).toBe('operations');
    expect(res.body.data.must_change_password).toBe(1);
    expect(res.body.data.password_hash).toBeUndefined();
  });

  it('returns 409 on duplicate username (case-insensitive)', async () => {
    const { accessToken, csrf } = await createAdminAndLogin();
    const app = createTestApp();
    const username = `dup_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const first = await supertest(app.callback())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        username,
        password: 'Strong@123456',
        role: 'operations',
      });
    expect(first.status).toBe(201);

    const dup = await supertest(app.callback())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        username: username.toUpperCase(),
        password: 'Strong@123456',
        role: 'operations',
      });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
  });
});

describe('GET /api/v1/users/:id', () => {
  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback()).get('/api/v1/users/1');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const { accessToken } = await createRegularAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/users/1')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown user', async () => {
    const { accessToken } = await createAdminAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/users/999999')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });

  it('returns user without password_hash', async () => {
    const { accessToken, userId } = await createAdminAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(userId);
    expect(res.body.data.role).toBe('administrator');
    expect(res.body.data.password_hash).toBeUndefined();
  });
});
