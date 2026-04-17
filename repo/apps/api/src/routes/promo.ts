import Router from 'koa-router';
import { AppError, ErrorCodes } from '../errors';
import { requireAuth, requireConsent, requireRole } from '../middleware/auth';
import { systemClock } from '../clock';
import {
  createPromo,
  getPromo,
  listPromos,
  updatePromo,
  activatePromo,
  cancelPromo,
  addSlot,
  removeSlot,
  reorderSlots,
} from '../services/promo';
import { CreatePromoInput, UpdatePromoInput, PromoStatus } from '../types/promo';
import { UserRole } from '../services/listingStateMachine';
import { logEvent } from '../services/eventLog';
import defaultKnex from '../db/knex';

const router = new Router({ prefix: '/api/v1/promo' });

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
    ip: getClientIp(ctx),
  };
}

// POST /api/v1/promo
router.post('/', requireAuth(), requireConsent(), requireRole('operations', 'administrator'), async (ctx) => {
  const actor = getActor(ctx);
  const input = ctx.request.body as CreatePromoInput;

  const collection = await createPromo(actor, input, undefined, systemClock);

  ctx.status = 201;
  ctx.body = { ok: true, data: collection };
});

// GET /api/v1/promo
router.get('/', requireAuth(), requireConsent(), async (ctx) => {
  const q = ctx.query;

  const filters = {
    status: q.status as PromoStatus | undefined,
    from: q.from as string | undefined,
    to: q.to as string | undefined,
  };

  const pagination = {
    cursor: q.cursor as string | undefined,
    limit: Math.min(parseInt(String(q.limit ?? '25'), 10), 100),
  };

  const result = await listPromos(filters, pagination, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true, data: result };
});

// GET /api/v1/promo/:id
router.get('/:id', requireAuth(), requireConsent(), async (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid promo id', 400);
  }

  const collection = await getPromo(id, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true, data: collection };
});

// PATCH /api/v1/promo/:id
router.patch('/:id', requireAuth(), requireConsent(), requireRole('operations', 'administrator'), async (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid promo id', 400);
  }

  const actor = getActor(ctx);
  const input = ctx.request.body as UpdatePromoInput;

  const collection = await updatePromo(id, actor, input, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true, data: collection };
});

// POST /api/v1/promo/:id/click — emits promo.click engagement event
router.post('/:id/click', requireAuth(), requireConsent(), async (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid promo id', 400);
  }

  const actor = getActor(ctx);
  const body = (ctx.request.body ?? {}) as { listingId?: number };

  // Verify the promo exists / is visible to the actor before recording the event
  await getPromo(id, undefined, systemClock);

  await logEvent({
    user_id: actor.id,
    event_type: 'promo.click',
    entity_type: 'promo_collection',
    entity_id: id,
    office_id: actor.officeId ?? undefined,
    payload: body.listingId ? { listing_id: Number(body.listingId) } : {},
    ip: actor.ip,
    knex: defaultKnex,
    clock: systemClock,
  });

  ctx.status = 200;
  ctx.body = { ok: true };
});

// POST /api/v1/promo/:id/activate
router.post('/:id/activate', requireAuth(), requireConsent(), requireRole('operations', 'administrator'), async (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid promo id', 400);
  }

  const actor = getActor(ctx);
  const collection = await activatePromo(id, actor, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true, data: collection };
});

// POST /api/v1/promo/:id/cancel
router.post('/:id/cancel', requireAuth(), requireConsent(), requireRole('operations', 'administrator'), async (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid promo id', 400);
  }

  const actor = getActor(ctx);
  const collection = await cancelPromo(id, actor, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true, data: collection };
});

// POST /api/v1/promo/:id/slots
router.post('/:id/slots', requireAuth(), requireConsent(), requireRole('operations', 'administrator'), async (ctx) => {
  const collectionId = parseInt(ctx.params.id, 10);
  if (isNaN(collectionId)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid promo id', 400);
  }

  const actor = getActor(ctx);
  const body = ctx.request.body as { listingId?: number; rank?: number };

  if (!body.listingId || isNaN(Number(body.listingId))) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'listingId is required', 400);
  }
  if (!body.rank || isNaN(Number(body.rank))) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'rank is required', 400);
  }

  const slot = await addSlot(
    collectionId,
    Number(body.listingId),
    Number(body.rank),
    actor,
    undefined,
    systemClock,
  );

  ctx.status = 201;
  ctx.body = { ok: true, data: slot };
});

// DELETE /api/v1/promo/:id/slots/:slotId
router.delete('/:id/slots/:slotId', requireAuth(), requireConsent(), requireRole('operations', 'administrator'), async (ctx) => {
  const collectionId = parseInt(ctx.params.id, 10);
  const slotId = parseInt(ctx.params.slotId, 10);

  if (isNaN(collectionId) || isNaN(slotId)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid id', 400);
  }

  const actor = getActor(ctx);
  await removeSlot(collectionId, slotId, actor, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true };
});

// PUT /api/v1/promo/:id/slots/reorder
router.put('/:id/slots/reorder', requireAuth(), requireConsent(), requireRole('operations', 'administrator'), async (ctx) => {
  const collectionId = parseInt(ctx.params.id, 10);
  if (isNaN(collectionId)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid promo id', 400);
  }

  const actor = getActor(ctx);
  const body = ctx.request.body as { slots?: Array<{ slotId: number; rank: number }> };

  if (!Array.isArray(body.slots)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'slots must be an array', 400);
  }

  const slots = await reorderSlots(collectionId, body.slots, actor, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true, data: slots };
});

export default router;
