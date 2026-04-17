import Router from 'koa-router';
import { AppError, ErrorCodes } from '../errors';
import { requireAuth, requireConsent, requireRole } from '../middleware/auth';
import { systemClock } from '../clock';
import defaultKnex from '../db/knex';
import { appendAuditEvent } from '../audit/chain';
import { verifyChain, repairChain } from '../audit/chain';
import { consumeNonce } from '../services/nonce';
import { revokeAllUserSessions } from '../services/session';
import { storageRepository } from '../storage/repository';
import { logger } from '../logger';
import { hardDeleteListingInTransaction } from '../services/listingPurge';
import {
  getOrCreateProfile,
  applyPenalty,
  listBlacklist,
  addBlacklist,
  removeBlacklist,
  listRiskEvents,
} from '../services/risk';

const router = new Router({ prefix: '/api/v1/admin' });

function getClientIp(ctx: Router.RouterContext): string {
  const forwarded = ctx.get('X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  return ctx.ip ?? 'unknown';
}

// All admin routes require auth + consent + administrator role
router.use(requireAuth(), requireConsent(), requireRole('administrator'));

// GET /api/v1/admin/risk/:userId
router.get('/risk/:userId', async (ctx) => {
  const userId = parseInt(ctx.params.userId, 10);
  if (isNaN(userId)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid userId', 400);
  }

  const profile = await getOrCreateProfile(userId, undefined, systemClock);
  const events = await listRiskEvents(userId, 20);

  ctx.status = 200;
  ctx.body = { ok: true, data: { profile, events } };
});

// POST /api/v1/admin/risk/:userId/penalty
router.post('/risk/:userId/penalty', async (ctx) => {
  const userId = parseInt(ctx.params.userId, 10);
  if (isNaN(userId)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid userId', 400);
  }

  const body = ctx.request.body as { penaltyType?: string; detail?: Record<string, unknown> };

  if (!body.penaltyType) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'penaltyType is required', 400);
  }

  const profile = await applyPenalty(userId, body.penaltyType, body.detail ?? {}, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true, data: profile };
});

// GET /api/v1/admin/blacklist
router.get('/blacklist', async (ctx) => {
  const entries = await listBlacklist();
  ctx.status = 200;
  ctx.body = { ok: true, data: entries };
});

// POST /api/v1/admin/blacklist
router.post('/blacklist', async (ctx) => {
  const user = ctx.state.user;
  const body = ctx.request.body as {
    subjectType?: 'user' | 'ip' | 'device';
    subjectValue?: string;
    reason?: string;
    expiresAt?: string;
  };

  if (!body.subjectType || !['user', 'ip', 'device'].includes(body.subjectType)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'subjectType must be user, ip, or device', 400);
  }
  if (!body.subjectValue) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'subjectValue is required', 400);
  }
  if (!body.reason) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'reason is required', 400);
  }

  const entry = await addBlacklist({
    subjectType: body.subjectType,
    subjectValue: body.subjectValue,
    reason: body.reason,
    expiresAt: body.expiresAt,
    createdBy: Number(user.id),
  }, undefined, systemClock);

  ctx.status = 201;
  ctx.body = { ok: true, data: entry };
});

// DELETE /api/v1/admin/blacklist/:id
router.delete('/blacklist/:id', async (ctx) => {
  const user = ctx.state.user;
  const id = parseInt(ctx.params.id, 10);

  if (isNaN(id)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid id', 400);
  }

  await removeBlacklist(id, { id: Number(user.id), role: user.role }, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true };
});

