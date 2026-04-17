import Koa from 'koa';
import { AppError, ErrorCodes } from '../errors';
import { verifyAccessToken, UserRole } from '../services/token';
import { getActiveSession, touchSession, revokeAllUserSessions } from '../services/session';
import { hasUserAcceptedLatest } from '../services/consent';
import defaultKnex from '../db/knex';

export interface AuthUser {
  id: bigint;
  role: UserRole;
  officeId: string | null;
  jti: string;
}

// Augment Koa's state
declare module 'koa' {
  interface DefaultState {
    user: AuthUser;
  }
}

export function requireAuth(): Koa.Middleware {
  return async (ctx, next) => {
    const authHeader = ctx.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 'Missing authorization token', 401);
    }

    const token = authHeader.slice(7);
    const payload = verifyAccessToken(token);

    // Check session is active
    const session = await getActiveSession(payload.jti);
    if (!session) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 'Session expired or revoked', 401);
    }

    // Touch the session (will revoke on inactivity)
    await touchSession(payload.jti);

    // Check session is still active after touch
    const activeSession = await getActiveSession(payload.jti);
    if (!activeSession) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 'Session expired due to inactivity', 401);
    }

    // Enforce user status: reject disabled/locked accounts (PRD §8.12)
    const userRow = await defaultKnex('users')
      .where({ id: payload.sub })
      .first<{ status: string } | undefined>();
    if (!userRow || userRow.status === 'disabled' || userRow.status === 'locked') {
      await revokeAllUserSessions(BigInt(payload.sub), 'account_' + (userRow?.status ?? 'missing'));
      throw new AppError(ErrorCodes.UNAUTHORIZED, 'Account is not active', 401);
    }

    ctx.state.user = {
      id: BigInt(payload.sub),
      role: payload.role,
      officeId: payload.officeId,
      jti: payload.jti,
    };

    await next();
  };
}

export function requireRole(...roles: UserRole[]): Koa.Middleware {
  return async (ctx, next) => {
    if (!ctx.state.user) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 'Not authenticated', 401);
    }
    if (!roles.includes(ctx.state.user.role)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Insufficient role', 403);
    }
    await next();
  };
}

export function requireConsent(): Koa.Middleware {
  return async (ctx, next) => {
    if (!ctx.state.user) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 'Not authenticated', 401);
    }
    const accepted = await hasUserAcceptedLatest(ctx.state.user.id);
    if (!accepted) {
      throw new AppError(ErrorCodes.CONSENT_REQUIRED, 'User must accept the latest consent', 403);
    }
    await next();
  };
}
