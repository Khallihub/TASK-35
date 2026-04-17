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
import { InMemoryRepository } from '../../src/storage/repository';

let testKnex: KnexType;
let testStorage: InMemoryRepository;

// Patch storageRepository in the attachment service module for tests
// We do this by setting up InMemoryRepository before requiring the module
jest.mock('../../src/storage/repository', () => {
  const actual = jest.requireActual('../../src/storage/repository') as {
    InMemoryRepository: unknown;
    LocalFileSystemRepository: unknown;
  };
  const storage = new (actual.InMemoryRepository as new () => InMemoryRepository)();

  // Store reference for test access
  (global as Record<string, unknown>).__testStorage = storage;

  return {
    ...actual,
    storageRepository: storage,
  };
});

beforeAll(async () => {
  testKnex = createTestKnex();
  await runTestMigrations(testKnex);
  setAuditKnex(testKnex);
  setDefaultKnex(testKnex);
  testStorage = (global as Record<string, unknown>).__testStorage as InMemoryRepository;
});

afterAll(async () => {
  resetAuditKnex();
  resetDefaultKnex();
  await dropTestTables(testKnex);
  await testKnex.destroy();
});

beforeEach(async () => {
  // The IP rate-limit counter store is process-global; clear it first so a
  // burst of uploads in one test doesn't trip the 30/15min failed-request
  // bucket in another.
  clearRateLimitStore();
  await testKnex('idempotency_keys').delete();
  await testKnex('attachment_rejections').delete();
  await testKnex('attachment_revisions').delete();
  await testKnex('attachments').delete();
  await testKnex('event_log').delete();
  await testKnex('listing_revisions').delete();
  await testKnex('listing_status_history').delete();
  await testKnex('listings').delete();
});

/**
 * Build the Koa app via the production-mirror factory — full stack, no
 * skips. Uploads now exercise CSRF + Idempotency-Key + IP rate limiting
 * end-to-end, matching production request handling.
 */
function createTestApp(): Koa {
  return createProductionTestApp();
}

