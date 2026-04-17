import { Knex as KnexType } from 'knex';
import defaultKnex from '../db/knex';
import { Clock, systemClock } from '../clock';
import { StorageRepository, storageRepository } from '../storage/repository';
import { expireOldExports } from '../services/exportService';
import { logger } from '../logger';
import { hardDeleteListingInTransaction } from '../services/listingPurge';

function getDb(knex?: KnexType): KnexType {
  return knex ?? defaultKnex;
}

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

const BATCH_SIZE = 100;
const AUDIT_BATCH_SIZE = 1000;
const LISTING_RETENTION_DAYS = 90;
const AUDIT_RETENTION_DAYS = 365;

/**
 * Purge listings soft-deleted more than 90 days ago.
 * Hard-deletes listing and all children in batches of 100.
 *
 * Per PRD §8.13, the 90-day retention purge is responsible for removing the
 * listing AND its attachment blobs in the same path; orphan-sweep is only a
 * safety net. We collect storage keys inside the per-listing transaction and
 * delete the blobs immediately after the transaction commits.
 */
export async function purgeListings(
  knex?: KnexType,
  clock: Clock = systemClock,
  storage: StorageRepository = storageRepository,
): Promise<{ deleted: number }> {
  const db = getDb(knex);
  const now = clock.now();
  const cutoff = new Date(now.getTime() - LISTING_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoffStr = formatDatetime(cutoff);

  let deleted = 0;
  let hasMore = true;

  while (hasMore) {
    const listings = await db('listings')
      .whereNotNull('soft_deleted_at')
      .where('soft_deleted_at', '<', cutoffStr)
      .limit(BATCH_SIZE)
      .select('id');

    if (listings.length === 0) {
      hasMore = false;
      break;
    }

    for (const listing of listings) {
      // Delegate the FK-safe delete order to the shared listingPurge service
      // so the admin immediate-purge path and the nightly retention path
      // cannot drift apart.
      let blobKeys: string[] = [];
      await db.transaction(async (trx) => {
        const result = await hardDeleteListingInTransaction(trx, listing.id);
        blobKeys = result.blobKeys;
      });

      // Delete blobs after the DB transaction commits. Tolerate per-key
      // failures so one missing blob does not stall the batch.
      for (const key of new Set(blobKeys)) {
        try {
          await storage.delete(key);
        } catch (err) {
          logger.warn({ key, err }, 'retention.listings_purge: failed to delete blob');
        }
      }

      deleted++;
    }

    if (listings.length < BATCH_SIZE) {
      hasMore = false;
    }
  }

  return { deleted };
}

/**
 * Compact audit log by deleting entries older than 1 year (without legal_hold).
 * Processes in batches of 1000.
 */
export async function compactAuditLog(
  knex?: KnexType,
  clock: Clock = systemClock,
): Promise<{ deleted: number }> {
  const db = getDb(knex);
  const now = clock.now();
  const cutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoffStr = formatDatetime(cutoff);

  let deleted = 0;
  let hasMore = true;

  while (hasMore) {
    const rows = await db('audit_log')
      .where('created_at', '<', cutoffStr)
      .where('legal_hold', 0)
      .limit(AUDIT_BATCH_SIZE)
      .select('id');

    if (rows.length === 0) {
      hasMore = false;
      break;
    }

    const ids = rows.map((r: { id: number }) => r.id);
    await db('audit_log').whereIn('id', ids).delete();
    deleted += ids.length;

    if (rows.length < AUDIT_BATCH_SIZE) {
      hasMore = false;
    }
  }

  return { deleted };
}

/**
 * Purge expired export jobs.
 */
export async function purgeExpiredExports(
  storage: StorageRepository,
  knex?: KnexType,
  clock: Clock = systemClock,
): Promise<{ expired: number }> {
  return expireOldExports(storage, knex, clock);
}
