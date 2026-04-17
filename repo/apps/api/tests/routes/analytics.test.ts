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

/**
 * Build the Koa app via the production-mirror factory — full stack, no
 * skips. Analytics writes (export creation) now exercise CSRF +
 * Idempotency-Key + IP rate limiting end-to-end.
 */
function createTestApp(): Koa {
  return createProductionTestApp();
}

beforeEach(() => {
  clearRateLimitStore();
});

let consentVersionId: number;

async function createUserAndLogin(role: string, officeId?: number): Promise<{ accessToken: string; userId: number; csrf: string }> {
  const username = `analyticsuser_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'TestPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();

  // Ensure office exists
  const effectiveOfficeId = officeId ?? 1;
  const officeExists = await testKnex('offices').where({ id: effectiveOfficeId }).first();
  if (!officeExists) {
    await testKnex('offices').insert({ id: effectiveOfficeId, name: `Office ${effectiveOfficeId}`, code: `AO${effectiveOfficeId}`, active: 1 });
  }

  const [userId] = await testKnex('users').insert({
    username,
    password_hash: hash,
    role,
    office_id: effectiveOfficeId,
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: formatDatetime(now),
    updated_at: formatDatetime(now),
  });

  // Create consent version if needed
  if (!consentVersionId) {
    const cv = await testKnex('consent_versions').first();
    if (cv) {
      consentVersionId = cv.id;
    } else {
      const [vid] = await testKnex('consent_versions').insert({
        version: '1.0',
        body_md: 'Test consent',
        effective_from: formatDatetime(new Date('2024-01-01')),
      });
      consentVersionId = vid;
    }
  }

  await testKnex('consent_records').insert({
    user_id: userId,
    consent_version_id: consentVersionId,
    accepted_at: formatDatetime(now),
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
  return { accessToken, userId: Number(userId), csrf };
}

describe('GET /api/v1/analytics/kpi', () => {
  beforeEach(async () => {
    await testKnex('kpi_daily').delete();
  });

  it('returns KPI data for operations user', async () => {
    const { accessToken } = await createUserAndLogin('operations');

    await testKnex('kpi_daily').insert([
      { grain_date: '2024-01-01', office_id: null, agent_id: null, metric: 'new_users', value: 5 },
    ]);

    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/analytics/kpi?grain=daily&from=2024-01-01&to=2024-01-01')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.rows).toBeDefined();
    expect(res.body.data.funnel).toBeDefined();
  });

  it('returns 403 for regular_user', async () => {
    const { accessToken } = await createUserAndLogin('regular_user');

    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/analytics/kpi?grain=daily&from=2024-01-01&to=2024-01-01')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 403 for merchant with null office_id', async () => {
    // Create a merchant with null office_id directly in DB (bypassing validation)
    const username = `merchant_nooffice_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const password = 'TestPass@123!';
    const hash = await hashPassword(password);
    const now = new Date();

    const [userId] = await testKnex('users').insert({
      username,
      password_hash: hash,
      role: 'merchant',
      office_id: null,
      status: 'active',
      failed_login_count: 0,
      must_change_password: 0,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });

    if (!consentVersionId) {
      const cv = await testKnex('consent_versions').first();
      if (cv) {
        consentVersionId = cv.id;
      } else {
        const [vid] = await testKnex('consent_versions').insert({
          version: '1.0',
          body_md: 'Test consent',
          effective_from: formatDatetime(new Date('2024-01-01')),
        });
        consentVersionId = vid;
      }
    }

    await testKnex('consent_records').insert({
      user_id: userId,
      consent_version_id: consentVersionId,
      accepted_at: formatDatetime(now),
      ip: '127.0.0.1',
    });

    const app = createTestApp();
    const nonceRes = await supertest(app.callback()).get('/api/v1/auth/nonce/login');
    const loginNonce = nonceRes.body.data.nonce;
    const loginRes = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username, password, nonce: loginNonce });

    expect(loginRes.status).toBe(200);
    const { accessToken } = loginRes.body.data;

    const res = await supertest(app.callback())
      .get('/api/v1/analytics/kpi?grain=daily&from=2024-01-01&to=2024-01-01')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 403 for merchant (analytics is ops/admin only per product brief)', async () => {
    const { accessToken } = await createUserAndLogin('merchant', 1);

    await testKnex('kpi_daily').insert([
      { grain_date: '2024-01-01', office_id: 1, agent_id: null, metric: 'new_users', value: 5 },
    ]);

    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/analytics/kpi?grain=daily&from=2024-01-01&to=2024-01-01')
      .set('Authorization', `Bearer ${accessToken}`);

    // Analytics access was previously widened to include merchants; the
    // prompt assigns KPI monitoring + exports to Operations only. The
    // route gate (canAccessAnalytics) enforces ops/admin, and this test
    // locks that boundary in place.
    expect(res.status).toBe(403);
  });

  it('returns 403 for merchant on funnel endpoint too', async () => {
    const { accessToken } = await createUserAndLogin('merchant', 1);
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/analytics/funnel?from=2024-01-01&to=2024-01-01')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 403 for merchant on export creation', async () => {
    const { accessToken, csrf } = await createUserAndLogin('merchant', 1);
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/analytics/exports')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ grain: 'daily', from: '2024-01-01', to: '2024-01-31' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/analytics/exports', () => {
  it('creates export job and returns 202', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');

    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/analytics/exports')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        grain: 'daily',
        from: '2024-01-01',
        to: '2024-01-31',
      });

    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.jobId).toBeDefined();
    expect(res.body.data.status).toBe('queued');
  });
});

describe('GET /api/v1/analytics/exports/:jobId', () => {
  it('returns job status', async () => {
    const { accessToken, userId } = await createUserAndLogin('operations');

    // Create export job directly
    const now = new Date();
    const [jobId] = await testKnex('export_jobs').insert({
      requested_by: userId,
      params_json: JSON.stringify({ grain: 'daily', from: '2024-01-01', to: '2024-01-31' }),
      status: 'queued',
      attempt_count: 0,
      requested_at: formatDatetime(now),
      expires_at: formatDatetime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
    });

    const app = createTestApp();
    const res = await supertest(app.callback())
      .get(`/api/v1/analytics/exports/${jobId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.id).toBe(jobId);
    expect(res.body.data.status).toBe('queued');
    // Internal storage metadata MUST NOT leak through the export-job
    // status endpoint — clients use `downloadUrl` (set on completed jobs)
    // to fetch the CSV. See exportService.ts#toPublicExportJob.
    expect(res.body.data).not.toHaveProperty('file_key');
    expect(res.body.data).not.toHaveProperty('sha256');
    expect(res.body.data).not.toHaveProperty('last_error');
    expect(res.body.data).not.toHaveProperty('attempt_count');
    expect(res.body.data).not.toHaveProperty('requested_by');
    expect(res.body.data).not.toHaveProperty('params_json');
  });
});
