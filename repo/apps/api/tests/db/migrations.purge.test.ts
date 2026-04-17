/**
 * Destructive-flow purge test that runs against the REAL migration graph.
 *
 * The rest of the API test suite uses a hand-rolled SQLite schema for speed
 * (tests/helpers/testKnex.ts). That's fine for unit-level coverage but it
 * cannot catch production FK regressions — the real migrations declare
 * constraints like `attachment_rejections.listing_id → listings.id` and
 * `promo_slots.listing_id → listings.id` that the hand-rolled schema omits.
 *
 * This file applies the actual migration files (src/db/migrations/*) to a
 * MySQL instance, seeds a listing with every dependent row the production
 * schema knows about, then exercises the shared listing-purge service
 * (src/services/listingPurge.ts). A drift in the delete order will show up
 * as a real MySQL FK constraint error here.
 *
 * Skipped automatically unless HARBORSTONE_TEST_MYSQL_URL is set (e.g.
 * `mysql://harborstone:pass@127.0.0.1:3306/hs_migration_test`). CI provides
 * this via the compose test stack; local runs may set it manually.
 */
import path from 'path';
import Knex, { Knex as KnexType } from 'knex';
import { hardDeleteListingInTransaction } from '../../src/services/listingPurge';

const mysqlUrl = process.env.HARBORSTONE_TEST_MYSQL_URL;
const describeIfMysql = mysqlUrl ? describe : describe.skip;

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

describeIfMysql('listingPurge against the real migration graph (MySQL)', () => {
  jest.setTimeout(60_000);

  let knex: KnexType;

  beforeAll(async () => {
    knex = Knex({
      client: 'mysql2',
      connection: mysqlUrl!,
      migrations: {
        // Point at the actual production migrations so FKs are real.
        directory: path.resolve(__dirname, '../../src/db/migrations'),
        extension: 'ts',
      },
    });
    // Clean slate — then run all real migrations forward.
    await knex.migrate.rollback(undefined, true).catch(() => undefined);
    await knex.migrate.latest();
  });

  afterAll(async () => {
    if (knex) {
      await knex.migrate.rollback(undefined, true).catch(() => undefined);
      await knex.destroy();
    }
  });

  async function seedListingFixture(): Promise<{
    listingId: number;
    userId: number;
    attachmentId: number;
  }> {
    const now = new Date();
    const [officeId] = await knex('offices').insert({
      name: 'Purge FK Test Office',
      code: `PFKT_${Math.random().toString(36).slice(2, 8)}`,
      active: 1,
    });
    const [userId] = await knex('users').insert({
      username: `pfk_${Math.random().toString(36).slice(2)}`,
      password_hash: 'x'.repeat(60),
      role: 'merchant',
      office_id: officeId,
      status: 'active',
      failed_login_count: 0,
      must_change_password: 0,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });

    const [listingId] = await knex('listings').insert({
      office_id: officeId,
      created_by: userId,
      status: 'draft',
      version: 1,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });

    const [attachmentId] = await knex('attachments').insert({
      listing_id: listingId,
      kind: 'image',
      original_filename: 'p.jpg',
      storage_key: `listings/${listingId}/cur.jpg`,
      sha256: 'a'.repeat(64),
      bytes: 12,
      mime: 'image/jpeg',
      created_by: userId,
      created_at: formatDatetime(now),
    });
    await knex('attachment_revisions').insert({
      attachment_id: attachmentId,
      revision_no: 1,
      storage_key: `listings/${listingId}/rev_1.jpg`,
      sha256: 'a'.repeat(64),
      bytes: 12,
      pruned: 0,
      created_by: userId,
      created_at: formatDatetime(now),
    });
    await knex('attachment_rejections').insert({
      listing_id: listingId,
      filename: 'bad.bin',
      reason_code: 'invalid_type',
      reason_detail: 'fixture',
      actor_id: userId,
      created_at: formatDatetime(now),
    });
    await knex('listing_revisions').insert({
      listing_id: listingId,
      version: 1,
      payload_json: {},
      diff_json: null,
      actor_id: userId,
      created_at: formatDatetime(now),
    });
    await knex('listing_status_history').insert({
      listing_id: listingId,
      from_status: null,
      to_status: 'draft',
      actor_id: userId,
      created_at: formatDatetime(now),
    });

    const [collectionId] = await knex('promo_collections').insert({
      title: 'Purge Test Collection',
      starts_at: formatDatetime(new Date(now.getTime() - 60_000)),
      ends_at: formatDatetime(new Date(now.getTime() + 3_600_000)),
      status: 'draft',
      created_by: userId,
      created_at: formatDatetime(now),
      updated_at: formatDatetime(now),
    });
    await knex('promo_slots').insert({
      collection_id: collectionId,
      listing_id: listingId,
      rank: 1,
      added_by: userId,
      added_at: formatDatetime(now),
    });

    return { listingId, userId, attachmentId };
  }

  it('hardDeleteListingInTransaction completes without FK errors', async () => {
    const { listingId } = await seedListingFixture();

    await expect(
      knex.transaction(async (trx) => {
        const result = await hardDeleteListingInTransaction(trx, listingId);
        expect(result.blobKeys.length).toBeGreaterThan(0);
      }),
    ).resolves.not.toThrow();

    expect(await knex('listings').where({ id: listingId }).first()).toBeUndefined();
    expect(
      await knex('attachment_rejections').where({ listing_id: listingId }).first(),
    ).toBeUndefined();
    expect(await knex('promo_slots').where({ listing_id: listingId }).first()).toBeUndefined();
  });
});