// POST /api/v1/admin/purge/listing/:id
router.post('/purge/listing/:id', async (ctx) => {
  const user = ctx.state.user;
  const listingId = parseInt(ctx.params.id, 10);

  if (isNaN(listingId)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);
  }

  // Verify confirm text
  const body = ctx.request.body as { confirm?: string };
  if (!body.confirm || body.confirm !== `PURGE ${listingId}`) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Confirm text must be "PURGE <id>"', 400);
  }

  // Verify nonce
  const nonceValue = ctx.get('X-Nonce');
  if (!nonceValue) {
    throw new AppError(ErrorCodes.NONCE_INVALID, 'X-Nonce header is required', 401);
  }
  await consumeNonce(nonceValue, 'purge', Number(user.id));

  const db = defaultKnex;

  // Verify listing exists
  const listing = await db('listings').where({ id: listingId }).first();
  if (!listing) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Listing not found', 404);
  }

  // Per PRD §8.13, an immediate purge must remove the listing along with its
  // attachments AND blobs in the same path — orphan-sweep is only a safety
  // net. Delegate the FK-safe delete order to the shared listingPurge
  // service so admin purge and retention stay in lock-step.
  let blobKeys: string[] = [];

  await db.transaction(async (trx) => {
    const result = await hardDeleteListingInTransaction(trx, listingId);
    blobKeys = result.blobKeys;

    // Write audit_log inside the transaction for atomicity
    await appendAuditEvent({
      actor_id: Number(user.id),
      actor_role: user.role,
      action: 'admin.purge_listing',
      entity_type: 'listing',
      entity_id: String(listingId),
      before_json: { status: listing.status, office_id: listing.office_id },
      after_json: {
        listingId,
        purged: true,
        hard_deleted: true,
        attachments_deleted: result.attachmentsDeleted,
        blobs_deleted: new Set(blobKeys).size,
      },
      ip: getClientIp(ctx),
    }, systemClock, trx);
  });

  // Delete blobs after the DB transaction commits. We dedup since attachment
  // and revision rows can reference the same key, and we tolerate per-key
  // failures so a single missing blob does not block the rest of the purge.
  for (const key of new Set(blobKeys)) {
    try {
      await storageRepository.delete(key);
    } catch (err) {
      logger.warn({ key, err }, 'admin.purge_listing: failed to delete blob');
    }
  }

  ctx.status = 200;
  ctx.body = { ok: true };
});

