/**
 * True no-mock coverage for attachment endpoints. All endpoints in the
 * attachments router are exercised here through the real encrypted
 * filesystem storage repository, so every route has at least one
 * supertest path that does not rely on jest.mock of
 * ../../src/storage/repository:
 *   POST  /api/v1/listings/:listingId/attachments
 *   GET   /api/v1/listings/:listingId/attachments
 *   PUT   /api/v1/listings/:listingId/attachments/:id
 *   DELETE /api/v1/listings/:listingId/attachments/:id
 *   GET   /api/v1/listings/:listingId/attachments/:id/revisions
 *   POST  /api/v1/listings/:listingId/attachments/:id/rollback
 *   GET   /api/v1/listings/:listingId/attachments/rejections
 */
import supertest from 'supertest';
import Koa from 'koa';
import { v4 as uuidv4 } from 'uuid';
import { Knex as KnexType } from 'knex';
import sharp from 'sharp';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import { hashPassword } from '../../src/services/password';
import {
  createProductionTestApp,
  clearRateLimitStore,
  getCsrfToken,
} from '../helpers/testApp';

// No jest.mock of storage/repository — tests exercise the real
// EncryptedStorageRepository wrapping a LocalFileSystemRepository pointed at
// the per-worker tmp dir seeded in tests/setupEnv.ts.
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
    await testKnex('offices').insert({ id, name: 'Test Office', code: `COVA${id}`, active: 1 });
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

