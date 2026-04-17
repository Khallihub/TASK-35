import { Knex as KnexType } from 'knex';
import { Clock, systemClock } from '../clock';
import defaultKnex from '../db/knex';

/**
 * Parse a datetime value from DB — handles Date objects, ISO strings, numbers,
 * and "YYYY-MM-DD HH:MM:SS.mmm" strings (SQLite returns these) as UTC.
 */
function parseDbDate(val: Date | string | number | null | undefined): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number') return new Date(val);
  const str = String(val).replace(' ', 'T');
  const d = new Date(str.includes('Z') || str.includes('+') ? str : str + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

const DEFAULT_MAX_FAILURES = 10;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

interface UserLockRow {
  id: number;
  status: string;
  failed_login_count: number;
  locked_until: Date | string | number | null;
}

interface LockoutSettings {
  threshold: number;
  windowMs: number;
  durationMs: number;
}

async function getLockoutSettings(knexInstance: KnexType): Promise<LockoutSettings> {
  let threshold = DEFAULT_MAX_FAILURES;
  let windowMs = DEFAULT_WINDOW_MS;
  let durationMs = DEFAULT_LOCKOUT_DURATION_MS;

  try {
    const rows = await knexInstance('settings')
      .whereIn('key', [
        'security.lockout_attempts',
        'security.lockout_window_minutes',
        'security.lockout_duration_minutes',
      ]);

    for (const row of rows) {
      const val = parseInt(row.value, 10);
      if (isNaN(val) || val <= 0) continue;
      switch (row.key) {
        case 'security.lockout_attempts':
          threshold = val;
          break;
        case 'security.lockout_window_minutes':
          windowMs = val * 60 * 1000;
          break;
        case 'security.lockout_duration_minutes':
          durationMs = val * 60 * 1000;
          break;
      }
    }
  } catch {
    // ignore - settings table may not be seeded
  }

  return { threshold, windowMs, durationMs };
}

/**
 * Count failed login attempts within the observation window.
 */
async function countRecentAttempts(
  userId: bigint,
  windowStart: Date,
  knexInstance: KnexType,
): Promise<number> {
  const result = await knexInstance('login_attempts')
    .where('user_id', userId.toString())
    .where('attempted_at', '>=', formatDatetime(windowStart))
    .count<{ count: number }[]>('id as count');
  return Number(result[0]?.count ?? 0);
}

export async function recordFailedLogin(
  userId: bigint,
  knexInstance: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<{ locked: boolean; lockedUntil?: Date }> {
  const now = clock.now();
  const settings = await getLockoutSettings(knexInstance);

  const user = await knexInstance('users')
    .where({ id: userId.toString() })
    .first<UserLockRow>();

  if (!user) {
    return { locked: false };
  }

  // Record this failed attempt with timestamp
  await knexInstance('login_attempts').insert({
    user_id: userId.toString(),
    attempted_at: formatDatetime(now),
  });

  // Also increment the legacy counter for backward compatibility
  const newCount = (user.failed_login_count ?? 0) + 1;
  await knexInstance('users').where({ id: userId.toString() }).update({
    failed_login_count: newCount,
  });

  // Count failed attempts within the observation window
  const windowStart = new Date(now.getTime() - settings.windowMs);
  const windowedCount = await countRecentAttempts(userId, windowStart, knexInstance);

  if (windowedCount >= settings.threshold) {
    const lockedUntil = new Date(now.getTime() + settings.durationMs);
    await knexInstance('users').where({ id: userId.toString() }).update({
      status: 'locked',
      locked_until: formatDatetime(lockedUntil),
    });
    return { locked: true, lockedUntil };
  }

  return { locked: false };
}

export async function recordSuccessfulLogin(
  userId: bigint,
  knexInstance: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<void> {
  const now = clock.now();
  const user = await knexInstance('users')
    .where({ id: userId.toString() })
    .first<UserLockRow | undefined>();

  if (!user) return;

  const updates: Record<string, unknown> = {
    failed_login_count: 0,
  };

  // If locked with a timed expiry that has passed, clear it.
  // Null locked_until = permanent admin lock — never auto-clear.
  if (user.status === 'locked') {
    const lockedUntil = parseDbDate(user.locked_until);
    if (lockedUntil && lockedUntil <= now) {
      updates.status = 'active';
      updates.locked_until = null;
    }
  }

  if (user.status !== 'locked') {
    updates.locked_until = null;
  }

  await knexInstance('users').where({ id: userId.toString() }).update(updates);

  // Clear old login attempts for this user on successful login
  await knexInstance('login_attempts').where('user_id', userId.toString()).delete();
}

export async function checkLockout(
  userId: bigint,
  knexInstance: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<{ blocked: boolean; until?: Date }> {
  const now = clock.now();
  const user = await knexInstance('users')
    .where({ id: userId.toString() })
    .first<UserLockRow | undefined>();

  if (!user) {
    return { blocked: false };
  }

  if (user.status !== 'locked') {
    return { blocked: false };
  }

  const lockedUntil = parseDbDate(user.locked_until);

  // No locked_until → permanent admin lock; only an admin unlock can clear it
  if (!lockedUntil) {
    return { blocked: true };
  }

  if (lockedUntil > now) {
    return { blocked: true, until: lockedUntil };
  }

  // Timed lock has expired, clear it
  await knexInstance('users').where({ id: userId.toString() }).update({
    status: 'active',
    locked_until: null,
  });

  return { blocked: false };
}