// POST /api/v1/admin/purge/user/:id
router.post('/purge/user/:id', async (ctx) => {
  const actor = ctx.state.user;
  const userId = parseInt(ctx.params.id, 10);

  if (isNaN(userId)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid user id', 400);
  }

  // Verify confirm text
  const body = ctx.request.body as { confirm?: string };
  if (!body.confirm || body.confirm !== `PURGE ${userId}`) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Confirm text must be "PURGE <id>"', 400);
  }

  // Verify nonce
  const nonceValue = ctx.get('X-Nonce');
  if (!nonceValue) {
    throw new AppError(ErrorCodes.NONCE_INVALID, 'X-Nonce header is required', 401);
  }
  await consumeNonce(nonceValue, 'purge', Number(actor.id));

  const db = defaultKnex;

  // Verify user exists
  const user = await db('users').where({ id: userId }).first();
  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }

  // Hard-delete user and all associated data atomically (PRD §8.13: immediate
  // purge). Session revocation is performed inside the transaction so a
  // failure cannot leave sessions revoked while the user row is still alive.
  // Audit log entries authored by the user are intentionally retained per
  // PRD §8.14 (1-year retention, hash chain). audit_log.actor_id has no FK
  // to users.id (see migration 20240101000001), so leaving them is safe.
  const blobKeys: string[] = [];

  await db.transaction(async (trx) => {
    // 1) Atomic session revoke — same trx as the user delete.
    await revokeAllUserSessions(BigInt(userId), 'admin_purge', trx, systemClock);

    // 2) Cascade-delete every listing the user owns via the shared purge
    //    service — same FK-safe delete order as admin.purge_listing and
    //    retention.listings_purge, no drift.
    const ownedListings = await trx('listings').where({ created_by: userId }).select('id');
    const ownedListingIds = ownedListings.map((l: { id: number }) => l.id);

    if (ownedListingIds.length > 0) {
      const { hardDeleteListingsInTransaction } = await import('../services/listingPurge');
      const res = await hardDeleteListingsInTransaction(trx, ownedListingIds);
      blobKeys.push(...res.blobKeys);
    }

    // 3) attachments.created_by also FKs to users — sweep up any uploads the
    //    user made on listings owned by other agents (e.g., merchant uploads
    //    on a regular_user's draft).
    const otherAtt = await trx('attachments')
      .where({ created_by: userId })
      .select('id', 'storage_key');
    const otherAttIds = otherAtt.map((a: { id: number }) => a.id);
    if (otherAttIds.length > 0) {
      for (const a of otherAtt) {
        if (a.storage_key) blobKeys.push(String(a.storage_key));
      }
      const revs = await trx('attachment_revisions')
        .whereIn('attachment_id', otherAttIds)
        .select('storage_key');
      for (const r of revs) {
        if (r.storage_key) blobKeys.push(String(r.storage_key));
      }
      await trx('attachment_revisions').whereIn('attachment_id', otherAttIds).delete();
      await trx('attachments').whereIn('id', otherAttIds).delete();
    }

    // 4) Promo collections owned by the user — slots come along with them.
    const ownedCollections = await trx('promo_collections')
      .where({ created_by: userId })
      .select('id');
    const ownedCollectionIds = ownedCollections.map((c: { id: number }) => c.id);
    if (ownedCollectionIds.length > 0) {
      await trx('promo_slots').whereIn('collection_id', ownedCollectionIds).delete();
      await trx('promo_collections').whereIn('id', ownedCollectionIds).delete();
    }

    // 5) Promo slots the user added on collections owned by others.
    await trx('promo_slots').where({ added_by: userId }).delete();

    // 6) Export jobs requested by the user (FK requested_by → users.id).
    await trx('export_jobs').where({ requested_by: userId }).delete();

    // 7) Risk + auth dependencies (all have FK or implicit user_id columns).
    await trx('risk_events').where({ user_id: userId }).delete();
    await trx('risk_profiles').where({ user_id: userId }).delete();
    await trx('login_attempts').where({ user_id: userId }).delete();
    await trx('password_history').where({ user_id: userId }).delete();
    await trx('consent_records').where({ user_id: userId }).delete();
    await trx('sessions').where({ user_id: userId.toString() }).delete();
    await trx('nonces').where({ user_id: userId }).delete();
    await trx('idempotency_keys').where({ user_id: userId.toString() }).delete();

    // 8) Hard-delete the user row last.
    await trx('users').where({ id: userId }).delete();

    // 9) Audit inside the transaction for atomicity.
    await appendAuditEvent({
      actor_id: Number(actor.id),
      actor_role: actor.role,
      action: 'admin.purge_user',
      entity_type: 'user',
      entity_id: String(userId),
      before_json: { username: user.username, role: user.role, status: user.status },
      after_json: {
        userId,
        action: 'hard_deleted',
        listings_deleted: ownedListingIds.length,
        promo_collections_deleted: ownedCollectionIds.length,
        blobs_deleted: new Set(blobKeys).size,
      },
      ip: getClientIp(ctx),
    }, systemClock, trx);
  });

  // Delete blobs after commit. Tolerate per-key failures so a missing blob
  // does not stall the rest of the cleanup.
  for (const key of new Set(blobKeys)) {
    try {
      await storageRepository.delete(key);
    } catch (err) {
      logger.warn({ key, err }, 'admin.purge_user: failed to delete blob');
    }
  }

  ctx.status = 200;
  ctx.body = { ok: true };
});

// GET /api/v1/admin/audit-chain
router.get('/audit-chain', async (ctx) => {
  const result = await verifyChain();
  ctx.status = 200;
  ctx.body = {
    ok: true,
    data: {
      valid: result.valid,
      brokenAt: result.brokenAt !== undefined ? String(result.brokenAt) : undefined,
    },
  };
});

// POST /api/v1/admin/audit-chain/repair
router.post('/audit-chain/repair', async (ctx) => {
  const result = await repairChain();
  ctx.status = 200;
  ctx.body = { ok: true, data: result };
});

// GET /api/v1/admin/job-runs
router.get('/job-runs', async (ctx) => {
  const db = defaultKnex;
  const runs = await db('job_runs').orderBy('started_at', 'desc').limit(50).select('*');
  ctx.status = 200;
  ctx.body = { ok: true, data: runs };
});

export default router;
