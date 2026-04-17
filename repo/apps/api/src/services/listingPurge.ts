/**
 * Shared listing hard-delete implementation.
 *
 * This is the ONE place where a listing and every one of its FK-bound
 * children are removed from the database. Both the admin immediate purge
 * (PRD §8.13) and the 90-day retention job call through here so the delete
 * order — and therefore the production MySQL FK contract — cannot drift
 * between the two paths.
 *
 * Order matters: children first, parent last.
 *
 *   attachment_revisions (FK → attachments.id)
 *   attachments          (FK → listings.id, users.id)
 *   attachment_rejections (FK → listings.id)  — NEW: caller must remove
 *   promo_slots          (FK → listings.id, promo_collections.id, users.id)
 *   listing_revisions    (FK → listings.id)
 *   listing_status_history (FK → listings.id)
 *   listings             (target)
 *
 * Storage keys for attachment + revision blobs are collected inside the
 * transaction and returned to the caller so the caller can delete the blobs
 * AFTER the transaction commits (blob IO must not run inside the DB tx).
 */
import { Knex as KnexType } from 'knex';

export interface PurgeListingResult {
  /** Every storage key referenced by the deleted attachments + revisions. */
  blobKeys: string[];
  /** Number of attachment rows removed (for audit / stats). */
  attachmentsDeleted: number;
}

export async function hardDeleteListingInTransaction(
  trx: KnexType.Transaction,
  listingId: number,
): Promise<PurgeListingResult> {
  const blobKeys: string[] = [];

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
  // FK children that reference listings.id directly — must be gone before
  // the parent row to satisfy the production MySQL FK constraints in
  // migrations 20240101000015 (attachment_rejections) and 20240101000016
  // (promo_slots).
  await trx('attachment_rejections').where({ listing_id: listingId }).delete();
  await trx('promo_slots').where({ listing_id: listingId }).delete();
  await trx('listing_revisions').where({ listing_id: listingId }).delete();
  await trx('listing_status_history').where({ listing_id: listingId }).delete();
  await trx('listings').where({ id: listingId }).delete();

  return { blobKeys, attachmentsDeleted: attachments.length };
}

/**
 * Bulk variant — same contract, applied to a batch of listing ids in one trx.
 * Used by the retention purge job to amortize the transaction overhead.
 */
export async function hardDeleteListingsInTransaction(
  trx: KnexType.Transaction,
  listingIds: number[],
): Promise<PurgeListingResult> {
  if (listingIds.length === 0) return { blobKeys: [], attachmentsDeleted: 0 };

  const blobKeys: string[] = [];

  const attachments = await trx('attachments')
    .whereIn('listing_id', listingIds)
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

  await trx('attachments').whereIn('listing_id', listingIds).delete();
  await trx('attachment_rejections').whereIn('listing_id', listingIds).delete();
  await trx('promo_slots').whereIn('listing_id', listingIds).delete();
  await trx('listing_revisions').whereIn('listing_id', listingIds).delete();
  await trx('listing_status_history').whereIn('listing_id', listingIds).delete();
  await trx('listings').whereIn('id', listingIds).delete();

  return { blobKeys, attachmentsDeleted: attachments.length };
}