async function createUserAndLogin(overrides: { role?: string; officeId?: number } = {}): Promise<{
  accessToken: string;
  userId: number;
  officeId: number;
  csrf: string;
}> {
  const username = `testuser_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const password = 'TestPass@123!';
  const hash = await hashPassword(password);
  const now = new Date();

  const officeId = overrides.officeId ?? 1;
  const officeExists = await testKnex('offices').where({ id: officeId }).first();
  if (!officeExists) {
    await testKnex('offices').insert({ id: officeId, name: 'Test Office', code: `OFF${officeId}`, active: 1 });
  }

  const [userId] = await testKnex('users').insert({
    username,
    password_hash: hash,
    role: overrides.role ?? 'regular_user',
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
  const csrf = await getCsrfToken(app, accessToken);
  return { accessToken, userId: Number(userId), officeId, csrf };
}

async function createTestListing(userId: number, officeId: number): Promise<number> {
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

async function createTestJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 100,
      height: 80,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe('POST /api/v1/listings/:listingId/attachments', () => {
  it('returns 201 for a valid JPEG upload', async () => {
    const { accessToken, userId, officeId, csrf } = await createUserAndLogin();
    const listingId = await createTestListing(userId, officeId);
    const app = createTestApp();
    const jpeg = await createTestJpeg();

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', jpeg, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.attachment).toBeDefined();
    expect(res.body.data.duplicate).toBe(false);
    // Internal storage metadata MUST NOT leak through the upload response.
    expect(res.body.data.attachment).not.toHaveProperty('storage_key');
    expect(res.body.data.attachment).not.toHaveProperty('sha256');
    expect(res.body.data.attachment).not.toHaveProperty('created_by');
    expect(res.body.data.attachment).not.toHaveProperty('current_revision_id');
  });

  it('returns 422 ATTACHMENT_REJECTED for invalid file type', async () => {
    const { accessToken, userId, officeId, csrf } = await createUserAndLogin();
    const listingId = await createTestListing(userId, officeId);
    const app = createTestApp();
    const invalidBuf = Buffer.alloc(100, 0x00);

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', invalidBuf, { filename: 'file.bin', contentType: 'application/octet-stream' });

    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('ATTACHMENT_REJECTED');
    expect(res.body.error.details.rejectionCode).toBe('invalid_type');
  });

  it('returns 200 with duplicate: true for duplicate upload', async () => {
    const { accessToken, userId, officeId, csrf } = await createUserAndLogin();
    const listingId = await createTestListing(userId, officeId);
    const app = createTestApp();
    const jpeg = await createTestJpeg();

    // First upload
    await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', jpeg, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    // Second upload with same file
    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', jpeg, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.duplicate).toBe(true);
  });

  it('returns 401 without auth token', async () => {
    const app = createTestApp();

    // Send Idempotency-Key so the request reaches the auth gate; otherwise
    // the idempotency middleware would short-circuit with a 400. The test
    // target is the auth check.
    const res = await supertest(app.callback())
      .post('/api/v1/listings/1/attachments')
      .set('Idempotency-Key', uuidv4())
      .attach('file', Buffer.alloc(10), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/listings/:listingId/attachments', () => {
  it('returns 200 with list of attachments', async () => {
    const { accessToken, userId, officeId, csrf } = await createUserAndLogin();
    const listingId = await createTestListing(userId, officeId);
    const app = createTestApp();
    const jpeg = await createTestJpeg();

    // Upload an attachment first
    await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', jpeg, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
    // Internal storage metadata MUST NOT leak through the list response
    // (the list is readable by broad authenticated users when the listing
    // is published).
    for (const att of res.body.data) {
      expect(att).not.toHaveProperty('storage_key');
      expect(att).not.toHaveProperty('sha256');
      expect(att).not.toHaveProperty('created_by');
      expect(att).not.toHaveProperty('current_revision_id');
    }
  });

  it('returns empty list when no attachments', async () => {
    const { accessToken, userId, officeId, csrf } = await createUserAndLogin();
    const listingId = await createTestListing(userId, officeId);
    const app = createTestApp();

    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('regular_user attachment write draft-status gate', () => {
  it('denies upload on own in_review listing', async () => {
    const { accessToken, userId, officeId, csrf } = await createUserAndLogin({ role: 'regular_user' });
    const listingId = await createTestListing(userId, officeId);
    // Transition listing to in_review
    await testKnex('listings').where({ id: listingId }).update({ status: 'in_review' });

    const app = createTestApp();
    const jpeg = await createTestJpeg();

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', jpeg, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(403);
  });

  it('denies upload on own approved listing', async () => {
    const { accessToken, userId, officeId, csrf } = await createUserAndLogin({ role: 'regular_user' });
    const listingId = await createTestListing(userId, officeId);
    await testKnex('listings').where({ id: listingId }).update({ status: 'approved' });

    const app = createTestApp();
    const jpeg = await createTestJpeg();

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', jpeg, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(403);
  });

  it('denies upload on own published listing', async () => {
    const { accessToken, userId, officeId, csrf } = await createUserAndLogin({ role: 'regular_user' });
    const listingId = await createTestListing(userId, officeId);
    await testKnex('listings').where({ id: listingId }).update({ status: 'published' });

    const app = createTestApp();
    const jpeg = await createTestJpeg();

    const res = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', jpeg, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(403);
  });

  it('denies soft-delete on own non-draft listing', async () => {
    const { accessToken, userId, officeId, csrf } = await createUserAndLogin({ role: 'regular_user' });
    const listingId = await createTestListing(userId, officeId);

    // Upload on draft (allowed)
    const app = createTestApp();
    const jpeg = await createTestJpeg();
    const uploadRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', jpeg, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(uploadRes.status).toBe(201);
    const attachmentId = uploadRes.body.data.attachment.id;

    // Now transition to in_review
    await testKnex('listings').where({ id: listingId }).update({ status: 'in_review' });

    const deleteRes = await supertest(app.callback())
      .delete(`/api/v1/listings/${listingId}/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());

    expect(deleteRes.status).toBe(403);
  });
});

