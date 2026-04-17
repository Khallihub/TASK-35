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
 * skips. Promo writes (collection create, slot add/delete/reorder, activate)
 * exercise CSRF + Idempotency-Key + IP rate limiting end-to-end.
 */
function createTestApp(): Koa {
  return createProductionTestApp();
}

beforeEach(() => {
  clearRateLimitStore();
});

async function createUserAndLogin(overrides: { role?: string; officeId?: number } = {}): Promise<{
  accessToken: string;
  userId: number;
  officeId: number;
  csrf: string;
}> {
  const username = `promouser_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'TestPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();

  const officeId = overrides.officeId ?? 1;
  const officeExists = await testKnex('offices').where({ id: officeId }).first();
  if (!officeExists) {
    await testKnex('offices').insert({ id: officeId, name: 'Test Office', code: `OFF${officeId}`, active: 1 });
  }

  const [userId] = await testKnex('users').insert({
    username,
    password_hash: hash,
    role: overrides.role ?? 'operations',
    office_id: officeId,
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: now,
    updated_at: now,
  });

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

async function createPublishedListingInDB(officeId: number, userId: number): Promise<number> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 23);
  const [id] = await testKnex('listings').insert({
    office_id: officeId,
    created_by: userId,
    status: 'published',
    price_usd_cents: 500000,
    area_sqft: 1000,
    beds: 2,
    baths: 2,
    address_line: '123 Main St',
    state_code: 'MA',
    postal_code: '02101',
    anomaly_flags: '[]',
    version: 1,
    created_at: now,
    updated_at: now,
  });
  return id;
}

describe('POST /api/v1/promo', () => {
  it('returns 201 when operations user creates a promo', async () => {
    const { accessToken, csrf } = await createUserAndLogin({ role: 'operations' });
    const app = createTestApp();

    const res = await supertest(app.callback())
      .post('/api/v1/promo')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        title: 'Summer Promo',
        starts_at: '2025-06-01T00:00:00.000Z',
        ends_at: '2025-06-30T00:00:00.000Z',
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.title).toBe('Summer Promo');
  });

  it('returns 403 when regular_user tries to create a promo', async () => {
    const { accessToken, csrf } = await createUserAndLogin({ role: 'regular_user' });
    const app = createTestApp();

    const res = await supertest(app.callback())
      .post('/api/v1/promo')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        title: 'Summer Promo',
        starts_at: '2025-06-01T00:00:00.000Z',
        ends_at: '2025-06-30T00:00:00.000Z',
      });

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
  });

  it('returns 403 when merchant tries to create a promo', async () => {
    const { accessToken, csrf } = await createUserAndLogin({ role: 'merchant' });
    const app = createTestApp();

    const res = await supertest(app.callback())
      .post('/api/v1/promo')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        title: 'Summer Promo',
        starts_at: '2025-06-01T00:00:00.000Z',
        ends_at: '2025-06-30T00:00:00.000Z',
      });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/promo', () => {
  it('returns 200 list', async () => {
    const { accessToken, csrf } = await createUserAndLogin({ role: 'operations' });
    const app = createTestApp();

    const res = await supertest(app.callback())
      .get('/api/v1/promo')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });
});

describe('GET /api/v1/promo/:id', () => {
  it('returns 200 with slots', async () => {
    const { accessToken, userId, officeId, csrf } = await createUserAndLogin({ role: 'operations' });
    const app = createTestApp();

    // Create a promo collection
    const createRes = await supertest(app.callback())
      .post('/api/v1/promo')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        title: 'Get Test',
        starts_at: '2025-06-01T00:00:00.000Z',
        ends_at: '2025-06-30T00:00:00.000Z',
      });
    expect(createRes.status).toBe(201);

    const promoId = createRes.body.data.id;
    const res = await supertest(app.callback())
      .get(`/api/v1/promo/${promoId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.id).toBe(promoId);
    expect(Array.isArray(res.body.data.slots)).toBe(true);
  });

  it('returns 404 for unknown promo', async () => {
    const { accessToken, csrf } = await createUserAndLogin({ role: 'operations' });
    const app = createTestApp();

    const res = await supertest(app.callback())
      .get('/api/v1/promo/999999')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/promo/:id/activate', () => {
  it('returns 200 with updated status', async () => {
    const { accessToken, csrf } = await createUserAndLogin({ role: 'operations' });
    const app = createTestApp();

    const createRes = await supertest(app.callback())
      .post('/api/v1/promo')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        title: 'Activate Test',
        starts_at: '2027-06-01T00:00:00.000Z',  // far future
        ends_at: '2027-06-30T00:00:00.000Z',
      });
    expect(createRes.status).toBe(201);
    const promoId = createRes.body.data.id;

    const res = await supertest(app.callback())
      .post(`/api/v1/promo/${promoId}/activate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Should be 'scheduled' since starts_at is in future
    expect(res.body.data.status).toBe('scheduled');
  });
});

describe('POST /api/v1/promo/:id/slots', () => {
  it('returns 201 with slot', async () => {
    const { accessToken, userId, officeId, csrf } = await createUserAndLogin({ role: 'operations' });
    const app = createTestApp();

    const listingId = await createPublishedListingInDB(officeId, userId);

    const createRes = await supertest(app.callback())
      .post('/api/v1/promo')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        title: 'Slot Route Test',
        starts_at: '2025-06-01T00:00:00.000Z',
        ends_at: '2025-06-30T00:00:00.000Z',
      });
    expect(createRes.status).toBe(201);
    const promoId = createRes.body.data.id;

    const res = await supertest(app.callback())
      .post(`/api/v1/promo/${promoId}/slots`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ listingId, rank: 1 });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.listing_id).toBe(listingId);
    expect(res.body.data.rank).toBe(1);
  });
});

describe('DELETE /api/v1/promo/:id/slots/:slotId', () => {
  it('returns 200 { ok: true }', async () => {
    const { accessToken, userId, officeId, csrf } = await createUserAndLogin({ role: 'operations' });
    const app = createTestApp();

    const listingId = await createPublishedListingInDB(officeId, userId);

    const createRes = await supertest(app.callback())
      .post('/api/v1/promo')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        title: 'Delete Slot Test',
        starts_at: '2025-06-01T00:00:00.000Z',
        ends_at: '2025-06-30T00:00:00.000Z',
      });
    expect(createRes.status).toBe(201);
    const promoId = createRes.body.data.id;

    const slotRes = await supertest(app.callback())
      .post(`/api/v1/promo/${promoId}/slots`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ listingId, rank: 1 });
    expect(slotRes.status).toBe(201);
    const slotId = slotRes.body.data.id;

    const res = await supertest(app.callback())
      .delete(`/api/v1/promo/${promoId}/slots/${slotId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('PUT /api/v1/promo/:id/slots/reorder', () => {
  it('returns 200 with updated slots', async () => {
    const { accessToken, userId, officeId, csrf } = await createUserAndLogin({ role: 'operations' });
    const app = createTestApp();

    const listingId1 = await createPublishedListingInDB(officeId, userId);
    const listingId2 = await createPublishedListingInDB(officeId, userId);

    const createRes = await supertest(app.callback())
      .post('/api/v1/promo')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        title: 'Reorder Route Test',
        starts_at: '2025-06-01T00:00:00.000Z',
        ends_at: '2025-06-30T00:00:00.000Z',
      });
    expect(createRes.status).toBe(201);
    const promoId = createRes.body.data.id;

    const slot1Res = await supertest(app.callback())
      .post(`/api/v1/promo/${promoId}/slots`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ listingId: listingId1, rank: 1 });
    expect(slot1Res.status).toBe(201);

    const slot2Res = await supertest(app.callback())
      .post(`/api/v1/promo/${promoId}/slots`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ listingId: listingId2, rank: 2 });
    expect(slot2Res.status).toBe(201);

    const slot1Id = slot1Res.body.data.id;
    const slot2Id = slot2Res.body.data.id;

    const res = await supertest(app.callback())
      .put(`/api/v1/promo/${promoId}/slots/reorder`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        slots: [
          { slotId: slot1Id, rank: 2 },
          { slotId: slot2Id, rank: 1 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].rank).toBe(1);
    expect(res.body.data[1].rank).toBe(2);
  });
});
