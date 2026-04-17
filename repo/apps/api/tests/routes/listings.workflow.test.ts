/**
 * E2E workflow test for listing publishing workflow (Phase 4).
 *
 * Tests the full lifecycle:
 * 1. Create listing (regular_user)
 * 2. Submit (regular_user → in_review)
 * 3. Approve (merchant with nonce)
 * 4. Publish (merchant with nonce)
 * 5. Verify status = published
 * 6. Reverse (merchant → in_review)
 * 7. Verify status = in_review
 * 8. Approve again (merchant with nonce)
 * 9. Archive (merchant)
 * 10. Verify status = archived
 *
 * Also tests:
 * - Attempt to publish a draft → ILLEGAL_TRANSITION
 * - Approve with anomaly flags but no overrideReason → ILLEGAL_TRANSITION
 * - Approve with anomaly flags and overrideReason (>= 10 chars) → succeeds
 */
import supertest from 'supertest';
import Koa from 'koa';
import { v4 as uuidv4 } from 'uuid';
import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import { hashPassword } from '../../src/services/password';
import { generateNonce } from '../../src/services/nonce';
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
 * Build the Koa app via the production-mirror factory — no skips. Workflow
 * mutations now exercise CSRF + Idempotency-Key + IP rate limiting end-to-end.
 */
function createTestApp(): Koa {
  return createProductionTestApp();
}

beforeEach(() => {
  // The IP rate-limit counter store is process-global; reset between tests
  // so cross-test bleed cannot produce spurious 429s.
  clearRateLimitStore();
});

