import Router from 'koa-router';
import { AppError, ErrorCodes } from '../errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { hashPassword, validatePasswordPolicy, savePasswordHistory } from '../services/password';
import { revokeAllUserSessions, createSession } from '../services/session';
import { consumeNonce } from '../services/nonce';
import { appendAuditEvent } from '../audit';
import defaultKnex from '../db/knex';
import { systemClock } from '../clock';

const router = new Router({ prefix: '/api/v1/users' });

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  office_id: number | null;
  status: string;
  failed_login_count: number;
  locked_until: Date | string | null;
  must_change_password: number;
  consent_version_accepted: number | null;
  consent_accepted_at: Date | string | null;
  last_password_change_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function safeUser(user: UserRow): Omit<UserRow, 'password_hash'> {
  const { password_hash, ...rest } = user;
  void password_hash;
  return rest;
}

function getClientIp(ctx: Router.RouterContext): string {
  const forwarded = ctx.get('X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  return ctx.ip ?? 'unknown';
}

// POST /api/v1/users — create user (admin only)
router.post('/', requireAuth(), requireRole('administrator'), async (ctx) => {
  const body = ctx.request.body as {
    username?: string;
    password?: string;
    role?: string;
    office_id?: number;
    status?: string;
  };

  if (!body.username || !body.password || !body.role) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'username, password, and role are required', 400);
  }

  const validRoles = ['regular_user', 'merchant', 'operations', 'administrator'];
  if (!validRoles.includes(body.role)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, `role must be one of: ${validRoles.join(', ')}`, 400);
  }

  // Merchant and regular_user roles require office_id to create/own office-scoped listings (PRD §8.15)
  if ((body.role === 'merchant' || body.role === 'regular_user') && !body.office_id) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'office_id is required for merchant and regular_user roles', 400);
  }

  const { valid, errors } = validatePasswordPolicy(body.password);
  if (!valid) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, errors.join(' '), 400, { errors });
  }

  const existing = await defaultKnex('users').whereRaw('LOWER(username) = ?', [body.username.toLowerCase()]).first();
  if (existing) {
    throw new AppError(ErrorCodes.CONFLICT, 'Username already exists', 409);
  }

  const hash = await hashPassword(body.password);
  const now = systemClock.now();

  const username = body.username;
  let user!: UserRow;
  await defaultKnex.transaction(async (trx) => {
    const [userId] = await trx('users').insert({
      username: username.toLowerCase(),
      password_hash: hash,
      role: body.role,
      office_id: body.office_id ?? null,
      status: body.status ?? 'active',
      failed_login_count: 0,
      must_change_password: 1,
      created_at: now,
      updated_at: now,
    });

    // Record initial password in history so it cannot be reused on first change
    await savePasswordHistory(BigInt(userId), hash, trx);

    await appendAuditEvent({
      actor_id: Number(ctx.state.user.id),
      actor_role: ctx.state.user.role,
      action: 'users.create',
      entity_type: 'user',
      entity_id: String(userId),
      after_json: { username: body.username, role: body.role },
      ip: getClientIp(ctx),
    }, systemClock, trx);

    user = await trx('users').where({ id: userId }).first<UserRow>();
  });
  ctx.status = 201;
  ctx.body = { ok: true, data: safeUser(user) };
});

// GET /api/v1/users — list users with cursor pagination (admin only)
router.get('/', requireAuth(), requireRole('administrator'), async (ctx) => {
  const limit = Math.min(parseInt(String(ctx.query.limit ?? '20'), 10), 100);
  const cursor = ctx.query.cursor ? parseInt(String(ctx.query.cursor), 10) : 0;
  const search = ctx.query.search ? String(ctx.query.search).trim() : '';

  let query = defaultKnex('users as u')
    .where('u.id', '>', cursor)
    .orderBy('u.id', 'asc')
    .limit(limit + 1);

  if (search) {
    query = query.whereRaw('LOWER(u.username) LIKE ?', [`%${search.toLowerCase()}%`]);
  }

  // Left-join the most recent active session per user to surface last IP,
  // device fingerprint, and last activity timestamp.
  query = query
    .leftJoin(
      defaultKnex('sessions')
        .select('user_id')
        .max('last_activity_at as last_activity_at')
        .whereNull('revoked_at')
        .groupBy('user_id')
        .as('latest_sess'),
      'latest_sess.user_id',
      defaultKnex.raw('CAST(u.id AS UNSIGNED)'),
    )
    .leftJoin('sessions as s', function () {
      this.on('s.user_id', defaultKnex.raw('CAST(u.id AS UNSIGNED)'))
        .andOn('s.last_activity_at', 'latest_sess.last_activity_at');
    })
    .select<(UserRow & { last_ip?: string; last_device_fingerprint?: string; session_last_activity_at?: string })[]>([
      'u.id', 'u.username', 'u.role', 'u.office_id', 'u.status',
      'u.failed_login_count', 'u.locked_until', 'u.must_change_password',
      'u.consent_version_accepted', 'u.consent_accepted_at',
      'u.last_password_change_at', 'u.created_at', 'u.updated_at',
      's.ip as last_ip',
      's.device_fingerprint as last_device_fingerprint',
      's.last_activity_at as session_last_activity_at',
    ]);

  const users = await query;

  const hasMore = users.length > limit;
  const rawItems = hasMore ? users.slice(0, limit) : users;
  const nextCursor = hasMore ? rawItems[rawItems.length - 1].id : null;

  const items = rawItems.map((u) => {
    const { password_hash, ...rest } = u as UserRow & { password_hash?: string; last_ip?: string; last_device_fingerprint?: string; session_last_activity_at?: string };
    void password_hash;
    return rest;
  });

  ctx.status = 200;
  ctx.body = { ok: true, data: { items, nextCursor } };
});

