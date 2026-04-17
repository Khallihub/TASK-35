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
import { InMemoryRepository } from '../../src/storage/repository';

// Replace the real storageRepository with an in-memory one so admin purge
// blob deletion is observable without touching the filesystem.
jest.mock('../../src/storage/repository', () => {
  const actual = jest.requireActual('../../src/storage/repository') as {
    InMemoryRepository: unknown;
    LocalFileSystemRepository: unknown;
    EncryptedStorageRepository: unknown;
  };
  const storage = new (actual.InMemoryRepository as new () => InMemoryRepository)();
  (global as Record<string, unknown>).__adminTestStorage = storage;
  return {
    ...actual,
    storageRepository: storage,
  };
});

let testKnex: KnexType;
let testStorage: InMemoryRepository;

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
  testStorage = (global as Record<string, unknown>).__adminTestStorage as InMemoryRepository;
});

afterAll(async () => {
  resetAuditKnex();
  resetDefaultKnex();
  await dropTestTables(testKnex);
  await testKnex.destroy();
});

/**
 * Build the Koa app via the production-mirror factory — full stack, no
 * skips. Admin mutations exercise CSRF + Idempotency-Key + IP rate limiting
 * end-to-end.
 */
function createTestApp(): Koa {
  return createProductionTestApp();
}

beforeEach(() => {
  clearRateLimitStore();
});

let consentVersionId: number;

async function createUserAndLogin(role: string): Promise<{ accessToken: string; userId: number; csrf: string }> {
  const username = `admintest_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'TestPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();

  const officeId = 1;
  const officeExists = await testKnex('offices').where({ id: officeId }).first();
  if (!officeExists) {
    await testKnex('offices').insert({ id: officeId, name: 'Test Office', code: 'ADM1', active: 1 });
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

async function createNonce(userId: number): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  const value = `nonce_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await testKnex('nonces').insert({
    value,
    purpose: 'purge',
    user_id: userId,
    created_at: formatDatetime(now),
    expires_at: formatDatetime(expiresAt),
    consumed_at: null,
  });
  return value;
}