async function createUserAndLogin(opts: {
  role: string;
  officeId?: number;
}): Promise<{ accessToken: string; userId: number; officeId: number; csrf: string }> {
  const username = `wfuser_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'TestPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();

  const officeId = opts.officeId ?? 1;
  const officeExists = await testKnex('offices').where({ id: officeId }).first();
  if (!officeExists) {
    await testKnex('offices').insert({ id: officeId, name: 'Test Office', code: `OFF${officeId}`, active: 1 });
  }

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
  // Pre-fetch a CSRF token so subsequent mutating workflow calls can attach
  // it. Tokens are jti-scoped and stable for the day, so a single fetch per
  // session is sufficient.
  const csrf = await getCsrfToken(app, accessToken);
  return { accessToken, userId: Number(userId), officeId, csrf };
}

describe('Full listing publishing workflow', () => {
  it('create → submit → approve → publish → reverse → approve → archive', async () => {
    const app = createTestApp();

    // Create a regular user (owner) and a merchant in same office
    const { accessToken: userToken, userId, csrf: userCsrf } = await createUserAndLogin({ role: 'regular_user', officeId: 1 });
    const { accessToken: merchantToken, userId: merchantId, csrf: merchantCsrf } = await createUserAndLogin({ role: 'merchant', officeId: 1 });

    // Step 1: Create listing (regular_user)
    // price_usd_cents: 30000000 = $300,000; area_sqft 1500 → $200/sqft (within default 50–5000 range)
    const createRes = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-CSRF-Token', userCsrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        address_line: '100 Workflow Ave',
        city: 'Boston',
        state_code: 'MA',
        postal_code: '02101',
        beds: 3,
        baths: 2,
        price_usd_cents: 30000000,
        area_sqft: 1500,
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe('draft');
    const listingId = createRes.body.data.id;

    // Step 2: Submit (regular_user → in_review)
    const submitRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/submit`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-CSRF-Token', userCsrf)
      .set('Idempotency-Key', uuidv4())
      .send({});
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.data.status).toBe('in_review');

    // Step 3: Approve (merchant, with nonce)
    const approveNonce = await generateNonce('approve', BigInt(merchantId), testKnex);
    const approveRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/approve`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('X-CSRF-Token', merchantCsrf)
      .set('X-Nonce', approveNonce)
      .set('Idempotency-Key', uuidv4())
      .send({});
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.status).toBe('approved');

    // Step 4: Publish (merchant, with nonce)
    const publishNonce = await generateNonce('publish', BigInt(merchantId), testKnex);
    const publishRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/publish`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('X-CSRF-Token', merchantCsrf)
      .set('X-Nonce', publishNonce)
      .set('Idempotency-Key', uuidv4())
      .send({});
    expect(publishRes.status).toBe(200);
    expect(publishRes.body.data.status).toBe('published');

    // Step 5: Verify status = published via GET
    const getRes1 = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(getRes1.status).toBe(200);
    expect(getRes1.body.data.status).toBe('published');

    // Step 6: Reverse (merchant → in_review)
    const reverseRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/reverse`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('X-CSRF-Token', merchantCsrf)
      .set('Idempotency-Key', uuidv4())
      .send({ reason: 'Needs additional photos and description updates' });
    expect(reverseRes.status).toBe(200);
    expect(reverseRes.body.data.status).toBe('in_review');

    // Step 7: Verify status = in_review
    const getRes2 = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(getRes2.status).toBe(200);
    expect(getRes2.body.data.status).toBe('in_review');

    // Step 8: Approve again (merchant, with nonce)
    const approveNonce2 = await generateNonce('approve', BigInt(merchantId), testKnex);
    const approveRes2 = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/approve`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('X-CSRF-Token', merchantCsrf)
      .set('X-Nonce', approveNonce2)
      .set('Idempotency-Key', uuidv4())
      .send({});
    expect(approveRes2.status).toBe(200);
    expect(approveRes2.body.data.status).toBe('approved');

    // Step 9a: Publish again (from approved, per PRD archive is only from published)
    const publishNonce2 = await generateNonce('publish', BigInt(merchantId), testKnex);
    const publishRes2 = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/publish`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('X-CSRF-Token', merchantCsrf)
      .set('X-Nonce', publishNonce2)
      .set('Idempotency-Key', uuidv4());
    expect(publishRes2.status).toBe(200);
    expect(publishRes2.body.data.status).toBe('published');

    // Step 9b: Archive (merchant) — PRD: published → archived
    const archiveRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/archive`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('X-CSRF-Token', merchantCsrf)
      .set('Idempotency-Key', uuidv4())
      .send({ reason: 'Seller withdrew the listing from market' });
    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.data.status).toBe('archived');

    // Step 10: Verify final status = archived
    // Note: only admin/merchant can see archived listings; use merchant token
    const getRes3 = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${merchantToken}`);
    expect(getRes3.status).toBe(200);
    expect(getRes3.body.data.status).toBe('archived');
  });
});

describe('Publish gate enforcement', () => {
  it('attempt to publish a listing missing required fields → VALIDATION_ERROR', async () => {
    const app = createTestApp();

    const { accessToken: userToken, userId, csrf: userCsrf } = await createUserAndLogin({ role: 'regular_user', officeId: 1 });
    const { accessToken: merchantToken, userId: merchantId, csrf: merchantCsrf } = await createUserAndLogin({ role: 'merchant', officeId: 1 });

    // Create a bare listing (no price/area/beds/baths/address/state/postal)
    const createRes = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-CSRF-Token', userCsrf)
      .set('Idempotency-Key', uuidv4())
      .send({ city: 'Bare City' });
    expect(createRes.status).toBe(201);
    const listingId = createRes.body.data.id;

    // Submit
    const submitRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/submit`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-CSRF-Token', userCsrf)
      .set('Idempotency-Key', uuidv4())
      .send({});
    expect(submitRes.status).toBe(200);

    // Approve (no anomaly flags on bare listing)
    const approveNonce = await generateNonce('approve', BigInt(merchantId), testKnex);
    const approveRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/approve`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('X-CSRF-Token', merchantCsrf)
      .set('X-Nonce', approveNonce)
      .set('Idempotency-Key', uuidv4())
      .send({});
    expect(approveRes.status).toBe(200);

    // Attempt to publish → should fail with VALIDATION_ERROR about missing fields
    const publishNonce = await generateNonce('publish', BigInt(merchantId), testKnex);
    const publishRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/publish`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('X-CSRF-Token', merchantCsrf)
      .set('X-Nonce', publishNonce)
      .set('Idempotency-Key', uuidv4())
      .send({});
    expect(publishRes.status).toBe(400);
    expect(publishRes.body.error.code).toBe('VALIDATION_ERROR');
    expect(publishRes.body.error.details).toHaveProperty('fields');
  });
});