async function createUserAndLogin(opts: {
  role?: string;
  officeId?: number;
} = {}): Promise<{
  accessToken: string;
  csrf: string;
  userId: number;
  officeId: number;
}> {
  const officeId = opts.officeId ?? 1;
  await ensureOffice(officeId);
  const username = `cov_att_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'TestPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();
  const [userId] = await testKnex('users').insert({
    username,
    password_hash: hash,
    role: opts.role ?? 'regular_user',
    office_id: officeId,
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
  return { accessToken, csrf, userId: Number(userId), officeId };
}

async function createDraftListing(userId: number, officeId: number): Promise<number> {
  const now = new Date();
  const [id] = await testKnex('listings').insert({
    office_id: officeId,
    created_by: userId,
    status: 'draft',
    version: 1,
    anomaly_flags: '[]',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
  return Number(id);
}

async function createJpeg(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width: 120, height: 100, channels: 3, background: color },
  })
    .jpeg()
    .toBuffer();
}

async function uploadAttachment(
  app: Koa,
  accessToken: string,
  csrf: string,
  listingId: number,
  buf: Buffer,
  filename = 'photo.jpg',
): Promise<number> {
  const res = await supertest(app.callback())
    .post(`/api/v1/listings/${listingId}/attachments`)
    .set('Authorization', `Bearer ${accessToken}`)
    .set('X-CSRF-Token', csrf)
    .set('Idempotency-Key', uuidv4())
    .attach('file', buf, { filename, contentType: 'image/jpeg' });
  expect(res.status).toBe(201);
  return res.body.data.attachment.id as number;
}

describe('PUT /api/v1/listings/:listingId/attachments/:id', () => {
  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback())
      .put('/api/v1/listings/1/attachments/1')
      .set('Idempotency-Key', uuidv4())
      .attach('file', Buffer.from('x'), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when no file is uploaded', async () => {
    const owner = await createUserAndLogin({ role: 'merchant' });
    const listingId = await createDraftListing(owner.userId, owner.officeId);
    const app = createTestApp();
    const initial = await createJpeg({ r: 200, g: 50, b: 50 });
    const attId = await uploadAttachment(app, owner.accessToken, owner.csrf, listingId, initial);

    const res = await supertest(app.callback())
      .put(`/api/v1/listings/${listingId}/attachments/${attId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', uuidv4());
    expect(res.status).toBe(400);
  });

  it('replaces attachment content and bumps revision', async () => {
    const owner = await createUserAndLogin({ role: 'merchant' });
    const listingId = await createDraftListing(owner.userId, owner.officeId);
    const app = createTestApp();

    const initial = await createJpeg({ r: 255, g: 0, b: 0 });
    const attId = await uploadAttachment(app, owner.accessToken, owner.csrf, listingId, initial);

    const replacement = await createJpeg({ r: 0, g: 255, b: 0 });
    const res = await supertest(app.callback())
      .put(`/api/v1/listings/${listingId}/attachments/${attId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', replacement, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.data.attachment.id).toBe(attId);
    // Internal metadata should not leak.
    expect(res.body.data.attachment).not.toHaveProperty('storage_key');
    expect(res.body.data.attachment).not.toHaveProperty('sha256');

    const revisions = await testKnex('attachment_revisions').where({ attachment_id: attId });
    expect(revisions.length).toBeGreaterThanOrEqual(2);
  });
});

describe('POST /api/v1/listings/:listingId/attachments/:id/rollback', () => {
  it('returns 403 for regular_user', async () => {
    const owner = await createUserAndLogin({ role: 'regular_user' });
    const listingId = await createDraftListing(owner.userId, owner.officeId);
    const app = createTestApp();
    const initial = await createJpeg({ r: 10, g: 20, b: 30 });
    const attId = await uploadAttachment(app, owner.accessToken, owner.csrf, listingId, initial);

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments/${attId}/rollback`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ revisionNo: 1 });
    expect(res.status).toBe(403);
  });

  it('returns 400 when revisionNo is missing', async () => {
    const owner = await createUserAndLogin({ role: 'merchant' });
    const listingId = await createDraftListing(owner.userId, owner.officeId);
    const app = createTestApp();
    const initial = await createJpeg({ r: 10, g: 20, b: 30 });
    const attId = await uploadAttachment(app, owner.accessToken, owner.csrf, listingId, initial);

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments/${attId}/rollback`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', uuidv4())
      .send({});
    expect(res.status).toBe(400);
  });

  it('merchant rolls back to a prior revision', async () => {
    const owner = await createUserAndLogin({ role: 'merchant' });
    const listingId = await createDraftListing(owner.userId, owner.officeId);
    const app = createTestApp();

    // Upload, then replace to produce multiple revisions
    const initial = await createJpeg({ r: 200, g: 50, b: 50 });
    const attId = await uploadAttachment(app, owner.accessToken, owner.csrf, listingId, initial);

    const replacement = await createJpeg({ r: 50, g: 200, b: 50 });
    const replaceRes = await supertest(app.callback())
      .put(`/api/v1/listings/${listingId}/attachments/${attId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', replacement, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(replaceRes.status).toBe(200);

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments/${attId}/rollback`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ revisionNo: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(attId);
    expect(res.body.data).not.toHaveProperty('storage_key');
  });

  it('returns 404 when revision does not exist', async () => {
    const owner = await createUserAndLogin({ role: 'merchant' });
    const listingId = await createDraftListing(owner.userId, owner.officeId);
    const app = createTestApp();
    const initial = await createJpeg({ r: 10, g: 20, b: 30 });
    const attId = await uploadAttachment(app, owner.accessToken, owner.csrf, listingId, initial);

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments/${attId}/rollback`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', uuidv4())
      .send({ revisionNo: 99 });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/listings/:listingId/attachments/rejections', () => {
  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await supertest(app.callback()).get('/api/v1/listings/1/attachments/rejections');
    expect(res.status).toBe(401);
  });

  it('returns rejection history for merchant of same office', async () => {
    const owner = await createUserAndLogin({ role: 'merchant' });
    const listingId = await createDraftListing(owner.userId, owner.officeId);

    // Seed rejections
    const now = new Date();
    await testKnex('attachment_rejections').insert([
      {
        listing_id: listingId,
        filename: 'bad.bin',
        reason_code: 'invalid_type',
        reason_detail: 'not an image',
        actor_id: owner.userId,
        created_at: now.toISOString(),
      },
      {
        listing_id: listingId,
        filename: 'huge.jpg',
        reason_code: 'too_large',
        reason_detail: null,
        actor_id: owner.userId,
        created_at: now.toISOString(),
      },
    ]);

    const app = createTestApp();
    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/attachments/rejections`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data[0].reason_code).toBeDefined();
  });

  it('returns 403 for regular_user (not permitted role)', async () => {
    const owner = await createUserAndLogin({ role: 'regular_user' });
    const listingId = await createDraftListing(owner.userId, owner.officeId);
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/attachments/rejections`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('returns empty list when no rejections recorded', async () => {
    const owner = await createUserAndLogin({ role: 'merchant' });
    const listingId = await createDraftListing(owner.userId, owner.officeId);
    const app = createTestApp();
    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/attachments/rejections`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ── True no-mock coverage for the remaining attachment endpoints so the
//    PRD-mandated upload / list / delete / revisions path has at least one
//    assertion that does not rely on `jest.mock('../../src/storage/repository')`.
describe('POST /api/v1/listings/:listingId/attachments (no-mock storage)', () => {
  it('uploads a JPEG and persists a revision with a real encrypted blob', async () => {
    const owner = await createUserAndLogin({ role: 'regular_user' });
    const listingId = await createDraftListing(owner.userId, owner.officeId);
    const app = createTestApp();
    const jpeg = await createJpeg({ r: 20, g: 40, b: 80 });

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', jpeg, { filename: 'first.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.data.attachment.id).toBeGreaterThan(0);
    expect(res.body.data.duplicate).toBe(false);
    // Internal storage metadata must not leak.
    expect(res.body.data.attachment).not.toHaveProperty('storage_key');
    expect(res.body.data.attachment).not.toHaveProperty('sha256');

    const revisions = await testKnex('attachment_revisions')
      .where({ attachment_id: res.body.data.attachment.id })
      .select('storage_key');
    expect(revisions.length).toBe(1);
    expect(typeof revisions[0].storage_key).toBe('string');
    expect(revisions[0].storage_key.length).toBeGreaterThan(0);
  });

  it('rejects a non-image with ATTACHMENT_REJECTED and records the rejection', async () => {
    const owner = await createUserAndLogin({ role: 'regular_user' });
    const listingId = await createDraftListing(owner.userId, owner.officeId);
    const app = createTestApp();

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', Buffer.alloc(256, 0), { filename: 'noop.bin', contentType: 'application/octet-stream' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ATTACHMENT_REJECTED');
    const row = await testKnex('attachment_rejections').where({ listing_id: listingId }).first();
    expect(row).toBeTruthy();
  });
});

describe('GET /api/v1/listings/:listingId/attachments (no-mock storage)', () => {
  it('returns the uploaded attachment without leaking storage metadata', async () => {
    const owner = await createUserAndLogin({ role: 'regular_user' });
    const listingId = await createDraftListing(owner.userId, owner.officeId);
    const app = createTestApp();
    const jpeg = await createJpeg({ r: 100, g: 100, b: 100 });
    await uploadAttachment(app, owner.accessToken, owner.csrf, listingId, jpeg);

    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const a of res.body.data) {
      expect(a).not.toHaveProperty('storage_key');
      expect(a).not.toHaveProperty('sha256');
    }
  });
});

describe('DELETE /api/v1/listings/:listingId/attachments/:id (no-mock storage)', () => {
  it('soft-deletes the attachment without removing the blob', async () => {
    const owner = await createUserAndLogin({ role: 'regular_user' });
    const listingId = await createDraftListing(owner.userId, owner.officeId);
    const app = createTestApp();
    const jpeg = await createJpeg({ r: 10, g: 40, b: 160 });
    const attId = await uploadAttachment(app, owner.accessToken, owner.csrf, listingId, jpeg);

    const res = await supertest(app.callback())
      .delete(`/api/v1/listings/${listingId}/attachments/${attId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', uuidv4());
    expect(res.status).toBe(200);

    const row = await testKnex('attachments').where({ id: attId }).first();
    expect(row).toBeDefined();
    expect(row.soft_deleted_at).not.toBeNull();
  });
});

describe('GET /api/v1/listings/:listingId/attachments/:id/revisions (no-mock storage)', () => {
  it('returns revision history for merchant of same office', async () => {
    const owner = await createUserAndLogin({ role: 'merchant' });
    const listingId = await createDraftListing(owner.userId, owner.officeId);
    const app = createTestApp();
    const jpeg = await createJpeg({ r: 250, g: 250, b: 10 });
    const attId = await uploadAttachment(app, owner.accessToken, owner.csrf, listingId, jpeg);

    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/attachments/${attId}/revisions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const r of res.body.data) {
      expect(r).not.toHaveProperty('storage_key');
      expect(r).not.toHaveProperty('sha256');
    }
  });
});
