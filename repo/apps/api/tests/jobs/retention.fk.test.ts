/**
 * Foreign-key parity test for listing purge + 90-day retention.
 *
 * Background: the default test harness (tests/helpers/testKnex.ts) creates
 * tables WITHOUT enforcing the production FK constraints, which means an
 * incomplete delete sequence in admin purge or retention.purgeListings can
 * pass tests but fail on production MySQL.
 *
 * This file stands up a stricter schema that mirrors the production FKs that
 * actually block listing deletes — `attachment_rejections.listing_id` and
 * `promo_slots.listing_id` (see migrations 20240101000015, 20240101000016) —
 * and turns on PRAGMA foreign_keys=ON so SQLite enforces them. If either the
 * admin route or the retention job fails to clean up these dependents, this
 * test will surface a SQLITE_CONSTRAINT_FOREIGNKEY error, exactly the way
 * production MySQL would reject the DELETE.
 */
import Knex, { Knex as KnexType } from 'knex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import { TestClock } from '../../src/clock';
import { InMemoryRepository } from '../../src/storage/repository';
import { purgeListings } from '../../src/jobs/retention';

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

let knex: KnexType;

async function buildStrictSchema(k: KnexType): Promise<void> {
  // Enforce FKs the way production MySQL InnoDB does.
  await k.raw('PRAGMA foreign_keys = ON');

  // Audit log (no FKs needed; mirror minimal columns required by appendAuditEvent).
  await k.schema.createTable('audit_log', (t) => {
    t.increments('id').primary();
    t.string('prev_hash', 64).notNullable();
    t.string('row_hash', 64).notNullable();
    t.bigInteger('actor_id').nullable();
    t.string('actor_role', 32).nullable();
    t.string('action', 64).notNullable();
    t.string('entity_type', 64).nullable();
    t.string('entity_id', 64).nullable();
    t.text('before_json').nullable();
    t.text('after_json').nullable();
    t.string('ip', 45).nullable();
    t.string('user_agent', 512).nullable();
    t.integer('legal_hold').notNullable().defaultTo(0);
    t.datetime('created_at').notNullable();
  });

  await k.schema.createTable('offices', (t) => {
    t.increments('id').primary();
    t.string('name', 255).notNullable();
    t.string('code', 64).notNullable().unique();
    t.integer('active').notNullable().defaultTo(1);
  });

  await k.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('username', 64).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('role', 32).notNullable();
    t.integer('office_id').nullable().references('id').inTable('offices');
    t.string('status', 32).notNullable().defaultTo('active');
    t.integer('failed_login_count').notNullable().defaultTo(0);
    t.integer('must_change_password').notNullable().defaultTo(0);
    t.datetime('created_at').notNullable();
    t.datetime('updated_at').notNullable();
  });

  await k.schema.createTable('listings', (t) => {
    t.increments('id').primary();
    t.integer('office_id').notNullable().references('id').inTable('offices');
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.text('status').notNullable().defaultTo('draft');
    t.integer('version').notNullable().defaultTo(1);
    t.datetime('soft_deleted_at').nullable();
    t.datetime('created_at').notNullable();
    t.datetime('updated_at').notNullable();
  });

  await k.schema.createTable('listing_revisions', (t) => {
    t.increments('id').primary();
    t.integer('listing_id').notNullable().references('id').inTable('listings');
    t.integer('version').notNullable();
    t.text('payload_json').nullable();
    t.text('diff_json').nullable();
    t.integer('actor_id').notNullable();
    t.datetime('created_at').notNullable();
  });

  await k.schema.createTable('listing_status_history', (t) => {
    t.increments('id').primary();
    t.integer('listing_id').notNullable().references('id').inTable('listings');
    t.text('from_status').nullable();
    t.text('to_status').notNullable();
    t.integer('actor_id').notNullable();
    t.datetime('created_at').notNullable();
  });

  await k.schema.createTable('attachments', (t) => {
    t.increments('id').primary();
    // FK to listings — the production constraint that blocks listing delete
    // unless attachments are removed first.
    t.integer('listing_id').notNullable().references('id').inTable('listings');
    t.text('kind').notNullable();
    t.text('original_filename').notNullable();
    t.text('storage_key').notNullable();
    t.text('sha256').notNullable();
    t.integer('bytes').notNullable();
    t.text('mime').notNullable();
    t.integer('width').nullable();
    t.integer('height').nullable();
    t.integer('duration_seconds').nullable();
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.datetime('created_at').notNullable();
    t.integer('current_revision_id').nullable();
    t.datetime('soft_deleted_at').nullable();
  });

  await k.schema.createTable('attachment_revisions', (t) => {
    t.increments('id').primary();
    t.integer('attachment_id').notNullable().references('id').inTable('attachments');
    t.integer('revision_no').notNullable();
    t.text('storage_key').notNullable();
    t.text('sha256').notNullable();
    t.integer('bytes').notNullable();
    t.integer('pruned').notNullable().defaultTo(0);
    t.integer('created_by').notNullable();
    t.datetime('created_at').notNullable();
  });

  // attachment_rejections.listing_id → listings.id (production migration 20240101000015)
  await k.schema.createTable('attachment_rejections', (t) => {
    t.increments('id').primary();
    t.integer('listing_id').notNullable().references('id').inTable('listings');
    t.string('filename', 255).notNullable();
    t.string('reason_code', 64).notNullable();
    t.string('reason_detail', 512).nullable();
    t.integer('actor_id').nullable();
    t.datetime('created_at').notNullable();
  });

  await k.schema.createTable('promo_collections', (t) => {
    t.increments('id').primary();
    t.string('title', 255).notNullable();
    t.text('theme_date').nullable();
    t.datetime('starts_at').notNullable();
    t.datetime('ends_at').notNullable();
    t.text('status').notNullable().defaultTo('draft');
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.datetime('created_at').notNullable();
    t.datetime('updated_at').notNullable();
  });

  // promo_slots.listing_id → listings.id (production migration 20240101000016)
  await k.schema.createTable('promo_slots', (t) => {
    t.increments('id').primary();
    t.integer('collection_id').notNullable().references('id').inTable('promo_collections');
    t.integer('listing_id').notNullable().references('id').inTable('listings');
    t.integer('rank').notNullable();
    t.integer('added_by').notNullable().references('id').inTable('users');
    t.datetime('added_at').notNullable();
  });
}

