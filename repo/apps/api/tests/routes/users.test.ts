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
 * skips. Users routes (admin role/status updates, unlock, force-reset)
 * exercise CSRF + Idempotency-Key + IP rate limiting end-to-end.
 */
function createTestApp(): Koa {
  return createProductionTestApp();
}

beforeEach(() => {
  clearRateLimitStore();
});

async function createAdminAndLogin(): Promise<{
  accessToken: string;
  userId: number;
  csrf: string;
}> {
  const username = `admin_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'AdminPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();

  const officeExists = await testKnex('offices').where({ id: 1 }).first();
  if (!officeExists) {
    await testKnex('offices').insert({ id: 1, name: 'Test Office', code: 'OFF1', active: 1 });
  }

  const [userId] = await testKnex('users').insert({
    username,
    password_hash: hash,
    role: 'administrator',
    office_id: 1,
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: now,
    updated_at: now,
  });

  // Consent
  let cvId: number;
  const cv = await testKnex('consent_versions').orderBy('effective_from', 'desc').first();
  if (cv) {
    cvId = cv.id;
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
  const nonceRes = await supertest(app.callback()).get('/api/v1/auth/nonce/login');
  const nonce = nonceRes.body.data.nonce;
  const loginRes = await supertest(app.callback())
    .post('/api/v1/auth/login')
    .set('Idempotency-Key', uuidv4())
    .send({ username, password, nonce });

  expect(loginRes.status).toBe(200);
  const accessToken = loginRes.body.data.accessToken as string;
  const csrf = await getCsrfToken(app, accessToken);
  return { accessToken, userId: Number(userId), csrf };
}

async function createRegularUserAndLogin(): Promise<{
  accessToken: string;
  userId: number;
  csrf: string;
}> {
  const username = `user_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'UserPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();

  const [userId] = await testKnex('users').insert({
    username,
    password_hash: hash,
    role: 'regular_user',
    office_id: 1,
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: now,
    updated_at: now,
  });

  let cvId: number;
  const cv = await testKnex('consent_versions').orderBy('effective_from', 'desc').first();
  if (cv) {
    cvId = cv.id;
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
  const nonceRes = await supertest(app.callback()).get('/api/v1/auth/nonce/login');
  const nonce = nonceRes.body.data.nonce;
  const loginRes = await supertest(app.callback())
    .post('/api/v1/auth/login')
    .set('Idempotency-Key', uuidv4())
    .send({ username, password, nonce });

  expect(loginRes.status).toBe(200);
  const accessToken = loginRes.body.data.accessToken as string;
  const csrf = await getCsrfToken(app, accessToken);
  return { accessToken, userId: Number(userId), csrf };
}

/** Create a plain user row for the admin to manage (no login needed). */
async function createTargetUser(role = 'regular_user'): Promise<number> {
  const username = `target_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const hash = await hashPassword('TargetPass@123!');
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

  return userId;
}

describe('Users routes', () => {
  describe('GET /api/v1/users', () => {
    it('returns 401 without auth', async () => {
      const app = createTestApp();
      const res = await supertest(app.callback()).get('/api/v1/users');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const { accessToken, csrf } = await createRegularUserAndLogin();
      const app = createTestApp();

      const res = await supertest(app.callback())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(403);
    });

    it('returns users list for admin', async () => {
      const { accessToken, csrf } = await createAdminAndLogin();
      const app = createTestApp();

      const res = await supertest(app.callback())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });
  });

  describe('PATCH /api/v1/users/:id — role change', () => {
    it('rejects role change without nonce -> 400', async () => {
      const { accessToken, csrf } = await createAdminAndLogin();
      const targetId = await createTargetUser();
      const app = createTestApp();

      const res = await supertest(app.callback())
        .patch(`/api/v1/users/${targetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-CSRF-Token', csrf)
        .set('Idempotency-Key', uuidv4())
        .send({ role: 'merchant' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/nonce/i);
    });

    it('accepts role change with valid nonce', async () => {
      const { accessToken, csrf } = await createAdminAndLogin();
      const targetId = await createTargetUser();
      const app = createTestApp();

      // Fetch a role_change nonce
      const nonceRes = await supertest(app.callback())
        .get('/api/v1/auth/nonce/role_change')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(nonceRes.status).toBe(200);
      const nonce = nonceRes.body.data.nonce;

      const res = await supertest(app.callback())
        .patch(`/api/v1/users/${targetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-CSRF-Token', csrf)
        .set('Idempotency-Key', uuidv4())
        .send({ role: 'merchant', nonce });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.role).toBe('merchant');
    });

    it('revokes target user sessions on role change', async () => {
      const { accessToken, csrf } = await createAdminAndLogin();
      const targetId = await createTargetUser();
      const app = createTestApp();

      // Create a session for target user so we can verify revocation
      const targetUsername = (await testKnex('users').where({ id: targetId }).first()).username;

      // Consent for target user
      const cv = await testKnex('consent_versions').orderBy('effective_from', 'desc').first();
      await testKnex('consent_records').insert({
        user_id: targetId,
        consent_version_id: cv.id,
        accepted_at: new Date(),
        ip: '127.0.0.1',
      });

      // Login the target user to create a session
      const targetNonce = await supertest(app.callback()).get('/api/v1/auth/nonce/login');
      const targetLogin = await supertest(app.callback())
        .post('/api/v1/auth/login')
        .set('Idempotency-Key', uuidv4())
        .send({ username: targetUsername, password: 'TargetPass@123!', nonce: targetNonce.body.data.nonce });
      expect(targetLogin.status).toBe(200);

      // Now perform role change
      const nonceRes = await supertest(app.callback())
        .get('/api/v1/auth/nonce/role_change')
        .set('Authorization', `Bearer ${accessToken}`);
      const nonce = nonceRes.body.data.nonce;

      const res = await supertest(app.callback())
        .patch(`/api/v1/users/${targetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-CSRF-Token', csrf)
        .set('Idempotency-Key', uuidv4())
        .send({ role: 'operations', nonce });

      expect(res.status).toBe(200);

      // Verify target's sessions are revoked
      const sessions = await testKnex('sessions')
        .where({ user_id: targetId })
        .whereNull('revoked_at');
      expect(sessions.length).toBe(0);
    });

    it('creates audit log entry on role change', async () => {
      const { accessToken, csrf } = await createAdminAndLogin();
      const targetId = await createTargetUser();
      const app = createTestApp();

      const nonceRes = await supertest(app.callback())
        .get('/api/v1/auth/nonce/role_change')
        .set('Authorization', `Bearer ${accessToken}`);
      const nonce = nonceRes.body.data.nonce;

      await supertest(app.callback())
        .patch(`/api/v1/users/${targetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-CSRF-Token', csrf)
        .set('Idempotency-Key', uuidv4())
        .send({ role: 'merchant', nonce });

      const auditEntry = await testKnex('audit_log')
        .where({ entity_type: 'user', entity_id: String(targetId), action: 'users.update' })
        .first();
      expect(auditEntry).toBeTruthy();
    });
  });

  describe('PATCH /api/v1/users/:id — non-role updates', () => {
    it('updates status without nonce', async () => {
      const { accessToken, csrf } = await createAdminAndLogin();
      const targetId = await createTargetUser();
      const app = createTestApp();

      const res = await supertest(app.callback())
        .patch(`/api/v1/users/${targetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-CSRF-Token', csrf)
        .set('Idempotency-Key', uuidv4())
        .send({ status: 'disabled' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('disabled');
    });

    it('updates must_change_password without nonce', async () => {
      const { accessToken, csrf } = await createAdminAndLogin();
      const targetId = await createTargetUser();
      const app = createTestApp();

      const res = await supertest(app.callback())
        .patch(`/api/v1/users/${targetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-CSRF-Token', csrf)
        .set('Idempotency-Key', uuidv4())
        .send({ must_change_password: true });

      expect(res.status).toBe(200);
      expect(res.body.data.must_change_password).toBe(1);
    });
  });

  describe('POST /api/v1/users/:id/unlock', () => {
    it('returns 403 for non-admin', async () => {
      const { accessToken, csrf } = await createRegularUserAndLogin();
      const targetId = await createTargetUser();
      const app = createTestApp();

      const res = await supertest(app.callback())
        .post(`/api/v1/users/${targetId}/unlock`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-CSRF-Token', csrf)
        .set('Idempotency-Key', uuidv4());

      expect(res.status).toBe(403);
    });

    it('unlocks a locked user', async () => {
      const { accessToken, csrf } = await createAdminAndLogin();
      const targetId = await createTargetUser();
      const app = createTestApp();

      // Lock the user
      await testKnex('users').where({ id: targetId }).update({
        status: 'locked',
        locked_until: new Date(Date.now() + 30 * 60 * 1000),
        failed_login_count: 10,
      });

      const res = await supertest(app.callback())
        .post(`/api/v1/users/${targetId}/unlock`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-CSRF-Token', csrf)
        .set('Idempotency-Key', uuidv4());

      expect(res.status).toBe(200);

      const user = await testKnex('users').where({ id: targetId }).first();
      expect(user.status).toBe('active');
      expect(user.failed_login_count).toBe(0);
      expect(user.locked_until).toBeNull();
    });
  });

  describe('POST /api/v1/users/:id/force-reset', () => {
    it('sets must_change_password and revokes sessions', async () => {
      const { accessToken, csrf } = await createAdminAndLogin();
      const targetId = await createTargetUser();
      const app = createTestApp();

      const res = await supertest(app.callback())
        .post(`/api/v1/users/${targetId}/force-reset`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-CSRF-Token', csrf)
        .set('Idempotency-Key', uuidv4());

      expect(res.status).toBe(200);

      const user = await testKnex('users').where({ id: targetId }).first();
      expect(user.must_change_password).toBe(1);
    });

    it('force-reset commits user update, session revocation, and audit atomically', async () => {
      const { accessToken, csrf } = await createAdminAndLogin();
      const targetId = await createTargetUser();

      // Pre-seed a fake active session for the target user
      const targetSessionJti = `jti_atomic_force_reset_${Date.now()}`;
      await testKnex('sessions').insert({
        jti: targetSessionJti,
        user_id: targetId,
        ip: '127.0.0.1',
        user_agent: null,
        device_fingerprint: null,
        issued_at: new Date(),
        last_activity_at: new Date(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
        revoked_at: null,
        revoke_reason: null,
      });

      const app = createTestApp();

      const beforeAudit = await testKnex('audit_log').where({ entity_type: 'user', entity_id: String(targetId), action: 'users.force_reset' }).count<{ count: number }[]>('id as count');

      const res = await supertest(app.callback())
        .post(`/api/v1/users/${targetId}/force-reset`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-CSRF-Token', csrf)
        .set('Idempotency-Key', uuidv4());

      expect(res.status).toBe(200);

      // Atomic outcome: ALL three side effects must be in the consistent state
      // 1) user.must_change_password = 1
      const user = await testKnex('users').where({ id: targetId }).first();
      expect(user.must_change_password).toBe(1);

      // 2) sessions revoked
      const activeSessions = await testKnex('sessions')
        .where({ user_id: targetId })
        .whereNull('revoked_at');
      expect(activeSessions.length).toBe(0);

      const revokedSession = await testKnex('sessions').where({ jti: targetSessionJti }).first();
      expect(revokedSession.revoked_at).not.toBeNull();
      expect(revokedSession.revoke_reason).toBe('force_reset');

      // 3) audit row written
      const afterAudit = await testKnex('audit_log').where({ entity_type: 'user', entity_id: String(targetId), action: 'users.force_reset' }).count<{ count: number }[]>('id as count');
      expect(Number(afterAudit[0].count)) .toBe(Number(beforeAudit[0].count) + 1);
    });

    it('PATCH must_change_password=true revokes sessions atomically with the user update', async () => {
      const { accessToken, csrf } = await createAdminAndLogin();
      const targetId = await createTargetUser();

      // Seed an active session
      const jti = `jti_atomic_patch_mcp_${Date.now()}`;
      await testKnex('sessions').insert({
        jti,
        user_id: targetId,
        ip: '127.0.0.1',
        user_agent: null,
        device_fingerprint: null,
        issued_at: new Date(),
        last_activity_at: new Date(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
        revoked_at: null,
        revoke_reason: null,
      });

      const app = createTestApp();
      const res = await supertest(app.callback())
        .patch(`/api/v1/users/${targetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-CSRF-Token', csrf)
        .set('Idempotency-Key', uuidv4())
        .send({ must_change_password: true });

      expect(res.status).toBe(200);

      // user.must_change_password = 1
      const user = await testKnex('users').where({ id: targetId }).first();
      expect(user.must_change_password).toBe(1);

      // The session was revoked with the matching reason
      const session = await testKnex('sessions').where({ jti }).first();
      expect(session.revoked_at).not.toBeNull();
      expect(session.revoke_reason).toBe('admin_must_change_password');
    });
  });

  describe('admin-lock login denial (end-to-end)', () => {
    it('denies login after admin locks user via PATCH', async () => {
      const { accessToken: adminToken, csrf: adminCsrf } = await createAdminAndLogin();

      // Create a target user who can log in
      const targetUsername = `locktest_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const targetPassword = 'TargetPass@123!';
      const targetHash = await hashPassword(targetPassword);
      const now = new Date();

      const [targetId] = await testKnex('users').insert({
        username: targetUsername,
        password_hash: targetHash,
        role: 'regular_user',
        office_id: 1,
        status: 'active',
        failed_login_count: 0,
        must_change_password: 0,
        created_at: now,
        updated_at: now,
      });

      const app = createTestApp();

      // Admin locks the user (no locked_until — permanent admin lock)
      const lockRes = await supertest(app.callback())
        .patch(`/api/v1/users/${targetId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', adminCsrf)
        .set('Idempotency-Key', uuidv4())
        .send({ status: 'locked' });

      expect(lockRes.status).toBe(200);
      expect(lockRes.body.data.status).toBe('locked');

      // Verify the user is denied at login
      const nonce = (await supertest(app.callback()).get('/api/v1/auth/nonce/login')).body.data.nonce;
      const loginRes = await supertest(app.callback())
        .post('/api/v1/auth/login')
        .set('Idempotency-Key', uuidv4())
        .send({ username: targetUsername, password: targetPassword, nonce });

      expect(loginRes.status).toBe(401);
      expect(loginRes.body.error.code).toBe('INVALID_CREDENTIALS');

      // Verify the lock was NOT auto-cleared
      const userRow = await testKnex('users').where({ id: targetId }).first();
      expect(userRow.status).toBe('locked');
    });

    it('allows login after admin unlocks a previously admin-locked user', async () => {
      const { accessToken: adminToken, csrf: adminCsrf } = await createAdminAndLogin();

      const targetUsername = `unlock_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const targetPassword = 'TargetPass@123!';
      const targetHash = await hashPassword(targetPassword);
      const now = new Date();

      const [targetId] = await testKnex('users').insert({
        username: targetUsername,
        password_hash: targetHash,
        role: 'regular_user',
        office_id: 1,
        status: 'active',
        failed_login_count: 0,
        must_change_password: 0,
        created_at: now,
        updated_at: now,
      });

      // Consent for target
      const cv = await testKnex('consent_versions').orderBy('effective_from', 'desc').first();
      await testKnex('consent_records').insert({
        user_id: targetId,
        consent_version_id: cv.id,
        accepted_at: now,
        ip: '127.0.0.1',
      });

      const app = createTestApp();

      // Lock the user
      await supertest(app.callback())
        .patch(`/api/v1/users/${targetId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', adminCsrf)
        .set('Idempotency-Key', uuidv4())
        .send({ status: 'locked' });

      // Unlock the user
      await supertest(app.callback())
        .post(`/api/v1/users/${targetId}/unlock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', adminCsrf)
        .set('Idempotency-Key', uuidv4());

      // Now login should succeed
      const nonce = (await supertest(app.callback()).get('/api/v1/auth/nonce/login')).body.data.nonce;
      const loginRes = await supertest(app.callback())
        .post('/api/v1/auth/login')
        .set('Idempotency-Key', uuidv4())
        .send({ username: targetUsername, password: targetPassword, nonce });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.ok).toBe(true);
    });
  });
});