describe('Anomaly flag approval', () => {
  it('approve with anomaly flags but no overrideReason → ILLEGAL_TRANSITION', async () => {
    const app = createTestApp();

    const { accessToken: userToken, userId, csrf: userCsrf } = await createUserAndLogin({ role: 'regular_user', officeId: 1 });
    const { accessToken: merchantToken, userId: merchantId, csrf: merchantCsrf } = await createUserAndLogin({ role: 'merchant', officeId: 1 });

    // Create a listing with anomaly flags (use a price that triggers anomaly)
    const createRes = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-CSRF-Token', userCsrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        address_line: '99 Anomaly Blvd',
        city: 'Test City',
        state_code: 'TX',
        postal_code: '75001',
        beds: 2,
        baths: 1,
        // Extreme price/area ratio to trigger anomaly
        price_usd_cents: 1,
        area_sqft: 100000,
      });
    expect(createRes.status).toBe(201);
    const listingId = createRes.body.data.id;

    // Manually inject anomaly flags into DB
    await testKnex('listings').where({ id: listingId }).update({
      anomaly_flags: JSON.stringify(['price_per_sqft_low']),
    });

    // Submit
    await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/submit`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-CSRF-Token', userCsrf)
      .set('Idempotency-Key', uuidv4())
      .send({});

    // Approve without overrideReason → ILLEGAL_TRANSITION
    const approveNonce = await generateNonce('approve', BigInt(merchantId), testKnex);
    const approveRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/approve`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('X-CSRF-Token', merchantCsrf)
      .set('X-Nonce', approveNonce)
      .set('Idempotency-Key', uuidv4())
      .send({});
    expect(approveRes.status).toBe(422);
    expect(approveRes.body.error.code).toBe('ILLEGAL_TRANSITION');
  });

  it('approve with anomaly flags and overrideReason (>= 10 chars) → succeeds', async () => {
    const app = createTestApp();

    const { accessToken: userToken, userId, csrf: userCsrf } = await createUserAndLogin({ role: 'regular_user', officeId: 1 });
    const { accessToken: merchantToken, userId: merchantId, csrf: merchantCsrf } = await createUserAndLogin({ role: 'merchant', officeId: 1 });

    const createRes = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-CSRF-Token', userCsrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        address_line: '101 Override St',
        city: 'Override City',
        state_code: 'TX',
        postal_code: '75002',
        beds: 2,
        baths: 1,
        price_usd_cents: 1,
        area_sqft: 100000,
      });
    expect(createRes.status).toBe(201);
    const listingId = createRes.body.data.id;

    // Inject anomaly flags
    await testKnex('listings').where({ id: listingId }).update({
      anomaly_flags: JSON.stringify(['price_per_sqft_low']),
    });

    // Submit
    await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/submit`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-CSRF-Token', userCsrf)
      .set('Idempotency-Key', uuidv4())
      .send({});

    // Approve with overrideReason
    const approveNonce = await generateNonce('approve', BigInt(merchantId), testKnex);
    const approveRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/approve`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('X-CSRF-Token', merchantCsrf)
      .set('X-Nonce', approveNonce)
      .set('Idempotency-Key', uuidv4())
      .send({ overrideReason: 'Price discrepancy verified by manager approval' });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.status).toBe('approved');
  });
});

describe('Publish a draft directly → ILLEGAL_TRANSITION', () => {
  it('cannot publish a draft listing', async () => {
    const app = createTestApp();
    const { accessToken: merchantToken, userId: merchantId, csrf: merchantCsrf } = await createUserAndLogin({ role: 'merchant', officeId: 1 });

    // Create listing directly as merchant (draft)
    const createRes = await supertest(app.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('X-CSRF-Token', merchantCsrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        address_line: '42 Draft St',
        city: 'Draft City',
        state_code: 'CA',
        postal_code: '90210',
        beds: 2,
        baths: 1,
        price_usd_cents: 500000,
        area_sqft: 1000,
      });
    expect(createRes.status).toBe(201);
    const listingId = createRes.body.data.id;
    expect(createRes.body.data.status).toBe('draft');

    // Try to publish directly (without going through approve)
    const publishNonce = await generateNonce('publish', BigInt(merchantId), testKnex);
    const publishRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/publish`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('X-CSRF-Token', merchantCsrf)
      .set('X-Nonce', publishNonce)
      .set('Idempotency-Key', uuidv4())
      .send({});
    expect(publishRes.status).toBe(422);
    expect(publishRes.body.error.code).toBe('ILLEGAL_TRANSITION');
  });
});
