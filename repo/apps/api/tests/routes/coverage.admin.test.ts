/**
 * True no-mock HTTP coverage for admin endpoints that previously were only
 * covered with `jest.mock('../../src/storage/repository')` applied at the
 * module level. Each endpoint below is now exercised against the real
 * route stack with no storage/knex mock in this suite:
 *   GET    /healthz
 *   GET    /api/v1/admin/risk/:userId
 *   POST   /api/v1/admin/blacklist
 *   DELETE /api/v1/admin/blacklist/:id
 *   POST   /api/v1/admin/purge/listing/:id
 *   GET    /api/v1/admin/audit-chain
 *
 * These sit alongside the mocked `admin.test.ts` suite: it stays to exercise
 * the storage-backed purge cascade (attachments/blobs), while this file
 * locks the no-mock path for auditability.
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

function createTestApp(): Koa {
  return createProductionTestApp();
}

beforeEach(() => {
  clearRateLimitStore();
});

async function ensureOffice(id = 1): Promise<void> {
  const exists = await testKnex('offices').where({ id }).first();
  if (!exists) {
    await testKnex('offices').insert({ id, name: 'Test Office', code: `COVAD${id}`, active: 1 });
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

async function createAdminAndLogin(): Promise<{
  accessToken: string;
  csrf: string;
  userId: number;
}> {
  await ensureOffice(1);
  const username = `cov_nm_admin_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

async function createPurgeNonce(userId: number): Promise<string> {
  const now = new Date();
  const value = `nonce_nm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await testKnex('nonces').insert({
    value,
    purpose: 'purge',
    user_id: userId,
    created_at: formatDatetime(now),
    expires_at: formatDatetime(new Date(now.getTime() + 5 * 60 * 1000)),
    consumed_at: null,
  });
  return value;
}

describe('GET /healthz (no-mock)', () => {
  it('returns 200 and a sane payload', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.data.version).toBe('string');
    expect(res.body.data.status).toBe('ok');
  });
});

describe('GET /api/v1/admin/risk/:userId (no-mock)', () => {
  beforeEach(async () => {
    await testKnex('risk_events').delete();
    await testKnex('risk_profiles').delete();
  });

  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback()).get('/api/v1/admin/risk/1');
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid userId path param', async () => {
    const { accessToken } = await createAdminAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/admin/risk/not-a-number')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });

  it('returns a freshly-created profile with credit_score 100', async () => {
    const { accessToken, userId } = await createAdminAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get(`/api/v1/admin/risk/${userId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.profile.credit_score).toBe(100);
    expect(Array.isArray(res.body.data.events)).toBe(true);
  });
});

describe('POST /api/v1/admin/blacklist (no-mock)', () => {
  beforeEach(async () => {
    await testKnex('blacklist_entries').delete();
  });

  it('returns 400 without subjectType', async () => {
    const { accessToken, csrf } = await createAdminAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/admin/blacklist')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ subjectValue: '1.2.3.4', reason: 'r' });
    expect(res.status).toBe(400);
  });

  it('returns 400 without subjectValue', async () => {
    const { accessToken, csrf } = await createAdminAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/admin/blacklist')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ subjectType: 'ip', reason: 'r' });
    expect(res.status).toBe(400);
  });

  it('returns 400 without reason', async () => {
    const { accessToken, csrf } = await createAdminAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/admin/blacklist')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ subjectType: 'ip', subjectValue: '1.2.3.4' });
    expect(res.status).toBe(400);
  });

  it('creates an entry and returns 201', async () => {
    const { accessToken, csrf } = await createAdminAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/admin/blacklist')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ subjectType: 'ip', subjectValue: '203.0.113.9', reason: 'suspected abuse' });
    expect(res.status).toBe(201);
    expect(res.body.data.subject_value).toBe('203.0.113.9');
  });
});

describe('DELETE /api/v1/admin/blacklist/:id (no-mock)', () => {
  beforeEach(async () => {
    await testKnex('blacklist_entries').delete();
  });

  it('returns 400 on invalid id', async () => {
    const { accessToken, csrf } = await createAdminAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .delete('/api/v1/admin/blacklist/not-a-number')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());
    expect(res.status).toBe(400);
  });

  it('removes the entry and returns 200', async () => {
    const { accessToken, csrf } = await createAdminAndLogin();
    const now = new Date();
    const [entryId] = await testKnex('blacklist_entries').insert({
      subject_type: 'ip',
      subject_value: '203.0.113.42',
      reason: 'test',
      created_at: formatDatetime(now),
    });

    const app = createTestApp();
    const res = await supertest(app.callback())
      .delete(`/api/v1/admin/blacklist/${entryId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());
    expect(res.status).toBe(200);
    expect(await testKnex('blacklist_entries').where({ id: entryId }).first()).toBeUndefined();
  });
});

describe('POST /api/v1/admin/purge/listing/:id (no-mock)', () => {
  beforeEach(async () => {
    await testKnex('listing_status_history').delete();
    await testKnex('listing_revisions').delete();
    await testKnex('attachments').delete();
    await testKnex('listings').delete();
    await testKnex('nonces').delete();
  });

  it('returns 400 with wrong confirm text', async () => {
    const { accessToken, csrf, userId } = await createAdminAndLogin();
    await ensureOffice(1);
    const now = new Date();
    const [listingId] = await testKnex('listings').insert({
      office_id: 1,
      created_by: userId,
      status: 'draft',
      version: 1,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });
    const nonce = await createPurgeNonce(userId);

    const app = createTestApp();
    const res = await supertest(app.callback())
      .post(`/api/v1/admin/purge/listing/${listingId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', nonce)
      .send({ confirm: 'WRONG' });
    expect(res.status).toBe(400);
    expect(await testKnex('listings').where({ id: listingId }).first()).toBeDefined();
  });

  it('returns 401 without X-Nonce header', async () => {
    const { accessToken, csrf, userId } = await createAdminAndLogin();
    await ensureOffice(1);
    const now = new Date();
    const [listingId] = await testKnex('listings').insert({
      office_id: 1,
      created_by: userId,
      status: 'draft',
      version: 1,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });

    const app = createTestApp();
    const res = await supertest(app.callback())
      .post(`/api/v1/admin/purge/listing/${listingId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ confirm: `PURGE ${listingId}` });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown listing', async () => {
    const { accessToken, csrf, userId } = await createAdminAndLogin();
    const nonce = await createPurgeNonce(userId);
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/admin/purge/listing/999999')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', nonce)
      .send({ confirm: 'PURGE 999999' });
    expect(res.status).toBe(404);
  });

  it('hard-deletes a listing with no attachments attached', async () => {
    const { accessToken, csrf, userId } = await createAdminAndLogin();
    await ensureOffice(1);
    const now = new Date();
    const [listingId] = await testKnex('listings').insert({
      office_id: 1,
      created_by: userId,
      status: 'draft',
      version: 1,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });
    const nonce = await createPurgeNonce(userId);

    const app = createTestApp();
    const res = await supertest(app.callback())
      .post(`/api/v1/admin/purge/listing/${listingId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', nonce)
      .send({ confirm: `PURGE ${listingId}` });
    expect(res.status).toBe(200);
    expect(await testKnex('listings').where({ id: listingId }).first()).toBeUndefined();
  });
});

describe('GET /api/v1/admin/audit-chain (no-mock)', () => {
  it('returns 200 with valid boolean', async () => {
    const { accessToken } = await createAdminAndLogin();
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/admin/audit-chain')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.data.valid).toBe('boolean');
  });
});