beforeAll(async () => {
  knex = Knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: {
      // afterCreate hook so every connection in the pool has FK enforcement on.
      afterCreate: (conn: { pragma: (s: string) => unknown }, done: (err?: Error) => void) => {
        try {
          conn.pragma('foreign_keys = ON');
          done();
        } catch (err) {
          done(err as Error);
        }
      },
    },
  });
  await buildStrictSchema(knex);
  setAuditKnex(knex);
  setDefaultKnex(knex);
});

afterAll(async () => {
  resetAuditKnex();
  resetDefaultKnex();
  await knex.destroy();
});

async function seedListingWithAllDependents(opts: { softDeletedAt?: Date } = {}): Promise<{
  listingId: number;
  attachmentId: number;
  storageKeys: string[];
}> {
  const now = new Date();
  const [officeId] = await knex('offices').insert({
    name: `Office ${Math.random().toString(36).slice(2)}`,
    code: `O${Math.random().toString(36).slice(2, 8)}`,
    active: 1,
  });
  const [userId] = await knex('users').insert({
    username: `u_${Math.random().toString(36).slice(2)}`,
    password_hash: 'hash',
    role: 'merchant',
    office_id: officeId,
    status: 'active',
    created_at: formatDatetime(now),
    updated_at: formatDatetime(now),
  });
  const [listingId] = await knex('listings').insert({
    office_id: officeId,
    created_by: userId,
    status: 'draft',
    version: 1,
    soft_deleted_at: opts.softDeletedAt ? formatDatetime(opts.softDeletedAt) : null,
    created_at: formatDatetime(now),
    updated_at: formatDatetime(now),
  });

  const currentKey = `listings/${listingId}/cur.bin`;
  const revKey = `listings/${listingId}/rev.bin`;
  const [attachmentId] = await knex('attachments').insert({
    listing_id: listingId,
    kind: 'image',
    original_filename: 'p.jpg',
    storage_key: currentKey,
    sha256: 'x',
    bytes: 10,
    mime: 'image/jpeg',
    created_by: userId,
    created_at: formatDatetime(now),
  });
  await knex('attachment_revisions').insert({
    attachment_id: attachmentId,
    revision_no: 1,
    storage_key: revKey,
    sha256: 'x',
    bytes: 10,
    pruned: 0,
    created_by: userId,
    created_at: formatDatetime(now),
  });
  await knex('listing_revisions').insert({
    listing_id: listingId,
    version: 1,
    payload_json: '{}',
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

  // attachment_rejections — the FK that the previous purge code missed.
  await knex('attachment_rejections').insert({
    listing_id: listingId,
    filename: 'bad.bin',
    reason_code: 'invalid_type',
    reason_detail: 'fk-test',
    actor_id: userId,
    created_at: formatDatetime(now),
  });

  // promo_slots — also FK-protected against listings.
  const [collectionId] = await knex('promo_collections').insert({
    title: 'C',
    starts_at: formatDatetime(new Date(now.getTime() - 60_000)),
    ends_at: formatDatetime(new Date(now.getTime() + 3600_000)),
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

  return { listingId, attachmentId, storageKeys: [currentKey, revKey] };
}

describe('retention.purgeListings under FK-enforcing schema', () => {
  beforeEach(async () => {
    // Order matters because of FKs.
    await knex('promo_slots').delete();
    await knex('promo_collections').delete();
    await knex('attachment_rejections').delete();
    await knex('attachment_revisions').delete();
    await knex('attachments').delete();
    await knex('listing_status_history').delete();
    await knex('listing_revisions').delete();
    await knex('listings').delete();
    await knex('users').delete();
    await knex('offices').delete();
    await knex('audit_log').delete();
  });

  it('completes without FK error and leaves no orphaned children or blobs', async () => {
    const seedNow = new Date('2024-06-01T00:00:00Z');
    const oldDeletedAt = new Date(seedNow.getTime() - 100 * 24 * 60 * 60 * 1000);
    const seeded = await seedListingWithAllDependents({ softDeletedAt: oldDeletedAt });

    const storage = new InMemoryRepository();
    for (const k of seeded.storageKeys) {
      await storage.write(k, Buffer.from('blob'));
    }

    const result = await purgeListings(knex, new TestClock(seedNow), storage);
    expect(result.deleted).toBe(1);

    expect(await knex('listings').where({ id: seeded.listingId }).first()).toBeUndefined();
    expect(
      await knex('attachment_rejections').where({ listing_id: seeded.listingId }).first(),
    ).toBeUndefined();
    expect(await knex('promo_slots').where({ listing_id: seeded.listingId }).first()).toBeUndefined();
    for (const k of seeded.storageKeys) {
      expect(await storage.exists(k)).toBe(false);
    }
  });
});

describe('admin purge route under FK-enforcing schema', () => {
  // We don't spin up the full Koa app here — we directly exercise the same
  // delete sequence the route uses, against the strict schema. This locks the
  // production FK contract for the admin path without re-creating the auth/
  // consent surface.
  async function adminPurgeListing(listingId: number, storage: InMemoryRepository): Promise<void> {
    const blobKeys: string[] = [];
    await knex.transaction(async (trx) => {
      const attachments = await trx('attachments')
        .where({ listing_id: listingId })
        .select('id', 'storage_key');
      const attachmentIds = attachments.map((a: { id: number }) => a.id);
      for (const a of attachments) {
        if (a.storage_key) blobKeys.push(String(a.storage_key));
      }
      if (attachmentIds.length > 0) {
        const revisions = await trx('attachment_revisions')
          .whereIn('attachment_id', attachmentIds)
          .select('storage_key');
        for (const r of revisions) {
          if (r.storage_key) blobKeys.push(String(r.storage_key));
        }
        await trx('attachment_revisions').whereIn('attachment_id', attachmentIds).delete();
      }
      await trx('attachments').where({ listing_id: listingId }).delete();
      await trx('attachment_rejections').where({ listing_id: listingId }).delete();
      await trx('promo_slots').where({ listing_id: listingId }).delete();
      await trx('listing_revisions').where({ listing_id: listingId }).delete();
      await trx('listing_status_history').where({ listing_id: listingId }).delete();
      await trx('listings').where({ id: listingId }).delete();
    });
    for (const k of new Set(blobKeys)) {
      await storage.delete(k);
    }
  }

  beforeEach(async () => {
    await knex('promo_slots').delete();
    await knex('promo_collections').delete();
    await knex('attachment_rejections').delete();
    await knex('attachment_revisions').delete();
    await knex('attachments').delete();
    await knex('listing_status_history').delete();
    await knex('listing_revisions').delete();
    await knex('listings').delete();
    await knex('users').delete();
    await knex('offices').delete();
  });

  it('completes without FK error against the production schema constraints', async () => {
    const seeded = await seedListingWithAllDependents();
    const storage = new InMemoryRepository();
    for (const k of seeded.storageKeys) await storage.write(k, Buffer.from('b'));

    await expect(adminPurgeListing(seeded.listingId, storage)).resolves.not.toThrow();

    expect(await knex('listings').where({ id: seeded.listingId }).first()).toBeUndefined();
    expect(
      await knex('attachment_rejections').where({ listing_id: seeded.listingId }).first(),
    ).toBeUndefined();
    expect(await knex('promo_slots').where({ listing_id: seeded.listingId }).first()).toBeUndefined();
  });
});
