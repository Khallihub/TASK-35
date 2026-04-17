import Router from 'koa-router';
import { AppError, ErrorCodes } from '../errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { appendAuditEvent } from '../audit';
import defaultKnex from '../db/knex';
import { systemClock } from '../clock';

const router = new Router({ prefix: '/api/v1/offices' });

interface OfficeRow {
  id: number;
  name: string;
  code: string;
  active: number;
}

function getClientIp(ctx: Router.RouterContext): string {
  const forwarded = ctx.get('X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  return ctx.ip ?? 'unknown';
}

// POST /api/v1/offices — administrator only
router.post('/', requireAuth(), requireRole('administrator'), async (ctx) => {
  const body = ctx.request.body as { name?: string; code?: string; active?: number };

  if (!body.name || !body.code) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'name and code are required', 400);
  }

  const existing = await defaultKnex('offices').where({ code: body.code }).first();
  if (existing) {
    throw new AppError(ErrorCodes.CONFLICT, 'Office code already exists', 409);
  }

  const name = body.name;
  const code = body.code;
  let officeId!: number;
  let office!: OfficeRow;
  await defaultKnex.transaction(async (trx) => {
    const [id] = await trx('offices').insert({
      name,
      code: code.toUpperCase(),
      active: body.active ?? 1,
    });
    officeId = id;

    await appendAuditEvent({
      actor_id: Number(ctx.state.user.id),
      actor_role: ctx.state.user.role,
      action: 'offices.create',
      entity_type: 'office',
      entity_id: String(officeId),
      after_json: { name, code },
      ip: getClientIp(ctx),
    }, systemClock, trx);

    office = await trx('offices').where({ id: officeId }).first<OfficeRow>();
  });
  ctx.status = 201;
  ctx.body = { ok: true, data: office };
});

// GET /api/v1/offices — all authenticated users
router.get('/', requireAuth(), async (ctx) => {
  const offices = await defaultKnex('offices')
    .orderBy('id', 'asc')
    .select<OfficeRow[]>(['id', 'name', 'code', 'active']);

  ctx.status = 200;
  ctx.body = { ok: true, data: offices };
});

// PATCH /api/v1/offices/:id — administrator only
router.patch('/:id', requireAuth(), requireRole('administrator'), async (ctx) => {
  const body = ctx.request.body as { name?: string; code?: string; active?: number };

  const office = await defaultKnex('offices').where({ id: ctx.params.id }).first<OfficeRow | undefined>();
  if (!office) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Office not found', 404);
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.code !== undefined) updates.code = body.code.toUpperCase();
  if (body.active !== undefined) updates.active = body.active;

  if (Object.keys(updates).length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'No fields to update', 400);
  }

  if (updates.code && updates.code !== office.code) {
    const existing = await defaultKnex('offices').where({ code: updates.code }).first();
    if (existing) {
      throw new AppError(ErrorCodes.CONFLICT, 'Office code already exists', 409);
    }
  }

  let updatedOffice!: OfficeRow;
  await defaultKnex.transaction(async (trx) => {
    await trx('offices').where({ id: ctx.params.id }).update(updates);

    await appendAuditEvent({
      actor_id: Number(ctx.state.user.id),
      actor_role: ctx.state.user.role,
      action: 'offices.update',
      entity_type: 'office',
      entity_id: ctx.params.id,
      before_json: office as unknown as Record<string, unknown>,
      after_json: updates,
      ip: getClientIp(ctx),
    }, systemClock, trx);

    updatedOffice = await trx('offices').where({ id: ctx.params.id }).first<OfficeRow>();
  });
  ctx.status = 200;
  ctx.body = { ok: true, data: updatedOffice };
});

export default router;
