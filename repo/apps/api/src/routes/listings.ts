import Router from 'koa-router';
import { AppError, ErrorCodes } from '../errors';
import { requireAuth, requireConsent } from '../middleware/auth';
import { consumeNonce } from '../services/nonce';
import {
  createListing,
  getListing,
  listListings,
  updateListing,
  transitionStatus,
  softDeleteListing,
  restoreListing,
  getRevisions,
} from '../services/listing';
import { CreateListingInput, UpdateListingInput } from '../types/listing';
import { UserRole } from '../services/listingStateMachine';
import { systemClock } from '../clock';
import { logEvent } from '../services/eventLog';
import defaultKnex from '../db/knex';

const router = new Router({ prefix: '/api/v1/listings' });

function getClientIp(ctx: Router.RouterContext): string {
  const forwarded = ctx.get('X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  return ctx.ip ?? 'unknown';
}

function getActor(ctx: Router.RouterContext) {
  const user = ctx.state.user;
  return {
    id: Number(user.id),
    role: user.role as UserRole,
    officeId: user.officeId ? Number(user.officeId) : null,
  };
}

// POST /api/v1/listings
router.post('/', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);

  if (actor.role === 'operations') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Operations role cannot create listings', 403);
  }

  // Fail closed: listing creation requires a valid office assignment
  if (actor.officeId === null || actor.officeId === undefined) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'User must be assigned to an office to create listings', 400);
  }

  const input = ctx.request.body as CreateListingInput;
  const ip = getClientIp(ctx);

  const listing = await createListing(actor, input, ip, undefined, systemClock);

  ctx.status = 201;
  ctx.body = { ok: true, data: listing };
});

// GET /api/v1/listings
router.get('/', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);
  const q = ctx.query;

  const filters = {
    office_id: q.office_id ? Number(q.office_id) : undefined,
    agent_id: q.agent_id ? Number(q.agent_id) : undefined,
    status: q.status as string | undefined,
    beds_min: q.beds_min ? Number(q.beds_min) : undefined,
    beds_max: q.beds_max ? Number(q.beds_max) : undefined,
    price_min: q.price_min ? Number(q.price_min) : undefined,
    price_max: q.price_max ? Number(q.price_max) : undefined,
    area_min: q.area_min ? Number(q.area_min) : undefined,
    area_max: q.area_max ? Number(q.area_max) : undefined,
    city: q.city as string | undefined,
    state_code: q.state_code as string | undefined,
    updated_since: q.updated_since as string | undefined,
    q: q.q as string | undefined,
  };

  const pagination = {
    cursor: q.cursor as string | undefined,
    limit: Math.min(parseInt(String(q.limit ?? '25'), 10), 100),
  };

  const result = await listListings(actor, filters, pagination);

  ctx.status = 200;
  ctx.body = { ok: true, data: result };
});

// GET /api/v1/listings/:id
router.get('/:id', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);
  const id = parseInt(ctx.params.id, 10);

  if (isNaN(id)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);
  }

  const listing = await getListing(id, actor, getClientIp(ctx));

  ctx.status = 200;
  ctx.body = { ok: true, data: listing };
});

// PATCH /api/v1/listings/:id
router.patch('/:id', requireAuth(), requireConsent(), async (ctx) => {
  const ifMatch = ctx.get('If-Match');
  if (!ifMatch) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'If-Match header is required', 400);
  }

  const ifMatchVersion = parseInt(ifMatch, 10);
  if (isNaN(ifMatchVersion)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'If-Match header must be a version number', 400);
  }

  const actor = getActor(ctx);

  if (actor.role === 'operations') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Operations role cannot edit listings', 403);
  }
  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);
  }

  const input = ctx.request.body as UpdateListingInput;
  const ip = getClientIp(ctx);

  const listing = await updateListing(id, actor, input, ifMatchVersion, ip, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true, data: listing };
});

// POST /api/v1/listings/:id/submit
router.post('/:id/submit', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);
  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);

  const ip = getClientIp(ctx);
  const listing = await transitionStatus(id, actor, 'in_review', undefined, undefined, ip, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true, data: listing };
});

// POST /api/v1/listings/:id/approve
router.post('/:id/approve', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);

  if (actor.role !== 'merchant' && actor.role !== 'administrator') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Only merchant or administrator can approve listings', 403);
  }

  const nonce = ctx.get('X-Nonce');
  if (!nonce) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'X-Nonce header is required', 400);
  }
  await consumeNonce(nonce, 'approve', actor.id);

  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);

  const body = ctx.request.body as { overrideReason?: string };
  const ip = getClientIp(ctx);

  const listing = await transitionStatus(
    id, actor, 'approved', undefined, body.overrideReason, ip, undefined, systemClock,
  );

  ctx.status = 200;
  ctx.body = { ok: true, data: listing };
});

