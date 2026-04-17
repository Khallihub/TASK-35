/**
 * Coverage tests for promo endpoints not exercised elsewhere:
 *   PATCH /api/v1/promo/:id
 *   POST  /api/v1/promo/:id/cancel
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
    await testKnex('offices').insert({ id, name: 'Test Office', code: `COVP${id}`, active: 1 });
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

async function createUserAndLogin(role = 'operations'): Promise<{
  accessToken: string;
  csrf: string;
  userId: number;
}> {
  await ensureOffice(1);
  const username = `cov_promo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'TestPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();
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

async function createDraftPromo(accessToken: string, csrf: string, app: Koa, title = 'Coverage Promo'): Promise<number> {
  const res = await supertest(app.callback())
    .post('/api/v1/promo')
    .set('Authorization', `Bearer ${accessToken}`)
    .set('X-CSRF-Token', csrf)
    .set('Idempotency-Key', uuidv4())
    .send({
      title,
      starts_at: '2027-06-01T00:00:00.000Z',
      ends_at: '2027-06-30T00:00:00.000Z',
    });
  expect(res.status).toBe(201);
  return res.body.data.id as number;
}

describe('PATCH /api/v1/promo/:id', () => {
  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback())
      .patch('/api/v1/promo/1')
      .set('Idempotency-Key', uuidv4())
      .send({ title: 'x' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for regular_user', async () => {
    const { accessToken, csrf } = await createUserAndLogin('regular_user');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .patch('/api/v1/promo/1')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ title: 'x' });
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown promo', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .patch('/api/v1/promo/999999')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ title: 'Renamed' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when ends_at <= starts_at', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');
    const app = createTestApp();
    const id = await createDraftPromo(accessToken, csrf, app);

    const res = await supertest(app.callback())
      .patch(`/api/v1/promo/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        starts_at: '2027-07-01T00:00:00.000Z',
        ends_at: '2027-06-15T00:00:00.000Z',
      });
    expect(res.status).toBe(400);
  });

  it('updates a draft promo title', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');
    const app = createTestApp();
    const id = await createDraftPromo(accessToken, csrf, app);

    const res = await supertest(app.callback())
      .patch(`/api/v1/promo/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ title: 'Renamed Promo' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Renamed Promo');
  });

  it('returns 400 for non-draft promo', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');
    const app = createTestApp();
    const id = await createDraftPromo(accessToken, csrf, app);

    // Activate so promo is scheduled (not draft)
    const act = await supertest(app.callback())
      .post(`/api/v1/promo/${id}/activate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());
    expect(act.status).toBe(200);

    const res = await supertest(app.callback())
      .patch(`/api/v1/promo/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ title: 'Too Late' });
    expect(res.status).toBe(400);
  });
});

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

describe('POST /api/v1/promo/:id/slots — validation depth', () => {
  it('returns 400 when listingId missing', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');
    const app = createTestApp();
    const id = await createDraftPromo(accessToken, csrf, app);

    const res = await supertest(app.callback())
      .post(`/api/v1/promo/${id}/slots`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ rank: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when rank missing', async () => {
    const { accessToken, csrf, userId } = await createUserAndLogin('operations');
    const listingId = await createPublishedListingInDB(1, userId);
    const app = createTestApp();
    const id = await createDraftPromo(accessToken, csrf, app);

    const res = await supertest(app.callback())
      .post(`/api/v1/promo/${id}/slots`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ listingId });
    expect(res.status).toBe(400);
  });

  it('returns 400 when rank is out of range', async () => {
    const { accessToken, csrf, userId } = await createUserAndLogin('operations');
    const listingId = await createPublishedListingInDB(1, userId);
    const app = createTestApp();
    const id = await createDraftPromo(accessToken, csrf, app);

    const res = await supertest(app.callback())
      .post(`/api/v1/promo/${id}/slots`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ listingId, rank: 99 });
    expect(res.status).toBe(400);
  });

  it('returns 404 when promo collection missing', async () => {
    const { accessToken, csrf, userId } = await createUserAndLogin('operations');
    const listingId = await createPublishedListingInDB(1, userId);
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/promo/999999/slots')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ listingId, rank: 1 });
    expect(res.status).toBe(404);
  });

  it('returns 404 when listing missing', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');
    const app = createTestApp();
    const id = await createDraftPromo(accessToken, csrf, app);
    const res = await supertest(app.callback())
      .post(`/api/v1/promo/${id}/slots`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ listingId: 999999, rank: 1 });
    expect(res.status).toBe(404);
  });

  it('returns 400 when listing is not published', async () => {
    const { accessToken, csrf, userId } = await createUserAndLogin('operations');
    const now = new Date().toISOString().replace('T', ' ').slice(0, 23);
    const [draftId] = await testKnex('listings').insert({
      office_id: 1,
      created_by: userId,
      status: 'draft',
      version: 1,
      anomaly_flags: '[]',
      created_at: now,
      updated_at: now,
    });
    const app = createTestApp();
    const id = await createDraftPromo(accessToken, csrf, app);
    const res = await supertest(app.callback())
      .post(`/api/v1/promo/${id}/slots`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ listingId: draftId, rank: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 409 on duplicate rank', async () => {
    const { accessToken, csrf, userId } = await createUserAndLogin('operations');
    const listing1 = await createPublishedListingInDB(1, userId);
    const listing2 = await createPublishedListingInDB(1, userId);
    const app = createTestApp();
    const id = await createDraftPromo(accessToken, csrf, app);

    const first = await supertest(app.callback())
      .post(`/api/v1/promo/${id}/slots`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ listingId: listing1, rank: 1 });
    expect(first.status).toBe(201);

    const second = await supertest(app.callback())
      .post(`/api/v1/promo/${id}/slots`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ listingId: listing2, rank: 1 });
    expect(second.status).toBe(409);
  });

  it('returns 409 when the same listing is re-added', async () => {
    const { accessToken, csrf, userId } = await createUserAndLogin('operations');
    const listingId = await createPublishedListingInDB(1, userId);
    const app = createTestApp();
    const id = await createDraftPromo(accessToken, csrf, app);

    const first = await supertest(app.callback())
      .post(`/api/v1/promo/${id}/slots`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ listingId, rank: 1 });
    expect(first.status).toBe(201);

    const second = await supertest(app.callback())
      .post(`/api/v1/promo/${id}/slots`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ listingId, rank: 2 });
    expect(second.status).toBe(409);
  });
});

describe('DELETE /api/v1/promo/:id/slots/:slotId — validation depth', () => {
  it('returns 400 for non-numeric promo id', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .delete('/api/v1/promo/abc/slots/1')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());
    expect(res.status).toBe(400);
  });

  it('returns 404 when slot does not exist in the collection', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');
    const app = createTestApp();
    const id = await createDraftPromo(accessToken, csrf, app);
    const res = await supertest(app.callback())
      .delete(`/api/v1/promo/${id}/slots/99999`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/promo/:id/slots/reorder — validation depth', () => {
  it('returns 400 when slots is not an array', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');
    const app = createTestApp();
    const id = await createDraftPromo(accessToken, csrf, app);
    const res = await supertest(app.callback())
      .put(`/api/v1/promo/${id}/slots/reorder`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ slots: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-numeric promo id on reorder', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .put('/api/v1/promo/abc/slots/reorder')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ slots: [] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/promo/:id/cancel', () => {
  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/promo/1/cancel')
      .set('Idempotency-Key', uuidv4());
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-ops/admin', async () => {
    const { accessToken, csrf } = await createUserAndLogin('merchant');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/promo/1/cancel')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown promo', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/promo/999999/cancel')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());
    expect(res.status).toBe(404);
  });

  it('cancels a scheduled promo', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');
    const app = createTestApp();
    const id = await createDraftPromo(accessToken, csrf, app);

    // Activate → scheduled (future starts_at)
    const act = await supertest(app.callback())
      .post(`/api/v1/promo/${id}/activate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());
    expect(act.status).toBe(200);
    expect(act.body.data.status).toBe('scheduled');

    const res = await supertest(app.callback())
      .post(`/api/v1/promo/${id}/cancel`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });
});
