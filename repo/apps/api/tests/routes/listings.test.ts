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

/**
 * Build the Koa app via the production-mirror factory — full stack, no
 * skips. Listings mutations exercise CSRF + Idempotency-Key + IP rate
 * limiting end-to-end, matching production request handling.
 */
function createTestApp(): Koa {
  return createProductionTestApp();
}

beforeEach(() => {
  clearRateLimitStore();
});

// Helper: create a test user and get access token + CSRF token
async function createUserAndLogin(overrides: {
  role?: string;
  officeId?: number;
} = {}): Promise<{ accessToken: string; userId: number; officeId: number; csrf: string }> {
  const username = `testuser_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'TestPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();

  // Ensure office exists
  const officeId = overrides.officeId ?? 1;
  const officeExists = await testKnex('offices').where({ id: officeId }).first();
  if (!officeExists) {
    await testKnex('offices').insert({ id: officeId, name: 'Test Office', code: `OFF${officeId}`, active: 1 });
  }

  const [userId] = await testKnex('users').insert({
    username,
    password_hash: hash,
    role: overrides.role ?? 'regular_user',
    office_id: officeId,
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: now,
    updated_at: now,
  });

  // Create consent version if needed
  const cvExists = await testKnex('consent_versions').orderBy('effective_from', 'desc').first();
  let cvId: number;
  if (cvExists) {
    cvId = cvExists.id;
  } else {
    const [vid] = await testKnex('consent_versions').insert({
      version: '1.0',
      body_md: 'Test consent',
      effective_from: new Date('2024-01-01'),
    });
    cvId = vid;
  }

  // Record consent
  await testKnex('consent_records').insert({
    user_id: userId,
    consent_version_id: cvId,
    accepted_at: now,
    ip: '127.0.0.1',
  });

  const app = createTestApp();
  const nonceRes = await supertest(app.callback())
    .get('/api/v1/auth/nonce/login');
  const loginNonce = nonceRes.body.data.nonce;
  const loginRes = await supertest(app.callback())
    .post('/api/v1/auth/login')
    .set('Idempotency-Key', uuidv4())
    .send({ username, password, nonce: loginNonce });

  expect(loginRes.status).toBe(200);
  const accessToken = loginRes.body.data.accessToken as string;
  const csrf = await getCsrfToken(app, accessToken);
  return { accessToken, userId: Number(userId), officeId, csrf };
}

describe('POST /api/v1/listings', () => {
  it('creates listing and returns 201', async () => {
    const { accessToken, csrf } = await createUserAndLogin();
    const app = createTestApp();

    const res = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        city: 'Boston',
        state_code: 'MA',
        beds: 2,
        baths: 1.5,
        price_usd_cents: 500000,
        area_sqft: 1000,
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.city).toBe('Boston');
    expect(res.body.data.baths).toBe(1.5);
  });

  it('returns 400 on validation error', async () => {
    const { accessToken, csrf } = await createUserAndLogin();
    const app = createTestApp();

    const res = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ state_code: 'XX' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without auth token', async () => {
    const app = createTestApp();

    const res = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Idempotency-Key', uuidv4())
      .send({ city: 'Boston' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/listings', () => {
  it('returns paginated results', async () => {
    const { accessToken, csrf } = await createUserAndLogin();
    const app = createTestApp();

    // Create a listing first
    await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ city: 'Seattle', state_code: 'WA' });

    const res = await supertest(app.callback())
      .get('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveProperty('items');
    expect(res.body.data).toHaveProperty('nextCursor');
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback()).get('/api/v1/listings');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/listings/:id', () => {
  it('returns listing', async () => {
    const { accessToken, csrf } = await createUserAndLogin();
    const app = createTestApp();

    const createRes = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ city: 'Chicago', state_code: 'IL' });

    expect(createRes.status).toBe(201);
    const listingId = createRes.body.data.id;

    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.id).toBe(listingId);
    expect(res.body.data.city).toBe('Chicago');
  });

  it('returns 404 for non-existent listing', async () => {
    const { accessToken, csrf } = await createUserAndLogin();
    const app = createTestApp();

    const res = await supertest(app.callback())
      .get('/api/v1/listings/99999')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/listings/:id', () => {
  it('returns 400 without If-Match header', async () => {
    const { accessToken, csrf } = await createUserAndLogin();
    const app = createTestApp();

    const createRes = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ city: 'Miami' });

    const listingId = createRes.body.data.id;

    const res = await supertest(app.callback())
      .patch(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ city: 'Fort Lauderdale' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 VERSION_CONFLICT with wrong version', async () => {
    const { accessToken, csrf } = await createUserAndLogin();
    const app = createTestApp();

    const createRes = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ city: 'Austin', state_code: 'TX' });

    const listingId = createRes.body.data.id;

    const res = await supertest(app.callback())
      .patch(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .set('If-Match', '999')
      .send({ city: 'Houston' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('successfully updates listing', async () => {
    const { accessToken, csrf } = await createUserAndLogin();
    const app = createTestApp();

    const createRes = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ city: 'Portland', state_code: 'OR' });

    expect(createRes.status).toBe(201);
    const listingId = createRes.body.data.id;
    const version = createRes.body.data.version;

    const res = await supertest(app.callback())
      .patch(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .set('If-Match', String(version))
      .send({ city: 'Eugene' });

    expect(res.status).toBe(200);
    expect(res.body.data.city).toBe('Eugene');
    expect(res.body.data.version).toBe(version + 1);
  });
});

describe('POST /api/v1/listings/:id/submit', () => {
  it('transitions draft → in_review', async () => {
    const { accessToken, csrf } = await createUserAndLogin();
    const app = createTestApp();

    const createRes = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ city: 'Denver', state_code: 'CO' });

    expect(createRes.status).toBe(201);
    const listingId = createRes.body.data.id;

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/submit`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('in_review');
  });
});

describe('DELETE /api/v1/listings/:id', () => {
  it('soft deletes a listing', async () => {
    const { accessToken, csrf } = await createUserAndLogin();
    const app = createTestApp();

    const createRes = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ city: 'Phoenix', state_code: 'AZ' });

    expect(createRes.status).toBe(201);
    const listingId = createRes.body.data.id;

    const res = await supertest(app.callback())
      .delete(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify it's soft-deleted (not found for regular user)
    const getRes = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(getRes.status).toBe(404);
  });
});
