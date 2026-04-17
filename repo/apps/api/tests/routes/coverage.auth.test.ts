/**
 * Coverage tests for auth + config endpoints not exercised elsewhere:
 *   GET  /api/v1/config/timezone
 *   POST /api/v1/auth/consent
 *   POST /api/v1/auth/change-password
 *   GET  /api/v1/auth/consent-version
 *   GET  /api/v1/auth/captcha-challenge
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

function createTestApp(): Koa {
  return createProductionTestApp();
}

beforeEach(() => {
  clearRateLimitStore();
});

async function ensureConsentVersion(): Promise<number> {
  const existing = await testKnex('consent_versions').orderBy('effective_from', 'desc').first();
  if (existing) return existing.id;
  const [id] = await testKnex('consent_versions').insert({
    version: '1.0',
    body_md: 'Test consent body',
    effective_from: new Date('2024-01-01'),
  });
  return id;
}

async function seedUser(overrides: {
  role?: string;
  recordConsent?: boolean;
  password?: string;
} = {}): Promise<{ id: number; username: string; password: string; cvId: number }> {
  const username = `cov_auth_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = overrides.password ?? 'OrigPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();
  const [id] = await testKnex('users').insert({
    username,
    password_hash: hash,
    role: overrides.role ?? 'regular_user',
    office_id: 1,
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: now,
    updated_at: now,
  });
  const cvId = await ensureConsentVersion();
  if (overrides.recordConsent !== false) {
    await testKnex('consent_records').insert({
      user_id: id,
      consent_version_id: cvId,
      accepted_at: now,
      ip: '127.0.0.1',
    });
  }
  const officeExists = await testKnex('offices').where({ id: 1 }).first();
  if (!officeExists) {
    await testKnex('offices').insert({ id: 1, name: 'Test Office', code: 'COV1', active: 1 });
  }
  return { id: Number(id), username, password, cvId };
}

async function login(app: Koa, username: string, password: string): Promise<string> {
  const nonceRes = await supertest(app.callback()).get('/api/v1/auth/nonce/login');
  const nonce = nonceRes.body.data.nonce;
  const loginRes = await supertest(app.callback())
    .post('/api/v1/auth/login')
    .set('Idempotency-Key', uuidv4())
    .send({ username, password, nonce });
  expect(loginRes.status).toBe(200);
  return loginRes.body.data.accessToken as string;
}

describe('GET /api/v1/config/timezone', () => {
  it('returns timezone as public endpoint', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback()).get('/api/v1/config/timezone');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.data.timezone).toBe('string');
    expect(res.body.data.timezone.length).toBeGreaterThan(0);
  });
});

describe('GET /api/v1/auth/consent-version', () => {
  it('returns seeded consent version when present', async () => {
    await ensureConsentVersion();
    const app = createTestApp();
    const res = await supertest(app.callback()).get('/api/v1/auth/consent-version');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.version).toBeDefined();
    expect(typeof res.body.data.body_md).toBe('string');
  });
});

describe('GET /api/v1/auth/captcha-challenge', () => {
  it('returns a challenge token + question', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback()).get('/api/v1/auth/captcha-challenge');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.data.question).toBe('string');
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.token.length).toBeGreaterThan(0);
  });
});

describe('POST /api/v1/auth/consent', () => {
  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/auth/consent')
      .set('Idempotency-Key', uuidv4())
      .send({ versionId: 1 });
    expect(res.status).toBe(401);
  });

  it('returns 400 without versionId', async () => {
    const user = await seedUser();
    const app = createTestApp();
    const accessToken = await login(app, user.username, user.password);
    const csrf = await getCsrfToken(app, accessToken);

    const res = await supertest(app.callback())
      .post('/api/v1/auth/consent')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for unknown consent version', async () => {
    const user = await seedUser();
    const app = createTestApp();
    const accessToken = await login(app, user.username, user.password);
    const csrf = await getCsrfToken(app, accessToken);

    const res = await supertest(app.callback())
      .post('/api/v1/auth/consent')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ versionId: 999999 });
    expect(res.status).toBe(404);
  });

  it('records consent for the user on success', async () => {
    // Seed a user WITHOUT a pre-existing consent record
    const user = await seedUser({ recordConsent: false });
    const app = createTestApp();
    const accessToken = await login(app, user.username, user.password);
    const csrf = await getCsrfToken(app, accessToken);

    const before = await testKnex('consent_records').where({ user_id: user.id }).count<{ n: number }[]>('id as n');

    const res = await supertest(app.callback())
      .post('/api/v1/auth/consent')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ versionId: user.cvId });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const after = await testKnex('consent_records').where({ user_id: user.id }).count<{ n: number }[]>('id as n');
    expect(Number(after[0].n)).toBe(Number(before[0].n) + 1);
  });
});

describe('POST /api/v1/auth/login — validation depth', () => {
  it('returns 400 when username is missing', async () => {
    const app = createTestApp();
    const nonceRes = await supertest(app.callback()).get('/api/v1/auth/nonce/login');
    const res = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ password: 'x', nonce: nonceRes.body.data.nonce });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: 'x' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when nonce is missing', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: 'x', password: 'y' });
    expect(res.status).toBe(400);
  });

  it('rejects login via IP blacklist with generic error', async () => {
    // Insert the test IP (127.0.0.1) into the blacklist
    const now = new Date();
    await testKnex('blacklist_entries').insert({
      subject_type: 'ip',
      subject_value: '::ffff:127.0.0.1',
      reason: 'test',
      created_at: now.toISOString(),
    });
    await testKnex('blacklist_entries').insert({
      subject_type: 'ip',
      subject_value: '127.0.0.1',
      reason: 'test',
      created_at: now.toISOString(),
    });

    const user = await seedUser();
    const app = createTestApp();
    const nonceRes = await supertest(app.callback()).get('/api/v1/auth/nonce/login');
    const res = await supertest(app.callback())
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuidv4())
      .send({ username: user.username, password: user.password, nonce: nonceRes.body.data.nonce });
    expect(res.status).toBe(401);

    await testKnex('blacklist_entries').where({ subject_type: 'ip' }).delete();
  });
});

describe('GET /api/v1/auth/nonce/:purpose — validation depth', () => {
  it('returns 400 for an unrecognised purpose', async () => {
    const user = await seedUser();
    const app = createTestApp();
    const accessToken = await login(app, user.username, user.password);
    const res = await supertest(app.callback())
      .get('/api/v1/auth/nonce/bogus_purpose')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/auth/consent-version — fallback path', () => {
  it('returns a default payload when no consent_version rows exist', async () => {
    // Clean consent_versions and consent_records to force the fallback branch.
    await testKnex('consent_records').delete();
    await testKnex('consent_versions').delete();

    const app = createTestApp();
    const res = await supertest(app.callback()).get('/api/v1/auth/consent-version');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.id).toBe(0);
    expect(res.body.data.version).toBe('1.0');
    expect(typeof res.body.data.body_md).toBe('string');
    expect(res.body.data.body_md.length).toBeGreaterThan(0);

    // Re-seed so later suites still pass.
    await ensureConsentVersion();
  });
});

describe('POST /api/v1/auth/change-password', () => {
  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/auth/change-password')
      .set('Idempotency-Key', uuidv4())
      .send({ currentPassword: 'x', newPassword: 'y', nonce: 'z' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when required fields missing', async () => {
    const user = await seedUser();
    const app = createTestApp();
    const accessToken = await login(app, user.username, user.password);
    const csrf = await getCsrfToken(app, accessToken);

    const res = await supertest(app.callback())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ currentPassword: user.password });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 on wrong current password', async () => {
    const user = await seedUser();
    const app = createTestApp();
    const accessToken = await login(app, user.username, user.password);
    const csrf = await getCsrfToken(app, accessToken);
    const nonce = await generateNonce('change_password', BigInt(user.id), testKnex);

    const res = await supertest(app.callback())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        currentPassword: 'WrongPass@123!',
        newPassword: 'NewStrong@456!',
        nonce,
      });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 400 when new password violates policy', async () => {
    const user = await seedUser();
    const app = createTestApp();
    const accessToken = await login(app, user.username, user.password);
    const csrf = await getCsrfToken(app, accessToken);
    const nonce = await generateNonce('change_password', BigInt(user.id), testKnex);

    const res = await supertest(app.callback())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        currentPassword: user.password,
        newPassword: 'short',
        nonce,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('changes password and returns new tokens on success', async () => {
    const user = await seedUser();
    const app = createTestApp();
    const accessToken = await login(app, user.username, user.password);
    const csrf = await getCsrfToken(app, accessToken);
    const nonce = await generateNonce('change_password', BigInt(user.id), testKnex);

    const newPassword = 'NewStrong@456!';
    const res = await supertest(app.callback())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        currentPassword: user.password,
        newPassword,
        nonce,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();

    // Old sessions are revoked; can log in again with new password
    const app2 = createTestApp();
    const relog = await login(app2, user.username, newPassword);
    expect(typeof relog).toBe('string');
  });
});
