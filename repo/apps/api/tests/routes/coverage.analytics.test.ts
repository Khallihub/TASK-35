/**
 * Coverage tests for analytics download + admin endpoints:
 *   GET  /api/v1/analytics/exports/:jobId/download
 *   POST /api/v1/admin/risk/:userId/penalty
 *   GET  /api/v1/admin/blacklist
 *   GET  /api/v1/admin/job-runs
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
import { storageRepository } from '../../src/storage/repository';

// No jest.mock of storage/repository — tests pre-seed the real encrypted
// filesystem storage (scoped to a per-worker tmp dir via tests/setupEnv.ts)
// so the download route exercises the full production read path.
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
    await testKnex('offices').insert({ id, name: 'Test Office', code: `COVN${id}`, active: 1 });
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

async function createUserAndLogin(role: string): Promise<{
  accessToken: string;
  csrf: string;
  userId: number;
}> {
  await ensureOffice(1);
  const username = `cov_ana_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

describe('GET /api/v1/analytics/exports/:jobId/download', () => {
  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback()).get('/api/v1/analytics/exports/1/download');
    expect(res.status).toBe(401);
  });

  it('returns 400 when job is not completed', async () => {
    const { accessToken, userId } = await createUserAndLogin('operations');
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
      .get(`/api/v1/analytics/exports/${jobId}/download`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });

  it('returns CSV bytes and sha256 header for completed job owner', async () => {
    const { accessToken, userId } = await createUserAndLogin('operations');
    const now = new Date();
    const csvBody = Buffer.from('date,metric,value\n2024-01-01,new_users,5\n');
    const storageKey = `exports/cov/${Date.now()}_kpi_daily.csv`;
    await storageRepository.write(storageKey, csvBody);
    const sha = require('crypto').createHash('sha256').update(csvBody).digest('hex');

    const [jobId] = await testKnex('export_jobs').insert({
      requested_by: userId,
      params_json: JSON.stringify({ grain: 'daily', from: '2024-01-01', to: '2024-01-31' }),
      status: 'completed',
      file_key: storageKey,
      sha256: sha,
      bytes: csvBody.length,
      attempt_count: 1,
      requested_at: formatDatetime(now),
      completed_at: formatDatetime(now),
      expires_at: formatDatetime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
    });

    const app = createTestApp();
    const res = await supertest(app.callback())
      .get(`/api/v1/analytics/exports/${jobId}/download`)
      .set('Authorization', `Bearer ${accessToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['x-sha256']).toBe(sha);
    expect(res.headers['content-disposition']).toMatch(/attachment;\s+filename=/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).toString()).toBe(csvBody.toString());
  });

  it('returns 403 when operator is not owner and not admin', async () => {
    const owner = await createUserAndLogin('operations');
    const other = await createUserAndLogin('operations');
    const now = new Date();
    const csvBody = Buffer.from('date,metric\n2024-01-01,new_users\n');
    const storageKey = `exports/cov/${Date.now()}_other.csv`;
    await storageRepository.write(storageKey, csvBody);
    const sha = require('crypto').createHash('sha256').update(csvBody).digest('hex');
    const [jobId] = await testKnex('export_jobs').insert({
      requested_by: owner.userId,
      params_json: JSON.stringify({ grain: 'daily', from: '2024-01-01', to: '2024-01-31' }),
      status: 'completed',
      file_key: storageKey,
      sha256: sha,
      bytes: csvBody.length,
      attempt_count: 1,
      requested_at: formatDatetime(now),
      completed_at: formatDatetime(now),
      expires_at: formatDatetime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
    });

    const app = createTestApp();
    const res = await supertest(app.callback())
      .get(`/api/v1/analytics/exports/${jobId}/download`)
      .set('Authorization', `Bearer ${other.accessToken}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/admin/risk/:userId/penalty', () => {
  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/admin/risk/1/penalty')
      .set('Idempotency-Key', uuidv4())
      .send({ penaltyType: 'manual' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/admin/risk/1/penalty')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ penaltyType: 'manual' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when penaltyType is missing', async () => {
    const { accessToken, csrf, userId } = await createUserAndLogin('administrator');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post(`/api/v1/admin/risk/${userId}/penalty`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({});
    expect(res.status).toBe(400);
  });

  it('applies penalty and returns updated profile', async () => {
    const { accessToken, csrf, userId } = await createUserAndLogin('administrator');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post(`/api/v1/admin/risk/${userId}/penalty`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ penaltyType: 'policy_violation', detail: { reason: 'suspicious' } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.data.credit_score).toBe('number');
    expect(res.body.data.credit_score).toBeLessThan(100);
  });
});

describe('GET /api/v1/admin/blacklist', () => {
  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback()).get('/api/v1/admin/blacklist');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const { accessToken } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/admin/blacklist')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });

  it('returns list of blacklist entries for admin', async () => {
    const { accessToken } = await createUserAndLogin('administrator');
    const now = new Date();
    await testKnex('blacklist_entries').insert({
      subject_type: 'ip',
      subject_value: `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
      reason: 'test entry',
      created_at: formatDatetime(now),
    });

    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/admin/blacklist')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

describe('Analytics depth coverage (no-mock)', () => {
  it('funnel — 400 when from/to missing', async () => {
    const { accessToken } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/analytics/funnel')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });

  it('funnel — 200 with from/to for operations', async () => {
    const { accessToken } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/analytics/funnel?from=2024-01-01&to=2024-01-31')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('funnel — 200 with officeId filter for administrator', async () => {
    const { accessToken } = await createUserAndLogin('administrator');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/analytics/funnel?from=2024-01-01&to=2024-01-31&officeId=1')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
  });

  it('kpi — 400 when grain is invalid', async () => {
    const { accessToken } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/analytics/kpi?grain=weekly&from=2024-01-01&to=2024-01-01')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });

  it('kpi — 400 when from/to missing', async () => {
    const { accessToken } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/analytics/kpi?grain=daily')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });

  it('kpi — 200 with grain=month + officeId + agentId + metrics filters', async () => {
    const { accessToken } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/analytics/kpi?grain=month&from=2024-01-01&to=2024-01-31&officeId=1&agentId=1&metrics=new_users,promo_clicks')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toBeDefined();
  });

  it('exports POST — 400 when grain is invalid', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/analytics/exports')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ grain: 'weekly', from: '2024-01-01', to: '2024-01-31' });
    expect(res.status).toBe(400);
  });

  it('exports POST — 400 when from/to missing', async () => {
    const { accessToken, csrf } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/analytics/exports')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ grain: 'daily' });
    expect(res.status).toBe(400);
  });

  it('exports GET — 400 on invalid jobId path', async () => {
    const { accessToken } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/analytics/exports/not-a-number')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });

  it('exports download — 400 on invalid jobId path', async () => {
    const { accessToken } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/analytics/exports/not-a-number/download')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/admin/job-runs', () => {
  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback()).get('/api/v1/admin/job-runs');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const { accessToken } = await createUserAndLogin('operations');
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/admin/job-runs')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });

  it('returns recent job runs for admin', async () => {
    const { accessToken } = await createUserAndLogin('administrator');
    const now = new Date();
    await testKnex('job_runs').insert([
      {
        job_name: 'retention.listings_purge',
        status: 'completed',
        started_at: formatDatetime(new Date(now.getTime() - 2000)),
        finished_at: formatDatetime(new Date(now.getTime() - 1000)),
        records_processed: 3,
      },
      {
        job_name: 'audit.verify',
        status: 'failed',
        started_at: formatDatetime(new Date(now.getTime() - 5000)),
        finished_at: formatDatetime(new Date(now.getTime() - 4000)),
        records_processed: 0,
        error_detail: 'boom',
      },
    ]);

    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/admin/job-runs')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    // Returned in started_at desc
    expect(res.body.data[0].started_at >= res.body.data[1].started_at).toBe(true);
  });
});