// GET /api/v1/users/:id
router.get('/:id', requireAuth(), requireRole('administrator'), async (ctx) => {
  const user = await defaultKnex('users')
    .where({ id: ctx.params.id })
    .first<UserRow | undefined>();

  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }

  ctx.status = 200;
  ctx.body = { ok: true, data: safeUser(user) };
});

// PATCH /api/v1/users/:id
router.patch('/:id', requireAuth(), requireRole('administrator'), async (ctx) => {
  const body = ctx.request.body as {
    role?: string;
    status?: string;
    office_id?: number | null;
    must_change_password?: boolean;
    nonce?: string;
  };

  const user = await defaultKnex('users').where({ id: ctx.params.id }).first<UserRow | undefined>();
  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }

  const beforeSnapshot = safeUser(user);
  const updates: Record<string, unknown> = {};
  const now = systemClock.now();

  const validRoles = ['regular_user', 'merchant', 'operations', 'administrator'];

  const validStatuses = ['active', 'locked', 'disabled'];

  // Collect session-revocation reasons during validation; execute them INSIDE the
  // mutation transaction so revocation, user update, and audit are atomic
  // (no orphaned revocation if the user update fails, no missed revocation if the
  // user update succeeds but a later step throws).
  const revocationReasons: string[] = [];

  if (body.role !== undefined) {
    if (!validRoles.includes(body.role)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `Invalid role`, 400);
    }
    // Role change requires nonce (actor-bound to the administrator performing the change)
    if (!body.nonce) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'nonce is required for role change', 400);
    }
    await consumeNonce(body.nonce, 'role_change', Number(ctx.state.user.id));
    updates.role = body.role;

    // Merchant and regular_user roles require office_id for listing-capable scoping (PRD §8.15)
    const effectiveOfficeId = body.office_id !== undefined ? body.office_id : user.office_id;
    if ((body.role === 'merchant' || body.role === 'regular_user') && !effectiveOfficeId) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'office_id is required for merchant and regular_user roles', 400);
    }

    revocationReasons.push('role_changed');
  }

  if (body.status !== undefined) {
    if (!validStatuses.includes(body.status)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `status must be one of: ${validStatuses.join(', ')}`, 400);
    }
    updates.status = body.status;

    // Revoke all sessions when transitioning to locked/disabled (PRD §8.12)
    if (body.status === 'locked' || body.status === 'disabled') {
      revocationReasons.push('admin_status_change');
    }
  }
  if (body.office_id !== undefined) updates.office_id = body.office_id;
  if (body.must_change_password !== undefined) {
    updates.must_change_password = body.must_change_password ? 1 : 0;
    // Revoke all sessions when forcing password reset so existing sessions cannot continue
    if (body.must_change_password) {
      revocationReasons.push('admin_must_change_password');
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'No fields to update', 400);
  }

  updates.updated_at = now;
  let updatedUser!: UserRow;
  await defaultKnex.transaction(async (trx) => {
    await trx('users').where({ id: ctx.params.id }).update(updates);
    updatedUser = await trx('users').where({ id: ctx.params.id }).first<UserRow>();

    // Revoke sessions inside the transaction so they roll back together with the user update
    for (const reason of revocationReasons) {
      await revokeAllUserSessions(BigInt(user.id), reason, trx);
    }

    await appendAuditEvent({
      actor_id: Number(ctx.state.user.id),
      actor_role: ctx.state.user.role,
      action: 'users.update',
      entity_type: 'user',
      entity_id: ctx.params.id,
      before_json: beforeSnapshot as Record<string, unknown>,
      after_json: safeUser(updatedUser) as Record<string, unknown>,
      ip: getClientIp(ctx),
    }, systemClock, trx);
  });

  ctx.status = 200;
  ctx.body = { ok: true, data: safeUser(updatedUser) };
});

// POST /api/v1/users/:id/unlock
router.post('/:id/unlock', requireAuth(), requireRole('administrator'), async (ctx) => {
  const user = await defaultKnex('users').where({ id: ctx.params.id }).first<UserRow | undefined>();
  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }

  const now = systemClock.now();
  await defaultKnex.transaction(async (trx) => {
    await trx('users').where({ id: ctx.params.id }).update({
      status: 'active',
      failed_login_count: 0,
      locked_until: null,
      updated_at: now,
    });

    await appendAuditEvent({
      actor_id: Number(ctx.state.user.id),
      actor_role: ctx.state.user.role,
      action: 'users.unlock',
      entity_type: 'user',
      entity_id: ctx.params.id,
      ip: getClientIp(ctx),
    }, systemClock, trx);
  });

  ctx.status = 200;
  ctx.body = { ok: true };
});

// POST /api/v1/users/:id/force-reset
router.post('/:id/force-reset', requireAuth(), requireRole('administrator'), async (ctx) => {
  const user = await defaultKnex('users').where({ id: ctx.params.id }).first<UserRow | undefined>();
  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }

  const now = systemClock.now();
  await defaultKnex.transaction(async (trx) => {
    await trx('users').where({ id: ctx.params.id }).update({
      must_change_password: 1,
      updated_at: now,
    });

    // Revoke sessions inside the transaction so user-update, revocation, and audit
    // commit together (or roll back together on any failure).
    await revokeAllUserSessions(BigInt(user.id), 'force_reset', trx);

    await appendAuditEvent({
      actor_id: Number(ctx.state.user.id),
      actor_role: ctx.state.user.role,
      action: 'users.force_reset',
      entity_type: 'user',
      entity_id: ctx.params.id,
      ip: getClientIp(ctx),
    }, systemClock, trx);
  });

  ctx.status = 200;
  ctx.body = { ok: true };
});

export default router;
