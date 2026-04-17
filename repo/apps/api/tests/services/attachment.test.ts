import { Knex as KnexType } from 'knex';
import sharp from 'sharp';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import { TestClock } from '../../src/clock';
import { InMemoryRepository } from '../../src/storage/repository';
import {
  uploadAttachment,
  getAttachments,
  softDeleteAttachment,
  getRevisions,
  rollbackAttachment,
} from '../../src/services/attachment';

let testKnex: KnexType;
let clock: TestClock;
let storage: InMemoryRepository;

// Create an in-memory JPEG buffer for testing
async function createTestJpeg(width = 100, height = 80): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function setupOfficeAndUser(officeId = 1, userId = 1): Promise<void> {
  const officeExists = await testKnex('offices').where({ id: officeId }).first();
  if (!officeExists) {
    await testKnex('offices').insert({ id: officeId, name: 'Test Office', code: `OFF${officeId}`, active: 1 });
  }
  const userExists = await testKnex('users').where({ id: userId }).first();
  if (!userExists) {
    await testKnex('users').insert({
      id: userId,
      username: `testuser${userId}`,
      password_hash: 'hash',
      role: 'regular_user',
      office_id: officeId,
      status: 'active',
      failed_login_count: 0,
      must_change_password: 0,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }
}

async function createListing(officeId = 1, createdBy = 1): Promise<number> {
  const now = new Date();
  const [id] = await testKnex('listings').insert({
    office_id: officeId,
    created_by: createdBy,
    status: 'draft',
    version: 1,
    anomaly_flags: '[]',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
  return Number(id);
}

beforeAll(async () => {
  testKnex = createTestKnex();
  await runTestMigrations(testKnex);
  setAuditKnex(testKnex);
  setDefaultKnex(testKnex);
  clock = new TestClock(new Date('2024-06-01T12:00:00.000Z'));
  storage = new InMemoryRepository();
});

afterAll(async () => {
  resetAuditKnex();
  resetDefaultKnex();
  await dropTestTables(testKnex);
  await testKnex.destroy();
});

beforeEach(async () => {
  await testKnex('attachment_rejections').delete();
  await testKnex('attachment_revisions').delete();
  await testKnex('attachments').delete();
  await testKnex('event_log').delete();
  await testKnex('listing_revisions').delete();
  await testKnex('listing_status_history').delete();
  await testKnex('listings').delete();
  storage = new InMemoryRepository();
});

describe('uploadAttachment', () => {
  it('creates attachment and revision rows for a valid JPEG', async () => {
    await setupOfficeAndUser(1, 1);
    const listingId = await createListing(1, 1);
    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const buffer = await createTestJpeg();

    const result = await uploadAttachment(
      {
        listingId,
        actor,
        file: { buffer, originalname: 'photo.jpg', size: buffer.length },
        ip: '127.0.0.1',
      },
      storage,
      testKnex,
      clock,
    );

    expect('rejected' in result && result.rejected).toBeFalsy();
    const uploadResult = result as { attachment: { id: number }; duplicate: boolean };
    expect(uploadResult.duplicate).toBe(false);
    expect(uploadResult.attachment).toBeDefined();
    expect(uploadResult.attachment.id).toBeGreaterThan(0);

    // Check DB rows
    const attachmentRow = await testKnex('attachments').where({ id: uploadResult.attachment.id }).first();
    expect(attachmentRow).toBeDefined();
    expect(attachmentRow.listing_id).toBe(listingId);
    expect(attachmentRow.kind).toBe('image');

    const revisionRows = await testKnex('attachment_revisions')
      .where({ attachment_id: uploadResult.attachment.id });
    expect(revisionRows.length).toBe(1);
    expect(revisionRows[0].revision_no).toBe(1);
  });

  it('returns duplicate: true when same sha256 is uploaded twice', async () => {
    await setupOfficeAndUser(1, 1);
    const listingId = await createListing(1, 1);
    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const buffer = await createTestJpeg();

    // First upload
    await uploadAttachment(
      {
        listingId,
        actor,
        file: { buffer, originalname: 'photo.jpg', size: buffer.length },
        ip: '127.0.0.1',
      },
      storage,
      testKnex,
      clock,
    );

    // Second upload with same buffer
    const result2 = await uploadAttachment(
      {
        listingId,
        actor,
        file: { buffer, originalname: 'photo.jpg', size: buffer.length },
        ip: '127.0.0.1',
      },
      storage,
      testKnex,
      clock,
    );

    const uploadResult2 = result2 as { duplicate: boolean };
    expect(uploadResult2.duplicate).toBe(true);
  });

  it('rejects invalid file type and inserts rejection row', async () => {
    await setupOfficeAndUser(1, 1);
    const listingId = await createListing(1, 1);
    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    // A buffer that's not a valid image/video/pdf
    const buffer = Buffer.alloc(100, 0x00);

    const result = await uploadAttachment(
      {
        listingId,
        actor,
        file: { buffer, originalname: 'file.bin', size: buffer.length },
        ip: '127.0.0.1',
      },
      storage,
      testKnex,
      clock,
    );

    expect('rejected' in result && result.rejected).toBe(true);
    const rejectedResult = result as { rejected: true; rejectionCode: string };
    expect(rejectedResult.rejectionCode).toBe('invalid_type');

    const rejectionRows = await testKnex('attachment_rejections').where({ listing_id: listingId });
    expect(rejectionRows.length).toBe(1);
    expect(rejectionRows[0].reason_code).toBe('invalid_type');
  });

  it('returns quota_exceeded after 25 uploads', async () => {
    await setupOfficeAndUser(1, 1);
    const listingId = await createListing(1, 1);
    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const now = new Date().toISOString();

    // Insert 25 fake attachment rows directly
    for (let i = 0; i < 25; i++) {
      await testKnex('attachments').insert({
        listing_id: listingId,
        kind: 'image',
        original_filename: `photo${i}.jpg`,
        storage_key: `listings/${listingId}/attachments/${i}/rev_1/photo${i}.jpg`,
        sha256: `${'a'.repeat(63)}${i.toString(16).padStart(1, '0')}`,
        bytes: 1000,
        mime: 'image/jpeg',
        width: 100,
        height: 80,
        created_by: 1,
        created_at: now,
      });
    }

    const buffer = await createTestJpeg();
    const result = await uploadAttachment(
      {
        listingId,
        actor,
        file: { buffer, originalname: 'extra.jpg', size: buffer.length },
        ip: '127.0.0.1',
      },
      storage,
      testKnex,
      clock,
    );

    expect('rejected' in result && result.rejected).toBe(true);
    const rejectedResult = result as { rejected: true; rejectionCode: string };
    expect(rejectedResult.rejectionCode).toBe('quota_exceeded');
  });
});

describe('getAttachments', () => {
  it('returns non-deleted attachments for a listing', async () => {
    await setupOfficeAndUser(1, 1);
    const listingId = await createListing(1, 1);
    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const buffer = await createTestJpeg();

    await uploadAttachment(
      {
        listingId,
        actor,
        file: { buffer, originalname: 'photo.jpg', size: buffer.length },
        ip: '127.0.0.1',
      },
      storage,
      testKnex,
      clock,
    );

    const attachments = await getAttachments(listingId, actor, testKnex);
    expect(attachments.length).toBe(1);
    expect(attachments[0].listing_id).toBe(listingId);
    expect(attachments[0].kind).toBe('image');
  });
});

describe('softDeleteAttachment', () => {
  it('marks attachment as soft deleted', async () => {
    await setupOfficeAndUser(1, 1);
    const listingId = await createListing(1, 1);
    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const buffer = await createTestJpeg();

    const uploadResult = await uploadAttachment(
      {
        listingId,
        actor,
        file: { buffer, originalname: 'photo.jpg', size: buffer.length },
        ip: '127.0.0.1',
      },
      storage,
      testKnex,
      clock,
    ) as { attachment: { id: number }; duplicate: boolean };

    await softDeleteAttachment(uploadResult.attachment.id, actor, '127.0.0.1', testKnex, clock);

    const attachments = await getAttachments(listingId, actor, testKnex);
    expect(attachments.length).toBe(0);

    const row = await testKnex('attachments').where({ id: uploadResult.attachment.id }).first();
    expect(row.soft_deleted_at).not.toBeNull();
  });
});

describe('rollbackAttachment', () => {
  it('creates new revision, updates attachment, prunes old revisions beyond 5', async () => {
    await setupOfficeAndUser(1, 1);
    // Need merchant role for rollback
    const merchantUserId = 100;
    await setupOfficeAndUser(1, merchantUserId);
    await testKnex('users').where({ id: merchantUserId }).update({ role: 'merchant' });

    const listingId = await createListing(1, 1);
    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const merchantActor = { id: merchantUserId, role: 'merchant' as const, officeId: 1 };

    const buffer = await createTestJpeg();

    const uploadResult = await uploadAttachment(
      {
        listingId,
        actor,
        file: { buffer, originalname: 'photo.jpg', size: buffer.length },
        ip: '127.0.0.1',
      },
      storage,
      testKnex,
      clock,
    ) as { attachment: { id: number }; duplicate: boolean };

    const attId = uploadResult.attachment.id;

    // Insert 5 more revisions with real blobs (total 6, so one should get pruned when we add rev 7)
    const now = new Date().toISOString();
    for (let i = 2; i <= 6; i++) {
      const fakeKey = `listings/${listingId}/attachments/${attId}/rev_${i}/original_photo.jpg`;
      // Write a real blob at the fake revision key so rollback can read it
      await storage.write(fakeKey, buffer);
      await testKnex('attachment_revisions').insert({
        attachment_id: attId,
        revision_no: i,
        storage_key: fakeKey,
        sha256: `${'b'.repeat(63)}${i}`,
        bytes: buffer.length,
        pruned: 0,
        created_by: 1,
        created_at: now,
      });
    }

    // Roll back to revision 1
    const updated = await rollbackAttachment(attId, 1, merchantActor, '127.0.0.1', testKnex, storage, clock);

    expect(updated.id).toBe(attId);

    // Should have a new revision 7
    const revisions = await testKnex('attachment_revisions').where({ attachment_id: attId }).orderBy('revision_no', 'asc');
    expect(revisions.length).toBe(7);

    const newest = revisions[revisions.length - 1];
    expect(newest.revision_no).toBe(7);

    // Oldest ones beyond 5 should be pruned
    const prunedRevisions = revisions.filter((r: { pruned: number }) => r.pruned === 1);
    expect(prunedRevisions.length).toBe(2); // rev 1 and rev 2 should be pruned
  });

  it('reprocesses image and updates live metadata on rollback (PRD image pipeline contract)', async () => {
    await setupOfficeAndUser(1, 1);
    const merchantUserId = 200;
    await setupOfficeAndUser(1, merchantUserId);
    await testKnex('users').where({ id: merchantUserId }).update({ role: 'merchant' });

    const listingId = await createListing(1, 1);
    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const merchantActor = { id: merchantUserId, role: 'merchant' as const, officeId: 1 };

    // Upload an oversized 3000x3000 image — pipeline must downscale to 2048 max edge
    const original = await createTestJpeg(3000, 3000);

    const uploadResult = await uploadAttachment(
      {
        listingId,
        actor,
        file: { buffer: original, originalname: 'big.jpg', size: original.length },
        ip: '127.0.0.1',
      },
      storage,
      testKnex,
      clock,
    ) as { attachment: { id: number }; duplicate: boolean };

    const attId = uploadResult.attachment.id;

    // Replace with a smaller image so revision 1 (the original 3000x3000) is no longer current
    const replacement = await createTestJpeg(500, 500);
    const { replaceAttachment } = await import('../../src/services/attachment');
    await replaceAttachment(
      {
        attachmentId: attId,
        actor: merchantActor,
        file: { buffer: replacement, originalname: 'small.jpg', size: replacement.length },
        ip: '127.0.0.1',
      },
      storage,
      testKnex,
      clock,
    );

    // Sanity: live attachment is now the small (500x500) processed asset
    const beforeRollback = await testKnex('attachments').where({ id: attId }).first();
    expect(Number(beforeRollback.width)).toBe(500);
    expect(Number(beforeRollback.height)).toBe(500);

    // Roll back to revision 1 (the preserved 3000x3000 original)
    await rollbackAttachment(attId, 1, merchantActor, '127.0.0.1', testKnex, storage, clock);

    const afterRollback = await testKnex('attachments').where({ id: attId }).first();

    // PRD image pipeline contract:
    //   - long edge must be ≤ 2048 (the original was 3000, so it must be downscaled)
    //   - mime must be a re-encoded image format (jpeg or webp)
    //   - width/height/mime/original_filename must reflect the *live* (processed) blob,
    //     not the preserved original
    expect(Math.max(Number(afterRollback.width), Number(afterRollback.height))).toBeLessThanOrEqual(2048);
    expect(['image/jpeg', 'image/webp']).toContain(String(afterRollback.mime));
    // Rollback updates original_filename consistently with the metadata it sets;
    // the field is non-null and a real string (revisions don't carry per-rev filenames,
    // so the current attachment row's filename is propagated).
    expect(String(afterRollback.original_filename).length).toBeGreaterThan(0);

    // The live storage_key must point at the new processed blob, NOT at the preserved original
    const liveKey = String(afterRollback.storage_key);
    expect(liveKey).not.toMatch(/original_/);

    // Verify the blob at the live key really has the processed dimensions
    const liveBlob = await storage.read(liveKey);
    const meta = await sharp(liveBlob).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(2048);
    // EXIF must be stripped
    expect(meta.exif).toBeUndefined();

    // The new revision row must still preserve the *original* binary
    const newRevisionId = Number(afterRollback.current_revision_id);
    const newRevision = await testKnex('attachment_revisions').where({ id: newRevisionId }).first();
    expect(String(newRevision.storage_key)).toMatch(/original_/);
    const preservedOriginal = await storage.read(String(newRevision.storage_key));
    const preservedMeta = await sharp(preservedOriginal).metadata();
    // The preserved original is 3000x3000 (unprocessed) — NOT downscaled
    expect(Math.max(preservedMeta.width ?? 0, preservedMeta.height ?? 0)).toBe(3000);
  });

  // Defense-in-depth regression for the prior audit finding: the route
  // blocked `operations` from rollback, but the service-layer guard used
  // to silently allow it — so a future internal caller bypassing the
  // route could have granted operations a merchant/admin-only capability.
  // The service must itself deny operations.
  it('denies operations role at the service layer (defense-in-depth)', async () => {
    await setupOfficeAndUser(1, 1);
    const merchantUserId = 300;
    await setupOfficeAndUser(1, merchantUserId);
    await testKnex('users').where({ id: merchantUserId }).update({ role: 'merchant' });

    const opsUserId = 301;
    await setupOfficeAndUser(1, opsUserId);
    await testKnex('users').where({ id: opsUserId }).update({ role: 'operations' });

    const listingId = await createListing(1, 1);
    const regularActor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const opsActor = { id: opsUserId, role: 'operations' as const, officeId: 1 };

    const buffer = await createTestJpeg();

    const uploadResult = await uploadAttachment(
      {
        listingId,
        actor: regularActor,
        file: { buffer, originalname: 'photo.jpg', size: buffer.length },
        ip: '127.0.0.1',
      },
      storage,
      testKnex,
      clock,
    ) as { attachment: { id: number }; duplicate: boolean };

    const attId = uploadResult.attachment.id;

    await expect(
      rollbackAttachment(attId, 1, opsActor, '127.0.0.1', testKnex, storage, clock),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('denies merchant from a different office at the service layer', async () => {
    await setupOfficeAndUser(1, 1);
    // Office 2 exists for the off-office merchant
    await setupOfficeAndUser(2, 400);
    await testKnex('users').where({ id: 400 }).update({ role: 'merchant', office_id: 2 });

    const listingId = await createListing(1, 1);
    const regularActor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const foreignMerchantActor = { id: 400, role: 'merchant' as const, officeId: 2 };

    const buffer = await createTestJpeg();
    const uploadResult = await uploadAttachment(
      {
        listingId,
        actor: regularActor,
        file: { buffer, originalname: 'photo.jpg', size: buffer.length },
        ip: '127.0.0.1',
      },
      storage,
      testKnex,
      clock,
    ) as { attachment: { id: number }; duplicate: boolean };

    const attId = uploadResult.attachment.id;

    await expect(
      rollbackAttachment(attId, 1, foreignMerchantActor, '127.0.0.1', testKnex, storage, clock),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
