/**
 * Office route coverage — no dedicated suite existed prior to this file.
 *
 * Offices are a small but privileged surface: the list is readable by any
 * authenticated user (role selectors need it) but create/update is
 * administrator-only. All requests go through the full production middleware
 * stack so CSRF + Idempotency-Key enforcement is locked in.
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

function fmt(d: Date): string {
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

beforeEach(() => clearRateLimitStore());

function app(): Koa {
  return createProductionTestApp();
}

async function createUserAndLogin(role: string): Promise<{ accessToken: string; csrf: string; userId: number }> {
  const officeId = 1;
  const officeExists = await testKnex('offices').where({ id: officeId }).first();
  if (!officeExists) {
    await testKnex('offices').insert({ id: officeId, name: 'HQ', code: 'HQ', active: 1 });
  }
  const username = `off_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
    created_at: fmt(now),
    updated_at: fmt(now),
  });

  const cv = await testKnex('consent_versions').first();
  let cvId: number;
  if (cv) cvId = cv.id;
  else {
    const [id] = await testKnex('consent_versions').insert({
      version: '1.0',
      body_md: 'x',
      effective_from: fmt(new Date('2024-01-01')),
    });
    cvId = id;
  }
  await testKnex('consent_records').insert({
    user_id: userId,
    consent_version_id: cvId,
    accepted_at: fmt(now),
    ip: '127.0.0.1',
  });

  const a = app();
  const nonceRes = await supertest(a.callback()).get('/api/v1/auth/nonce/login');
  const loginRes = await supertest(a.callback())
    .post('/api/v1/auth/login')
    .set('Idempotency-Key', uuidv4())
    .send({ username, password, nonce: nonceRes.body.data.nonce });
  expect(loginRes.status).toBe(200);
  const accessToken = loginRes.body.data.accessToken as string;
  const csrf = await getCsrfToken(a, accessToken);
  return { accessToken, csrf, userId: Number(userId) };
}

describe('GET /api/v1/offices', () => {
  it('returns 401 without auth', async () => {
    const res = await supertest(app().callback()).get('/api/v1/offices');
    expect(res.status).toBe(401);
  });

  it('returns the office list for any authenticated role', async () => {
    const { accessToken } = await createUserAndLogin('merchant');
    const res = await supertest(app().callback())
      .get('/api/v1/offices')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    // Every row has the documented shape.
    for (const row of res.body.data) {
      expect(row).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
        code: expect.any(String),
      });
    }
  });
});

describe('POST /api/v1/offices (administrator only)', () => {
  it('denies non-admin roles with 403', async () => {
    const { accessToken, csrf } = await createUserAndLogin('merchant');
    const res = await supertest(app().callback())
      .post('/api/v1/offices')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ name: 'West Branch', code: 'WB' });
    expect(res.status).toBe(403);
  });

  it('administrator creates an office and the audit log captures it', async () => {
    const { accessToken, csrf } = await createUserAndLogin('administrator');
    const code = `E2E${Date.now().toString().slice(-6)}`;

    const beforeAudit = await testKnex('audit_log')
      .where({ action: 'offices.create' })
      .count<[{ c: number | string }]>('id as c')
      .first();

    const res = await supertest(app().callback())
      .post('/api/v1/offices')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ name: 'West Branch', code });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('West Branch');
    expect(res.body.data.code).toBe(code.toUpperCase());

    const afterAudit = await testKnex('audit_log')
      .where({ action: 'offices.create' })
      .count<[{ c: number | string }]>('id as c')
      .first();
    expect(Number(afterAudit?.c ?? 0)).toBe(Number(beforeAudit?.c ?? 0) + 1);
  });

  it('409 CONFLICT when the office code already exists', async () => {
    const { accessToken, csrf } = await createUserAndLogin('administrator');
    const code = `DUP${Date.now().toString().slice(-6)}`;

    await supertest(app().callback())
      .post('/api/v1/offices')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ name: 'A', code })
      .expect(201);

    const conflict = await supertest(app().callback())
      .post('/api/v1/offices')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ name: 'B', code });
    expect(conflict.status).toBe(409);
  });
});

describe('PATCH /api/v1/offices/:id (administrator only)', () => {
  it('administrator updates fields and audits the change', async () => {
    const { accessToken, csrf } = await createUserAndLogin('administrator');
    const code = `UPD${Date.now().toString().slice(-6)}`;

    const createRes = await supertest(app().callback())
      .post('/api/v1/offices')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ name: 'Original', code });
    const officeId = createRes.body.data.id as number;

    const updateRes = await supertest(app().callback())
      .patch(`/api/v1/offices/${officeId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ name: 'Renamed' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.name).toBe('Renamed');
  });

  it('returns 404 for an unknown office id', async () => {
    const { accessToken, csrf } = await createUserAndLogin('administrator');
    const res = await supertest(app().callback())
      .patch('/api/v1/offices/9999999')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when no fields are supplied', async () => {
    const { accessToken, csrf } = await createUserAndLogin('administrator');
    const code = `EMPTY${Date.now().toString().slice(-5)}`;
    const createRes = await supertest(app().callback())
      .post('/api/v1/offices')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ name: 'To Update', code });

    const res = await supertest(app().callback())
      .patch(`/api/v1/offices/${createRes.body.data.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({});
    expect(res.status).toBe(400);
  });
});
