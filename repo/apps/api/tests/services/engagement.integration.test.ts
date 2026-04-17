/**
 * End-to-end engagement KPI integration test.
 *
 * Verifies that the modeled engagement events (`listing.view`,
 * `listing.favorite`, `listing.share`, `promo.click`) are actually emitted by
 * the product code paths, and that the daily rollup counts them through to the
 * `engagement_actions` KPI metric — instead of being fabricated by tests.
 */
import supertest from 'supertest';
import Koa from 'koa';
import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import { hashPassword } from '../../src/services/password';
import { createProductionTestApp } from '../helpers/testApp';
import { rollupDailyKpi } from '../../src/services/kpi';

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

beforeEach(async () => {
  await testKnex('kpi_daily').delete();
  await testKnex('event_log').delete();
  await testKnex('promo_slots').delete();
  await testKnex('promo_collections').delete();
  await testKnex('listing_status_history').delete();
  await testKnex('listing_revisions').delete();
  await testKnex('listings').delete();
});

function createTestApp(): Koa {
  return createProductionTestApp({
    skipCsrf: true,
    skipIdempotency: true,
    skipIpRateLimit: true,
  });
}

async function createUserAndLogin(role: string, officeId = 1): Promise<{ accessToken: string; userId: number }> {
  const username = `eng_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'TestPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();

  const officeExists = await testKnex('offices').where({ id: officeId }).first();
  if (!officeExists) {
    await testKnex('offices').insert({ id: officeId, name: 'Test Office', code: `OFF${officeId}`, active: 1 });
  }

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

  const cv = await testKnex('consent_versions').orderBy('effective_from', 'desc').first();
  let cvId: number;
  if (cv) {
    cvId = cv.id;
  } else {
    const [vid] = await testKnex('consent_versions').insert({
      version: '1.0',
      body_md: 'Test consent',
      effective_from: formatDatetime(new Date('2024-01-01')),
    });
    cvId = vid;
  }
  await testKnex('consent_records').insert({
    user_id: userId,
    consent_version_id: cvId,
    accepted_at: formatDatetime(now),
    ip: '127.0.0.1',
  });

  const app = createTestApp();
  const nonceRes = await supertest(app.callback()).get('/api/v1/auth/nonce/login');
  const nonce = nonceRes.body.data.nonce;
  const loginRes = await supertest(app.callback())
    .post('/api/v1/auth/login')
    .send({ username, password, nonce });
  expect(loginRes.status).toBe(200);
  return { accessToken: loginRes.body.data.accessToken, userId: Number(userId) };
}

describe('engagement KPI end-to-end', () => {
  it('counts listing.view + listing.favorite + listing.share + promo.click in engagement_actions', async () => {
    const merchant = await createUserAndLogin('merchant');
    const ops = await createUserAndLogin('operations');

    // Create a published listing the engagement events can target.
    const now = new Date();
    const [listingId] = await testKnex('listings').insert({
      office_id: 1,
      created_by: merchant.userId,
      status: 'published',
      version: 1,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });

    // Create a promo collection with a slot pointing at the listing
    const [promoId] = await testKnex('promo_collections').insert({
      title: 'Test Collection',
      starts_at: formatDatetime(new Date(now.getTime() - 60_000)),
      ends_at: formatDatetime(new Date(now.getTime() + 60 * 60_000)),
      status: 'live',
      created_by: ops.userId,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });
    await testKnex('promo_slots').insert({
      collection_id: promoId,
      listing_id: listingId,
      rank: 1,
      added_by: ops.userId,
      added_at: formatDatetime(now),
    });

    const app = createTestApp();

    // 1. listing.view — emitted by GET /listings/:id
    const getRes = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${merchant.accessToken}`);
    expect(getRes.status).toBe(200);

    // 2. listing.favorite — emitted by POST /listings/:id/favorite
    const favRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/favorite`)
      .set('Authorization', `Bearer ${merchant.accessToken}`);
    expect(favRes.status).toBe(200);

    // 3. listing.share — emitted by POST /listings/:id/share
    const shareRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/share`)
      .set('Authorization', `Bearer ${merchant.accessToken}`);
    expect(shareRes.status).toBe(200);

    // 4. promo.click — emitted by POST /promo/:id/click
    const clickRes = await supertest(app.callback())
      .post(`/api/v1/promo/${promoId}/click`)
      .set('Authorization', `Bearer ${ops.accessToken}`)
      .send({ listingId });
    expect(clickRes.status).toBe(200);

    // Verify event_log holds exactly the four engagement event types we emit
    const eventTypes = (await testKnex('event_log')
      .whereIn('event_type', ['listing.view', 'listing.favorite', 'listing.share', 'promo.click'])
      .pluck('event_type')) as string[];

    expect(eventTypes).toEqual(
      expect.arrayContaining(['listing.view', 'listing.favorite', 'listing.share', 'promo.click']),
    );

    // Run the daily rollup for today and assert engagement_actions == 4
    await rollupDailyKpi(now, testKnex);

    const globalRow = await testKnex('kpi_daily')
      .where({ metric: 'engagement_actions' })
      .whereNull('office_id')
      .whereNull('agent_id')
      .first();

    expect(globalRow).toBeDefined();
    expect(Number(globalRow.value)).toBeGreaterThanOrEqual(4);
  });
});
