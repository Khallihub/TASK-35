/**
 * Coverage tests for listing endpoints not exercised elsewhere:
 *   POST /api/v1/listings/:id/reject
 *   POST /api/v1/listings/:id/restore
 *   GET  /api/v1/listings/:id/revisions
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
    await testKnex('offices').insert({ id, name: 'Test Office', code: `COVL${id}`, active: 1 });
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

async function createUserAndLogin(opts: {
  role: string;
  officeId?: number;
} = { role: 'regular_user' }): Promise<{
  accessToken: string;
  csrf: string;
  userId: number;
  officeId: number;
}> {
  const officeId = opts.officeId ?? 1;
  await ensureOffice(officeId);
  const username = `cov_list_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'TestPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();
  const [userId] = await testKnex('users').insert({
    username,
    password_hash: hash,
    role: opts.role,
    office_id: officeId,
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
  return { accessToken, csrf, userId: Number(userId), officeId };
}

async function createDraftListing(userToken: string, userCsrf: string, app: Koa): Promise<number> {
  const res = await supertest(app.callback())
    .post('/api/v1/listings')
    .set('Authorization', `Bearer ${userToken}`)
    .set('X-CSRF-Token', userCsrf)
    .set('Idempotency-Key', uuidv4())
    .send({
      address_line: '1 Coverage Way',
      city: 'Boston',
      state_code: 'MA',
      postal_code: '02101',
      beds: 2,
      baths: 1,
      price_usd_cents: 20000000,
      area_sqft: 1000,
    });
  expect(res.status).toBe(201);
  return res.body.data.id as number;
}

async function submitListing(userToken: string, userCsrf: string, app: Koa, id: number): Promise<void> {
  const res = await supertest(app.callback())
    .post(`/api/v1/listings/${id}/submit`)
    .set('Authorization', `Bearer ${userToken}`)
    .set('X-CSRF-Token', userCsrf)
    .set('Idempotency-Key', uuidv4())
    .send({});
  expect(res.status).toBe(200);
}

describe('POST /api/v1/listings/:id/reject', () => {
  it('returns 403 for regular_user', async () => {
    const owner = await createUserAndLogin({ role: 'regular_user', officeId: 1 });
    const app = createTestApp();
    const listingId = await createDraftListing(owner.accessToken, owner.csrf, app);
    await submitListing(owner.accessToken, owner.csrf, app, listingId);

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/reject`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ reason: 'Too many photos missing required tags' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when reason is missing / short', async () => {
    const owner = await createUserAndLogin({ role: 'regular_user', officeId: 1 });
    const merchant = await createUserAndLogin({ role: 'merchant', officeId: 1 });
    const app = createTestApp();
    const listingId = await createDraftListing(owner.accessToken, owner.csrf, app);
    await submitListing(owner.accessToken, owner.csrf, app, listingId);

    const short = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/reject`)
      .set('Authorization', `Bearer ${merchant.accessToken}`)
      .set('X-CSRF-Token', merchant.csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ reason: 'too short' });
    expect(short.status).toBe(400);

    const missing = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/reject`)
      .set('Authorization', `Bearer ${merchant.accessToken}`)
      .set('X-CSRF-Token', merchant.csrf)
      .set('Idempotency-Key', uuidv4())
      .send({});
    expect(missing.status).toBe(400);
  });

  it('merchant rejects in_review listing successfully', async () => {
    const owner = await createUserAndLogin({ role: 'regular_user', officeId: 1 });
    const merchant = await createUserAndLogin({ role: 'merchant', officeId: 1 });
    const app = createTestApp();
    const listingId = await createDraftListing(owner.accessToken, owner.csrf, app);
    await submitListing(owner.accessToken, owner.csrf, app, listingId);

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/reject`)
      .set('Authorization', `Bearer ${merchant.accessToken}`)
      .set('X-CSRF-Token', merchant.csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ reason: 'Insufficient photos and missing floor plan' });
    expect(res.status).toBe(200);
    // rejected maps back to draft in state machine
    expect(res.body.data.status).toBe('draft');
  });
});

describe('POST /api/v1/listings/:id/restore', () => {
  it('returns 403 for regular_user', async () => {
    const owner = await createUserAndLogin({ role: 'regular_user', officeId: 1 });
    const app = createTestApp();
    const listingId = await createDraftListing(owner.accessToken, owner.csrf, app);

    // Soft-delete
    const del = await supertest(app.callback())
      .delete(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', uuidv4());
    expect(del.status).toBe(200);

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/restore`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', uuidv4());
    expect(res.status).toBe(403);
  });

  it('returns 400 when listing is not deleted', async () => {
    const merchant = await createUserAndLogin({ role: 'merchant', officeId: 1 });
    const app = createTestApp();
    const listingId = await createDraftListing(merchant.accessToken, merchant.csrf, app);

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/restore`)
      .set('Authorization', `Bearer ${merchant.accessToken}`)
      .set('X-CSRF-Token', merchant.csrf)
      .set('Idempotency-Key', uuidv4());
    expect(res.status).toBe(400);
  });

  it('merchant restores a soft-deleted listing', async () => {
    const merchant = await createUserAndLogin({ role: 'merchant', officeId: 1 });
    const app = createTestApp();
    const listingId = await createDraftListing(merchant.accessToken, merchant.csrf, app);

    const del = await supertest(app.callback())
      .delete(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${merchant.accessToken}`)
      .set('X-CSRF-Token', merchant.csrf)
      .set('Idempotency-Key', uuidv4());
    expect(del.status).toBe(200);

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/restore`)
      .set('Authorization', `Bearer ${merchant.accessToken}`)
      .set('X-CSRF-Token', merchant.csrf)
      .set('Idempotency-Key', uuidv4());
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('draft');
  });

  it('returns 404 for unknown listing', async () => {
    const merchant = await createUserAndLogin({ role: 'merchant', officeId: 1 });
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/listings/999999/restore')
      .set('Authorization', `Bearer ${merchant.accessToken}`)
      .set('X-CSRF-Token', merchant.csrf)
      .set('Idempotency-Key', uuidv4());
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/listings/:id/revisions', () => {
  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback()).get('/api/v1/listings/1/revisions');
    expect(res.status).toBe(401);
  });

  it('returns revisions for listing owner', async () => {
    const owner = await createUserAndLogin({ role: 'regular_user', officeId: 1 });
    const app = createTestApp();
    const listingId = await createDraftListing(owner.accessToken, owner.csrf, app);

    // Generate revisions by patching
    const listing = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(listing.status).toBe(200);
    const version = listing.body.data.version;

    const patch = await supertest(app.callback())
      .patch(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', uuidv4())
      .set('If-Match', String(version))
      .send({ city: 'Somerville' });
    expect(patch.status).toBe(200);

    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/revisions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns 403 for regular_user who is not the owner', async () => {
    const owner = await createUserAndLogin({ role: 'regular_user', officeId: 1 });
    const other = await createUserAndLogin({ role: 'regular_user', officeId: 1 });
    const app = createTestApp();
    const listingId = await createDraftListing(owner.accessToken, owner.csrf, app);

    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/revisions`)
      .set('Authorization', `Bearer ${other.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('administrator can view revisions on any listing', async () => {
    const owner = await createUserAndLogin({ role: 'regular_user', officeId: 1 });
    const admin = await createUserAndLogin({ role: 'administrator', officeId: 1 });
    const app = createTestApp();
    const listingId = await createDraftListing(owner.accessToken, owner.csrf, app);

    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/revisions`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
  });

  it('merchant from different office is forbidden', async () => {
    const owner = await createUserAndLogin({ role: 'regular_user', officeId: 1 });
    const otherMerchant = await createUserAndLogin({ role: 'merchant', officeId: 99 });
    const app = createTestApp();
    const listingId = await createDraftListing(owner.accessToken, owner.csrf, app);

    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/revisions`)
      .set('Authorization', `Bearer ${otherMerchant.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown listing', async () => {
    const admin = await createUserAndLogin({ role: 'administrator', officeId: 1 });
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/listings/999999/revisions')
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(404);
  });
});
