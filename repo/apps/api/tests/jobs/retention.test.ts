import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import { purgeListings, compactAuditLog } from '../../src/jobs/retention';
import { TestClock } from '../../src/clock';
import { InMemoryRepository } from '../../src/storage/repository';

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
  await testKnex('listing_status_history').delete();
  await testKnex('listing_revisions').delete();
  await testKnex('attachment_revisions').delete();
  await testKnex('attachments').delete();
  await testKnex('listings').delete();
  await testKnex('audit_log').delete();
  await testKnex('users').delete();
  await testKnex('offices').delete();
});

async function createOffice(): Promise<number> {
  const [id] = await testKnex('offices').insert({ name: 'Test Office', code: `O${Date.now()}`, active: 1 });
  return id;
}

async function createUser(officeId: number): Promise<number> {
  const now = new Date();
  const [id] = await testKnex('users').insert({
    username: `user_${Date.now()}`,
    password_hash: 'hash',
    role: 'regular_user',
    office_id: officeId,
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: formatDatetime(now),
    updated_at: formatDatetime(now),
  });
  return id;
}

async function createListing(officeId: number, userId: number, softDeletedAt: Date | null = null): Promise<number> {
  const now = new Date();
  const [id] = await testKnex('listings').insert({
    office_id: officeId,
    created_by: userId,
    status: 'draft',
    version: 1,
    soft_deleted_at: softDeletedAt ? formatDatetime(softDeletedAt) : null,
    created_at: formatDatetime(now),
    updated_at: formatDatetime(now),
  });
  return id;
}

describe('purgeListings', () => {
  it('hard-deletes listings soft-deleted more than 90 days ago', async () => {
    const now = new Date('2024-06-01T00:00:00Z');
    const clock = new TestClock(now);
    const officeId = await createOffice();
    const userId = await createUser(officeId);

    // Listing soft-deleted 100 days ago (should be purged)
    const oldDeletedAt = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);
    const listing1 = await createListing(officeId, userId, oldDeletedAt);

    // Listing soft-deleted 30 days ago (should NOT be purged)
    const recentDeletedAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const listing2 = await createListing(officeId, userId, recentDeletedAt);

    // Listing not deleted (should NOT be purged)
    const listing3 = await createListing(officeId, userId, null);

    const result = await purgeListings(testKnex, clock);

    expect(result.deleted).toBe(1);

    // listing1 should be gone
    const l1 = await testKnex('listings').where({ id: listing1 }).first();
    expect(l1).toBeUndefined();

    // listing2 should still be there
    const l2 = await testKnex('listings').where({ id: listing2 }).first();
    expect(l2).toBeDefined();

    // listing3 should still be there
    const l3 = await testKnex('listings').where({ id: listing3 }).first();
    expect(l3).toBeDefined();
  });

  it('also deletes attachment_revisions, attachments, and storage blobs', async () => {
    const now = new Date('2024-06-01T00:00:00Z');
    const clock = new TestClock(now);
    const officeId = await createOffice();
    const userId = await createUser(officeId);

    const oldDeletedAt = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);
    const listingId = await createListing(officeId, userId, oldDeletedAt);

    // Stand up an in-memory storage with the blob present so the purge
    // can delete it as part of the same path (PRD §8.13).
    const storage = new InMemoryRepository();
    await storage.write('test/key.jpg', Buffer.from('current'));
    await storage.write('test/key_v1.jpg', Buffer.from('rev1'));

    // Add attachment
    const [attachId] = await testKnex('attachments').insert({
      listing_id: listingId,
      kind: 'photo',
      original_filename: 'test.jpg',
      storage_key: 'test/key.jpg',
      sha256: 'abc123',
      bytes: 1024,
      mime: 'image/jpeg',
      created_by: userId,
      created_at: formatDatetime(now),
    });

    // Add attachment revision
    await testKnex('attachment_revisions').insert({
      attachment_id: attachId,
      revision_no: 1,
      storage_key: 'test/key_v1.jpg',
      sha256: 'abc123',
      bytes: 1024,
      pruned: 0,
      created_by: userId,
      created_at: formatDatetime(now),
    });

    await purgeListings(testKnex, clock, storage);

    const attachments = await testKnex('attachments').where({ listing_id: listingId });
    expect(attachments.length).toBe(0);

    const revisions = await testKnex('attachment_revisions').where({ attachment_id: attachId });
    expect(revisions.length).toBe(0);

    // Storage blobs must be gone in the same path — orphan-sweep is a safety
    // net, not the primary mechanism.
    expect(await storage.exists('test/key.jpg')).toBe(false);
    expect(await storage.exists('test/key_v1.jpg')).toBe(false);
  });
});

describe('compactAuditLog', () => {
  it('deletes audit entries older than 1 year without legal_hold', async () => {
    const now = new Date('2024-06-01T00:00:00Z');
    const clock = new TestClock(now);

    // Entry older than 1 year (should be deleted)
    const oldDate = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000);
    await testKnex('audit_log').insert({
      prev_hash: '0'.repeat(64),
      row_hash: 'a'.repeat(64),
      action: 'old.action',
      legal_hold: 0,
      created_at: formatDatetime(oldDate),
    });

    // Entry older than 1 year WITH legal_hold (should NOT be deleted)
    await testKnex('audit_log').insert({
      prev_hash: 'a'.repeat(64),
      row_hash: 'b'.repeat(64),
      action: 'old.legal',
      legal_hold: 1,
      created_at: formatDatetime(oldDate),
    });

    // Recent entry (should NOT be deleted)
    const recentDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    await testKnex('audit_log').insert({
      prev_hash: 'b'.repeat(64),
      row_hash: 'c'.repeat(64),
      action: 'recent.action',
      legal_hold: 0,
      created_at: formatDatetime(recentDate),
    });

    const result = await compactAuditLog(testKnex, clock);

    expect(result.deleted).toBe(1);

    const remaining = await testKnex('audit_log').select('action');
    const actions = remaining.map((r: { action: string }) => r.action);
    expect(actions).toContain('old.legal');
    expect(actions).toContain('recent.action');
    expect(actions).not.toContain('old.action');
  });
});