describe('GET /api/v1/admin/risk/:userId', () => {
  beforeEach(async () => {
    await testKnex('risk_events').delete();
    await testKnex('risk_profiles').delete();
  });

  it('returns risk profile for administrator', async () => {
    const { accessToken, userId, csrf } = await createUserAndLogin('administrator');

    const app = createTestApp();
    const res = await supertest(app.callback())
      .get(`/api/v1/admin/risk/${userId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.profile).toBeDefined();
    expect(res.body.data.profile.credit_score).toBe(100);
    expect(Array.isArray(res.body.data.events)).toBe(true);
  });
});

describe('POST /api/v1/admin/blacklist', () => {
  beforeEach(async () => {
    await testKnex('blacklist_entries').delete();
    await testKnex('audit_log').delete();
  });

  it('adds a blacklist entry', async () => {
    const { accessToken, csrf } = await createUserAndLogin('administrator');

    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/admin/blacklist')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({
        subjectType: 'ip',
        subjectValue: '10.0.0.1',
        reason: 'Suspicious activity',
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.subject_type).toBe('ip');
    expect(res.body.data.subject_value).toBe('10.0.0.1');
  });
});

describe('DELETE /api/v1/admin/blacklist/:id', () => {
  beforeEach(async () => {
    await testKnex('blacklist_entries').delete();
    await testKnex('audit_log').delete();
  });

  it('removes a blacklist entry', async () => {
    const { accessToken, csrf } = await createUserAndLogin('administrator');
    const now = new Date();

    // Insert a blacklist entry
    const [entryId] = await testKnex('blacklist_entries').insert({
      subject_type: 'ip',
      subject_value: '10.0.0.2',
      reason: 'test',
      created_at: formatDatetime(now),
    });

    const app = createTestApp();
    const res = await supertest(app.callback())
      .delete(`/api/v1/admin/blacklist/${entryId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify it's removed
    const remaining = await testKnex('blacklist_entries').where({ id: entryId }).first();
    expect(remaining).toBeUndefined();
  });
});

describe('POST /api/v1/admin/purge/listing/:id', () => {
  beforeEach(async () => {
    await testKnex('listing_status_history').delete();
    await testKnex('listing_revisions').delete();
    await testKnex('attachments').delete();
    await testKnex('listings').delete();
    await testKnex('nonces').delete();
  });

  it('purges listing with correct confirm text and nonce', async () => {
    const { accessToken, userId, csrf } = await createUserAndLogin('administrator');

    const officeExists = await testKnex('offices').where({ id: 1 }).first();
    if (!officeExists) {
      await testKnex('offices').insert({ id: 1, name: 'Test Office', code: 'ADM1', active: 1 });
    }

    const now = new Date();
    const [listingId] = await testKnex('listings').insert({
      office_id: 1,
      created_by: userId,
      status: 'draft',
      version: 1,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });

    const nonce = await createNonce(userId);

    const app = createTestApp();
    const res = await supertest(app.callback())
      .post(`/api/v1/admin/purge/listing/${listingId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', nonce)
      .send({ confirm: `PURGE ${listingId}` });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const deleted = await testKnex('listings').where({ id: listingId }).first();
    expect(deleted).toBeUndefined();
  });

  it('also removes attachment storage blobs in the same path', async () => {
    const { accessToken, userId, csrf } = await createUserAndLogin('administrator');

    const officeExists = await testKnex('offices').where({ id: 1 }).first();
    if (!officeExists) {
      await testKnex('offices').insert({ id: 1, name: 'Test Office', code: 'ADM1', active: 1 });
    }

    const now = new Date();
    const [listingId] = await testKnex('listings').insert({
      office_id: 1,
      created_by: userId,
      status: 'draft',
      version: 1,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });

    // Pre-seed an attachment row + blob and a revision row + blob so we can
    // verify the admin purge wipes both DB rows AND storage objects.
    const currentKey = `listings/${listingId}/attachments/seed/current.bin`;
    const revisionKey = `listings/${listingId}/attachments/seed/rev_1.bin`;
    await testStorage.write(currentKey, Buffer.from('current-blob'));
    await testStorage.write(revisionKey, Buffer.from('revision-blob'));

    const [attachmentId] = await testKnex('attachments').insert({
      listing_id: listingId,
      kind: 'image',
      original_filename: 'seed.bin',
      storage_key: currentKey,
      sha256: 'seedhash',
      bytes: 12,
      mime: 'application/octet-stream',
      created_by: userId,
      created_at: formatDatetime(now),
    });

    await testKnex('attachment_revisions').insert({
      attachment_id: attachmentId,
      revision_no: 1,
      storage_key: revisionKey,
      sha256: 'seedhash',
      bytes: 13,
      pruned: 0,
      created_by: userId,
      created_at: formatDatetime(now),
    });

    expect(await testStorage.exists(currentKey)).toBe(true);
    expect(await testStorage.exists(revisionKey)).toBe(true);

    const nonce = await createNonce(userId);

    const app = createTestApp();
    const res = await supertest(app.callback())
      .post(`/api/v1/admin/purge/listing/${listingId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', nonce)
      .send({ confirm: `PURGE ${listingId}` });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // DB rows are gone
    expect(await testKnex('listings').where({ id: listingId }).first()).toBeUndefined();
    expect(await testKnex('attachments').where({ id: attachmentId }).first()).toBeUndefined();
    expect(
      await testKnex('attachment_revisions').where({ attachment_id: attachmentId }).first(),
    ).toBeUndefined();

    // Blobs are gone in the same path — orphan-sweep is only a safety net.
    expect(await testStorage.exists(currentKey)).toBe(false);
    expect(await testStorage.exists(revisionKey)).toBe(false);
  });

  it('returns 400 with wrong confirm text', async () => {
    const { accessToken, userId, csrf } = await createUserAndLogin('administrator');

    const officeExists = await testKnex('offices').where({ id: 1 }).first();
    if (!officeExists) {
      await testKnex('offices').insert({ id: 1, name: 'Test Office', code: 'ADM1', active: 1 });
    }

    const now = new Date();
    const [listingId] = await testKnex('listings').insert({
      office_id: 1,
      created_by: userId,
      status: 'draft',
      version: 1,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });

    const nonce = await createNonce(userId);

    const app = createTestApp();
    const res = await supertest(app.callback())
      .post(`/api/v1/admin/purge/listing/${listingId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', nonce)
      .send({ confirm: 'WRONG TEXT' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

describe('GET /api/v1/admin/audit-chain', () => {
  it('returns audit chain validity', async () => {
    const { accessToken, csrf } = await createUserAndLogin('administrator');

    const app = createTestApp();
    const res = await supertest(app.callback())
      .get('/api/v1/admin/audit-chain')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.data.valid).toBe('boolean');
  });
});

/**
 * Direct route-level regression coverage for the irreversible admin user
 * purge. This endpoint cascades across listings, attachments, promo
 * collections, sessions, consent, risk profiles, blobs, and more — it
 * warrants its own dedicated suite so any future regression (missing
 * confirm text, missing nonce, orphan FKs, stuck blobs, privilege
 * escalation) fails here before it ships.
 */
describe('POST /api/v1/admin/purge/user/:id', () => {
  beforeEach(async () => {
    await testKnex('attachment_revisions').delete();
    await testKnex('attachments').delete();
    await testKnex('listing_status_history').delete();
    await testKnex('listing_revisions').delete();
    await testKnex('listings').delete();
    await testKnex('promo_slots').delete();
    await testKnex('promo_collections').delete();
    await testKnex('nonces').delete();
    await testKnex('risk_events').delete();
    await testKnex('risk_profiles').delete();
    await testKnex('login_attempts').delete();
    await testKnex('password_history').delete();
    await testKnex('sessions').delete();
    await testKnex('idempotency_keys').delete();
  });

  async function seedTargetUser(role = 'regular_user'): Promise<number> {
    const officeExists = await testKnex('offices').where({ id: 1 }).first();
    if (!officeExists) {
      await testKnex('offices').insert({ id: 1, name: 'Test Office', code: 'ADM1', active: 1 });
    }
    const now = new Date();
    const [targetId] = await testKnex('users').insert({
      username: `target_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      password_hash: 'hash',
      role,
      office_id: 1,
      status: 'active',
      failed_login_count: 0,
      must_change_password: 0,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });
    return Number(targetId);
  }

  it('returns 400 with wrong confirm text', async () => {
    const { accessToken, userId, csrf } = await createUserAndLogin('administrator');
    const targetId = await seedTargetUser();
    const nonce = await createNonce(userId);

    const app = createTestApp();
    const res = await supertest(app.callback())
      .post(`/api/v1/admin/purge/user/${targetId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', nonce)
      .send({ confirm: 'WRONG TEXT' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    // The target user row must still exist.
    const stillThere = await testKnex('users').where({ id: targetId }).first();
    expect(stillThere).toBeDefined();
  });

  it('returns 401 without X-Nonce', async () => {
    const { accessToken, csrf } = await createUserAndLogin('administrator');
    const targetId = await seedTargetUser();

    const app = createTestApp();
    const res = await supertest(app.callback())
      .post(`/api/v1/admin/purge/user/${targetId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ confirm: `PURGE ${targetId}` });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('returns 403 for non-administrator roles', async () => {
    // Admin-only endpoint — every other role must be denied.
    for (const role of ['regular_user', 'merchant', 'operations']) {
      const { accessToken, csrf } = await createUserAndLogin(role);
      const targetId = await seedTargetUser();

      const app = createTestApp();
      const res = await supertest(app.callback())
        .post(`/api/v1/admin/purge/user/${targetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-CSRF-Token', csrf)
        .set('Idempotency-Key', uuidv4())
        .set('X-Nonce', 'any')
        .send({ confirm: `PURGE ${targetId}` });

      expect(res.status).toBe(403);
      // Target user still exists — no side effects from a forbidden call.
      const stillThere = await testKnex('users').where({ id: targetId }).first();
      expect(stillThere).toBeDefined();
    }
  });

  it('returns 404 when target user does not exist', async () => {
    const { accessToken, userId, csrf } = await createUserAndLogin('administrator');
    const nonce = await createNonce(userId);

    const app = createTestApp();
    const res = await supertest(app.callback())
      .post('/api/v1/admin/purge/user/999999')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', nonce)
      .send({ confirm: 'PURGE 999999' });

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('hard-deletes the user and cascades listings, attachments, blobs', async () => {
    const { accessToken, userId, csrf } = await createUserAndLogin('administrator');
    const targetId = await seedTargetUser();

    const officeExists = await testKnex('offices').where({ id: 1 }).first();
    if (!officeExists) {
      await testKnex('offices').insert({ id: 1, name: 'Test Office', code: 'ADM1', active: 1 });
    }

    const now = new Date();
    // Listing owned by target user
    const [listingId] = await testKnex('listings').insert({
      office_id: 1,
      created_by: targetId,
      status: 'draft',
      version: 1,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });

    // Attachment + revision blobs
    const currentKey = `listings/${listingId}/attachments/user_purge/current.bin`;
    const revisionKey = `listings/${listingId}/attachments/user_purge/rev_1.bin`;
    await testStorage.write(currentKey, Buffer.from('current-blob'));
    await testStorage.write(revisionKey, Buffer.from('revision-blob'));

    const [attachmentId] = await testKnex('attachments').insert({
      listing_id: listingId,
      kind: 'image',
      original_filename: 'seed.bin',
      storage_key: currentKey,
      sha256: 'seedhash',
      bytes: 12,
      mime: 'application/octet-stream',
      created_by: targetId,
      created_at: formatDatetime(now),
    });

    await testKnex('attachment_revisions').insert({
      attachment_id: attachmentId,
      revision_no: 1,
      storage_key: revisionKey,
      sha256: 'seedhash',
      bytes: 13,
      pruned: 0,
      created_by: targetId,
      created_at: formatDatetime(now),
    });

    expect(await testStorage.exists(currentKey)).toBe(true);
    expect(await testStorage.exists(revisionKey)).toBe(true);

    const nonce = await createNonce(userId);

    const app = createTestApp();
    const res = await supertest(app.callback())
      .post(`/api/v1/admin/purge/user/${targetId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', nonce)
      .send({ confirm: `PURGE ${targetId}` });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // User row is gone.
    expect(await testKnex('users').where({ id: targetId }).first()).toBeUndefined();
    // Owned listing + its attachments + revisions are gone.
    expect(await testKnex('listings').where({ id: listingId }).first()).toBeUndefined();
    expect(await testKnex('attachments').where({ id: attachmentId }).first()).toBeUndefined();
    expect(
      await testKnex('attachment_revisions').where({ attachment_id: attachmentId }).first(),
    ).toBeUndefined();
    // Blobs are cleaned up in the same path — orphan-sweep is only a safety net.
    expect(await testStorage.exists(currentKey)).toBe(false);
    expect(await testStorage.exists(revisionKey)).toBe(false);
  });

  it('rejects a single-use nonce on replay', async () => {
    const { accessToken, userId, csrf } = await createUserAndLogin('administrator');
    const targetA = await seedTargetUser();
    const targetB = await seedTargetUser();

    const nonce = await createNonce(userId);

    const app = createTestApp();
    const first = await supertest(app.callback())
      .post(`/api/v1/admin/purge/user/${targetA}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', nonce)
      .send({ confirm: `PURGE ${targetA}` });

    expect(first.status).toBe(200);

    const replay = await supertest(app.callback())
      .post(`/api/v1/admin/purge/user/${targetB}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .set('X-Nonce', nonce)
      .send({ confirm: `PURGE ${targetB}` });

    // Nonce is single-use — the second call must be rejected, and target B
    // must survive.
    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(await testKnex('users').where({ id: targetB }).first()).toBeDefined();
  });
});
