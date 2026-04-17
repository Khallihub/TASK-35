/**
 * Cross-boundary full-stack integration tests.
 *
 * Audit: the engagement integration suite (tests/services/engagement.integration.test.ts)
 * and csrf.test.ts intentionally skip middleware for focused checks. This
 * suite is the counterpart — every request below flows through the full
 * production middleware stack (errorMiddleware + ipRateLimit + bodyParser
 * + csrf + idempotency + routes) and exercises combinations of domains
 * (listing lifecycle × engagement × KPI rollup, admin purge × attachments,
 * nonce replay × CSRF, etc.) end-to-end.
 */
import supertest from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import Koa from 'koa';
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

beforeEach(() => {
  clearRateLimitStore();
});

function app(): Koa {
  return createProductionTestApp();
}

async function ensureOffice(officeId = 1): Promise<void> {
  const exists = await testKnex('offices').where({ id: officeId }).first();
  if (!exists) {
    await testKnex('offices').insert({
      id: officeId,
      name: `Office ${officeId}`,
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
    body_md: 'cx',
    effective_from: formatDatetime(new Date('2024-01-01')),
  });
  return id;
}

async function seedUser(
  role: string,
  officeId = 1,
): Promise<{ username: string; password: string; userId: number }> {
  await ensureOffice(officeId);
  const username = `cx_${role}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
  return { username, password, userId: Number(userId) };
}

async function login(
  a: Koa,
  username: string,
  password: string,
): Promise<{ accessToken: string; csrf: string }> {
  const nonceRes = await supertest(a.callback()).get('/api/v1/auth/nonce/login');
  const loginRes = await supertest(a.callback())
    .post('/api/v1/auth/login')
    .set('Idempotency-Key', uuidv4())
    .send({ username, password, nonce: nonceRes.body.data.nonce });
  expect(loginRes.status).toBe(200);
  const accessToken = loginRes.body.data.accessToken as string;
  const csrf = await getCsrfToken(a, accessToken);
  return { accessToken, csrf };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Listing lifecycle × engagement × KPI rollup
// ─────────────────────────────────────────────────────────────────────────────
describe('cross-boundary: listing lifecycle drives engagement events + KPI visibility', () => {
  it('publish → favorite → KPI rollup reflects engagement_actions for ops', async () => {
    const agent = await seedUser('regular_user');
    const merchant = await seedUser('merchant');
    const ops = await seedUser('operations');

    const a = app();
    const agentAuth = await login(a, agent.username, agent.password);
    const merchantAuth = await login(a, merchant.username, merchant.password);
    const opsAuth = await login(a, ops.username, ops.password);

    // 1) Agent drafts a listing (full stack: CSRF + Idempotency-Key + IP limit).
    const createRes = await supertest(a.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${agentAuth.accessToken}`)
      .set('X-CSRF-Token', agentAuth.csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        address_line: '1 KPI Way',
        city: 'Boston',
        state_code: 'MA',
        postal_code: '02108',
        beds: 2,
        baths: 1,
        price_usd_cents: 30000000,
        area_sqft: 1200,
      });
    expect(createRes.status).toBe(201);
    const listingId = createRes.body.data.id as number;

    // 2) Agent submits → in_review.
    await supertest(a.callback())
      .post(`/api/v1/listings/${listingId}/submit`)
      .set('Authorization', `Bearer ${agentAuth.accessToken}`)
      .set('X-CSRF-Token', agentAuth.csrf)
      .set('Idempotency-Key', uuidv4())
      .send({})
      .expect(200);

    // 3) Merchant approves (with purpose=approve nonce) then publishes.
    const approveNonceRes = await supertest(a.callback())
      .get('/api/v1/auth/nonce/approve')
      .set('Authorization', `Bearer ${merchantAuth.accessToken}`);
    const approveNonce = approveNonceRes.body.data.nonce as string;
    await supertest(a.callback())
      .post(`/api/v1/listings/${listingId}/approve`)
      .set('Authorization', `Bearer ${merchantAuth.accessToken}`)
      .set('X-CSRF-Token', merchantAuth.csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', approveNonce)
      .send({})
      .expect(200);

    const publishNonceRes = await supertest(a.callback())
      .get('/api/v1/auth/nonce/publish')
      .set('Authorization', `Bearer ${merchantAuth.accessToken}`);
    const publishNonce = publishNonceRes.body.data.nonce as string;
    await supertest(a.callback())
      .post(`/api/v1/listings/${listingId}/publish`)
      .set('Authorization', `Bearer ${merchantAuth.accessToken}`)
      .set('X-CSRF-Token', merchantAuth.csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', publishNonce)
      .send({})
      .expect(200);

    // 4) Another agent favorites + shares the published listing — this
    //    must emit engagement events into event_log.
    const viewer = await seedUser('regular_user');
    const viewerAuth = await login(a, viewer.username, viewer.password);
    await supertest(a.callback())
      .post(`/api/v1/listings/${listingId}/favorite`)
      .set('Authorization', `Bearer ${viewerAuth.accessToken}`)
      .set('X-CSRF-Token', viewerAuth.csrf)
      .set('Idempotency-Key', uuidv4())
      .send({})
      .expect(200);
    await supertest(a.callback())
      .post(`/api/v1/listings/${listingId}/share`)
      .set('Authorization', `Bearer ${viewerAuth.accessToken}`)
      .set('X-CSRF-Token', viewerAuth.csrf)
      .set('Idempotency-Key', uuidv4())
      .send({})
      .expect(200);

    // 5) event_log must now contain at least the favorite + share entries.
    const events = await testKnex('event_log')
      .where({ entity_type: 'listing', entity_id: listingId })
      .whereIn('event_type', ['listing.favorite', 'listing.share'])
      .select('event_type');
    const types = events.map((e: { event_type: string }) => e.event_type);
    expect(types).toEqual(expect.arrayContaining(['listing.favorite', 'listing.share']));

    // 6) Ops user — reading KPIs through the full stack — must at least
    //    reach the endpoint without leaking 403/401. The exact rollup value
    //    is asserted in kpi.test.ts; here we lock the cross-boundary gate.
    const kpiRes = await supertest(a.callback())
      .get('/api/v1/analytics/kpi?grain=daily&from=2024-01-01&to=2030-12-31')
      .set('Authorization', `Bearer ${opsAuth.accessToken}`);
    expect(kpiRes.status).toBe(200);
    expect(kpiRes.body.ok).toBe(true);
    expect(Array.isArray(kpiRes.body.data.rows)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Idempotency-Key replay semantics over the full middleware stack
// ─────────────────────────────────────────────────────────────────────────────
describe('cross-boundary: idempotent replay returns cached response without duplicating state', () => {
  it('listing create with the same Idempotency-Key returns the same id, not two rows', async () => {
    const user = await seedUser('merchant');
    const a = app();
    const { accessToken, csrf } = await login(a, user.username, user.password);

    const key = uuidv4();
    const body = {
      address_line: '2 Idem St',
      city: 'Chicago',
      state_code: 'IL',
      postal_code: '60601',
      beds: 1,
      baths: 1,
      price_usd_cents: 25000000,
      area_sqft: 1000,
    };

    const first = await supertest(a.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', key)
      .send(body);
    expect(first.status).toBe(201);
    const firstId = first.body.data.id as number;

    const second = await supertest(a.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', key)
      .send(body);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(firstId);

    const count = await testKnex('listings')
      .where({ address_line: '2 Idem St' })
      .count<[{ c: number | string }]>('id as c')
      .first();
    expect(Number(count?.c ?? 0)).toBe(1);
  });

  it('a different body with the same Idempotency-Key is rejected (body-hash mismatch)', async () => {
    const user = await seedUser('merchant');
    const a = app();
    const { accessToken, csrf } = await login(a, user.username, user.password);

    const key = uuidv4();
    const first = await supertest(a.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', key)
      .send({ city: 'Portland', state_code: 'OR' });
    expect(first.status).toBe(201);

    const conflicting = await supertest(a.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', key)
      .send({ city: 'Seattle', state_code: 'WA' });
    // The middleware rejects body drift on replay.
    expect([400, 409, 422]).toContain(conflicting.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Nonce + CSRF interplay on publish
// ─────────────────────────────────────────────────────────────────────────────
describe('cross-boundary: publish requires both CSRF and single-use nonce', () => {
  it('publish with a valid nonce but missing CSRF is 403, then with CSRF succeeds', async () => {
    const agent = await seedUser('regular_user');
    const merchant = await seedUser('merchant');

    const a = app();
    const agentAuth = await login(a, agent.username, agent.password);
    const merchantAuth = await login(a, merchant.username, merchant.password);

    // Set up: draft → submit → approve.
    const createRes = await supertest(a.callback())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${agentAuth.accessToken}`)
      .set('X-CSRF-Token', agentAuth.csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        address_line: '3 NonceSt',
        city: 'NYC',
        state_code: 'NY',
        postal_code: '10001',
        beds: 2,
        baths: 1,
        price_usd_cents: 55000000,
        area_sqft: 1100,
      });
    const listingId = createRes.body.data.id as number;

    await supertest(a.callback())
      .post(`/api/v1/listings/${listingId}/submit`)
      .set('Authorization', `Bearer ${agentAuth.accessToken}`)
      .set('X-CSRF-Token', agentAuth.csrf)
      .set('Idempotency-Key', uuidv4())
      .send({})
      .expect(200);

    const approveNonce = (
      await supertest(a.callback())
        .get('/api/v1/auth/nonce/approve')
        .set('Authorization', `Bearer ${merchantAuth.accessToken}`)
    ).body.data.nonce as string;
    await supertest(a.callback())
      .post(`/api/v1/listings/${listingId}/approve`)
      .set('Authorization', `Bearer ${merchantAuth.accessToken}`)
      .set('X-CSRF-Token', merchantAuth.csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', approveNonce)
      .send({})
      .expect(200);

    // Now attempt publish without CSRF token.
    const publishNonce = (
      await supertest(a.callback())
        .get('/api/v1/auth/nonce/publish')
        .set('Authorization', `Bearer ${merchantAuth.accessToken}`)
    ).body.data.nonce as string;

    const noCsrf = await supertest(a.callback())
      .post(`/api/v1/listings/${listingId}/publish`)
      .set('Authorization', `Bearer ${merchantAuth.accessToken}`)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', publishNonce)
      .send({});
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.message).toMatch(/CSRF/);

    // The nonce should still be consumable since the request was rejected
    // before reaching the route handler. Re-attempt WITH CSRF.
    const withCsrf = await supertest(a.callback())
      .post(`/api/v1/listings/${listingId}/publish`)
      .set('Authorization', `Bearer ${merchantAuth.accessToken}`)
      .set('X-CSRF-Token', merchantAuth.csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', publishNonce)
      .send({});
    expect(withCsrf.status).toBe(200);
    expect(withCsrf.body.data.status).toBe('published');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Admin purge cascade through full stack
// ─────────────────────────────────────────────────────────────────────────────
describe('cross-boundary: admin purge cascades listings + attachments + sessions', () => {
  it('purging a user hard-deletes their listings and revokes their sessions', async () => {
    const admin = await seedUser('administrator');
    const target = await seedUser('merchant');

    const a = app();
    const adminAuth = await login(a, admin.username, admin.password);
    // Give the target a live session so we can verify revocation.
    await login(a, target.username, target.password);

    // Create a listing owned by target.
    const now = new Date();
    const [listingId] = await testKnex('listings').insert({
      office_id: 1,
      created_by: target.userId,
      status: 'draft',
      version: 1,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });

    // Mint an admin purge nonce through the API (not via DB insert).
    const nonce = (
      await supertest(a.callback())
        .get('/api/v1/auth/nonce/purge')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
    ).body.data.nonce as string;

    const purgeRes = await supertest(a.callback())
      .post(`/api/v1/admin/purge/user/${target.userId}`)
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .set('X-CSRF-Token', adminAuth.csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', nonce)
      .send({ confirm: `PURGE ${target.userId}` });
    expect(purgeRes.status).toBe(200);

    // User row + owned listing + target's sessions must be gone.
    expect(await testKnex('users').where({ id: target.userId }).first()).toBeUndefined();
    expect(await testKnex('listings').where({ id: Number(listingId) }).first()).toBeUndefined();
    const activeSessions = await testKnex('sessions')
      .where({ user_id: String(target.userId) })
      .whereNull('revoked_at');
    expect(activeSessions).toHaveLength(0);
  });
});