// POST /api/v1/listings/:id/reject
router.post('/:id/reject', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);

  if (actor.role !== 'merchant' && actor.role !== 'administrator') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Only merchant or administrator can reject listings', 403);
  }

  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);

  const body = ctx.request.body as { reason?: string };
  if (!body.reason || body.reason.length < 10) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'reason must be at least 10 characters', 400);
  }

  const ip = getClientIp(ctx);
  const listing = await transitionStatus(id, actor, 'rejected', body.reason, undefined, ip, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true, data: listing };
});

// POST /api/v1/listings/:id/publish
router.post('/:id/publish', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);

  if (actor.role !== 'merchant' && actor.role !== 'administrator') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Only merchant or administrator can publish listings', 403);
  }

  const nonce = ctx.get('X-Nonce');
  if (!nonce) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'X-Nonce header is required', 400);
  }
  await consumeNonce(nonce, 'publish', actor.id);

  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);

  const ip = getClientIp(ctx);
  const listing = await transitionStatus(id, actor, 'published', undefined, undefined, ip, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true, data: listing };
});

// POST /api/v1/listings/:id/archive
router.post('/:id/archive', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);
  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);

  const body = ctx.request.body as { reason?: string };
  if (!body.reason || body.reason.length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'reason is required to archive', 400);
  }

  const ip = getClientIp(ctx);
  const listing = await transitionStatus(id, actor, 'archived', body.reason, undefined, ip, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true, data: listing };
});

// POST /api/v1/listings/:id/reverse
router.post('/:id/reverse', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);
  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);

  const body = ctx.request.body as { reason?: string };
  if (!body.reason || body.reason.length < 10) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'reason must be at least 10 characters for reversal', 400);
  }

  const ip = getClientIp(ctx);
  const listing = await transitionStatus(id, actor, 'in_review', body.reason, undefined, ip, undefined, systemClock);

  // ── No-show approval detection: approved then reversed within 24h → penalty ──
  try {
    const defaultKnex = (await import('../db/knex')).default;
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Find the most recent 'approved' transition for this listing
    const approvalEvent = await defaultKnex('listing_status_history')
      .where({ listing_id: id, to_status: 'approved' })
      .orderBy('id', 'desc')
      .first<{ actor_id: number; created_at: string | Date } | undefined>();

    if (approvalEvent) {
      const approvedAt = new Date(String(approvalEvent.created_at).replace(' ', 'T') + (String(approvalEvent.created_at).includes('Z') ? '' : 'Z'));
      if (approvedAt >= twentyFourHoursAgo && approvalEvent.actor_id) {
        const { applyPenalty, getOrCreateProfile } = await import('../services/risk');
        await getOrCreateProfile(approvalEvent.actor_id);
        await applyPenalty(approvalEvent.actor_id, 'no_show_approval', {
          listing_id: id,
          reversed_by: actor.id,
        });
      }
    }
  } catch {
    // Non-blocking: risk detection failure shouldn't break the reversal
  }

  ctx.status = 200;
  ctx.body = { ok: true, data: listing };
});

// DELETE /api/v1/listings/:id
router.delete('/:id', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);
  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);

  const ip = getClientIp(ctx);
  await softDeleteListing(id, actor, ip, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true };
});

// POST /api/v1/listings/:id/restore
router.post('/:id/restore', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);

  if (actor.role !== 'merchant' && actor.role !== 'administrator') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Only merchant or administrator can restore listings', 403);
  }

  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);

  const ip = getClientIp(ctx);
  const listing = await restoreListing(id, actor, ip, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true, data: listing };
});

// POST /api/v1/listings/:id/favorite — emits listing.favorite engagement event
router.post('/:id/favorite', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);
  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);

  // Ensure the user can read the listing before recording the event so we
  // don't credit engagement against listings they shouldn't see.
  const listing = await getListing(id, actor);

  await logEvent({
    user_id: actor.id,
    event_type: 'listing.favorite',
    entity_type: 'listing',
    entity_id: id,
    office_id: listing.office_id ?? undefined,
    payload: {},
    ip: getClientIp(ctx),
    knex: defaultKnex,
    clock: systemClock,
  });

  ctx.status = 200;
  ctx.body = { ok: true };
});

// POST /api/v1/listings/:id/share — emits listing.share engagement event
router.post('/:id/share', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);
  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);

  const listing = await getListing(id, actor);

  await logEvent({
    user_id: actor.id,
    event_type: 'listing.share',
    entity_type: 'listing',
    entity_id: id,
    office_id: listing.office_id ?? undefined,
    payload: {},
    ip: getClientIp(ctx),
    knex: defaultKnex,
    clock: systemClock,
  });

  ctx.status = 200;
  ctx.body = { ok: true };
});

// GET /api/v1/listings/:id/revisions
router.get('/:id/revisions', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);
  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);

  const revisions = await getRevisions(id, actor);

  ctx.status = 200;
  ctx.body = { ok: true, data: revisions };
});

export default router;
