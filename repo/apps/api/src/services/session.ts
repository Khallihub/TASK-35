import { Knex as KnexType } from 'knex';
import { Clock, systemClock } from '../clock';
import defaultKnex from '../db/knex';
import { generateJti, signAccessToken, signRefreshToken, UserRole } from './token';

export interface Session {
  id: number;
  user_id: number;
  jti: string;
  issued_at: Date | string | number;
  last_activity_at: Date | string | number;
  expires_at: Date | string | number;
  ip: string | null;
  user_agent: string | null;
  device_fingerprint: string | null;
  revoked_at: Date | string | number | null;
  revoke_reason: string | null;
}

export interface CreateSessionParams {
  userId: bigint;
  role: UserRole;
  officeId: bigint | null;
  ip?: string;
  userAgent?: string;
  deviceFingerprint?: string;
}

const SESSION_MAX_HOURS = 8;
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

/**
 * Parse a datetime value from DB — handles Date objects, ISO strings, numbers,
 * and the MySQL-formatted "YYYY-MM-DD HH:MM:SS.mmm" strings that SQLite returns.
 */
function toDate(val: Date | string | number | null | undefined): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number') return new Date(val);
  // "YYYY-MM-DD HH:MM:SS.mmm" — interpret as UTC
  const str = String(val).replace(' ', 'T');
  const d = new Date(str.includes('Z') || str.includes('+') ? str : str + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

export async function createSession(
  params: CreateSessionParams,
  knexInstance: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<{ session: Session; accessToken: string; refreshToken: string }> {
  const now = clock.now();
  const jti = generateJti();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_HOURS * 60 * 60 * 1000);

  const accessToken = signAccessToken(
    {
      sub: params.userId.toString(),
      role: params.role,
      officeId: params.officeId ? params.officeId.toString() : null,
      jti,
    },
    jti,
  );

  const refreshToken = signRefreshToken(jti, params.userId);

  await knexInstance('sessions').insert({
    user_id: params.userId.toString(),
    jti,
    issued_at: formatDatetime(now),
    last_activity_at: formatDatetime(now),
    expires_at: formatDatetime(expiresAt),
    ip: params.ip ?? null,
    user_agent: params.userAgent ?? null,
    device_fingerprint: params.deviceFingerprint ?? null,
    revoked_at: null,
    revoke_reason: null,
  });

  const session = await knexInstance('sessions').where({ jti }).first<Session>();

  return { session, accessToken, refreshToken };
}

export async function touchSession(
  jti: string,
  knexInstance: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<void> {
  const now = clock.now();
  const session = await knexInstance('sessions').where({ jti }).first<Session | undefined>();

  if (!session) {
    return;
  }

  const lastActivity = toDate(session.last_activity_at);
  const expiresAt = toDate(session.expires_at);

  // Check absolute expiry
  if (expiresAt && expiresAt < now) {
    await revokeSession(jti, 'expired', knexInstance, clock);
    return;
  }

  // Check inactivity
  if (lastActivity && now.getTime() - lastActivity.getTime() > INACTIVITY_TIMEOUT_MS) {
    await revokeSession(jti, 'inactivity', knexInstance, clock);
    return;
  }

  await knexInstance('sessions')
    .where({ jti })
    .update({ last_activity_at: formatDatetime(now) });
}

export async function revokeSession(
  jti: string,
  reason: string,
  knexInstance: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<void> {
  const now = clock.now();
  await knexInstance('sessions')
    .where({ jti })
    .whereNull('revoked_at')
    .update({
      revoked_at: formatDatetime(now),
      revoke_reason: reason,
    });
}

export async function revokeAllUserSessions(
  userId: bigint,
  reason: string,
  knexInstance: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<void> {
  const now = clock.now();
  await knexInstance('sessions')
    .where({ user_id: userId.toString() })
    .whereNull('revoked_at')
    .update({
      revoked_at: formatDatetime(now),
      revoke_reason: reason,
    });
}

export async function getActiveSession(
  jti: string,
  knexInstance: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<Session | null> {
  const now = clock.now();
  const session = await knexInstance('sessions').where({ jti }).first<Session | undefined>();

  if (!session) {
    return null;
  }

  if (session.revoked_at) {
    return null;
  }

  const expiresAt = toDate(session.expires_at);
  if (expiresAt && expiresAt < now) {
    await revokeSession(jti, 'expired', knexInstance, clock);
    return null;
  }

  // Enforce inactivity timeout (30 min sliding window)
  const lastActivity = toDate(session.last_activity_at);
  if (lastActivity && now.getTime() - lastActivity.getTime() > INACTIVITY_TIMEOUT_MS) {
    await revokeSession(jti, 'inactivity', knexInstance, clock);
    return null;
  }

  return session;
}