describe('GET /api/v1/listings/:listingId/attachments/:id/revisions', () => {
  async function seedListingWithAttachment(role: string, opts: { officeId?: number; status?: string } = {}) {
    const officeId = opts.officeId ?? 1;
    const owner = await createUserAndLogin({ role: 'merchant', officeId });
    const listingId = await createTestListing(owner.userId, officeId);
    if (opts.status) {
      await testKnex('listings').where({ id: listingId }).update({ status: opts.status });
    }
    const app = createTestApp();
    const jpeg = await createTestJpeg();
    const uploadRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', jpeg, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(uploadRes.status).toBe(201);
    const attachmentId = uploadRes.body.data.attachment.id;

    const requester = await createUserAndLogin({ role, officeId });
    return { app, requester, listingId, attachmentId };
  }

  it('returns 403 for regular_user requesting revisions on a published listing', async () => {
    const { app, requester, listingId, attachmentId } = await seedListingWithAttachment(
      'regular_user',
      { status: 'published' },
    );

    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/attachments/${attachmentId}/revisions`)
      .set('Authorization', `Bearer ${requester.accessToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 403 for operations role', async () => {
    const { app, requester, listingId, attachmentId } = await seedListingWithAttachment('operations');

    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/attachments/${attachmentId}/revisions`)
      .set('Authorization', `Bearer ${requester.accessToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 403 for merchant of a different office', async () => {
    const { app, requester, listingId, attachmentId } = await seedListingWithAttachment('merchant', {
      officeId: 1,
    });
    // The seed helper used officeId 1 for both owner + requester; rebuild with
    // a different requester office to test the cross-office case explicitly.
    const otherMerchant = await createUserAndLogin({ role: 'merchant', officeId: 99 });

    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/attachments/${attachmentId}/revisions`)
      .set('Authorization', `Bearer ${otherMerchant.accessToken}`);

    expect(res.status).toBe(403);
    // Same-office requester also exercises the success path
    const sameOffice = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/attachments/${attachmentId}/revisions`)
      .set('Authorization', `Bearer ${requester.accessToken}`);
    expect(sameOffice.status).toBe(200);
  });

  it('returns 200 for merchant of the same office and trims internal metadata', async () => {
    const { app, requester, listingId, attachmentId } = await seedListingWithAttachment('merchant');

    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/attachments/${attachmentId}/revisions`)
      .set('Authorization', `Bearer ${requester.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const rev of res.body.data) {
      expect(rev).toEqual(
        expect.objectContaining({
          id: expect.any(Number),
          attachment_id: expect.any(Number),
          revision_no: expect.any(Number),
        }),
      );
      // Internal storage metadata MUST NOT leak through this endpoint.
      expect(rev).not.toHaveProperty('storage_key');
      expect(rev).not.toHaveProperty('sha256');
      expect(rev).not.toHaveProperty('bytes');
      expect(rev).not.toHaveProperty('created_by');
    }
  });

  it('returns 200 for administrator and trims internal metadata', async () => {
    const { app, listingId, attachmentId } = await seedListingWithAttachment('merchant');
    const admin = await createUserAndLogin({ role: 'administrator' });

    const res = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/attachments/${attachmentId}/revisions`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    for (const rev of res.body.data) {
      expect(rev).not.toHaveProperty('storage_key');
      expect(rev).not.toHaveProperty('sha256');
    }
  });
});

describe('DELETE /api/v1/listings/:listingId/attachments/:id', () => {
  it('soft-deletes an attachment', async () => {
    const { accessToken, userId, officeId, csrf } = await createUserAndLogin();
    const listingId = await createTestListing(userId, officeId);
    const app = createTestApp();
    const jpeg = await createTestJpeg();

    // Upload
    const uploadRes = await supertest(app.callback())
      .post(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4())
      .attach('file', jpeg, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    const attachmentId = uploadRes.body.data.attachment.id;

    // Delete
    const deleteRes = await supertest(app.callback())
      .delete(`/api/v1/listings/${listingId}/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', uuidv4());

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.ok).toBe(true);

    // Verify it's gone from list
    const listRes = await supertest(app.callback())
      .get(`/api/v1/listings/${listingId}/attachments`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(listRes.body.data.length).toBe(0);
  });
});
