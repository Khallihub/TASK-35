import crypto from 'crypto';
import { Knex as KnexType } from 'knex';
import { Clock, systemClock } from '../clock';
import defaultKnex from '../db/knex';
import { AppError, ErrorCodes } from '../errors';

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

/**
 * Parse a datetime value from DB — handles Date objects, ISO strings, and
 * the MySQL-formatted "YYYY-MM-DD HH:MM:SS.mmm" strings that SQLite returns.
 */
function parseDbDate(val: Date | string | number | null): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number') return new Date(val);
  // Handle "YYYY-MM-DD HH:MM:SS.mmm" as UTC
  const str = String(val).replace(' ', 'T');
  const d = new Date(str.includes('Z') || str.includes('+') ? str : str + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

interface NonceRow {
  id: number;
  value: string;
  purpose: string;
  user_id: number | null;
  created_at: Date | string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}

export async function generateNonce(
  purpose: string,
  userId: bigint | null,
  knexInstance: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<string> {
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);

  // Generate 18 random bytes -> 24 base64url chars
  const value = crypto.randomBytes(18).toString('base64url');

  await knexInstance('nonces').insert({
    value,
    purpose,
    user_id: userId ? userId.toString() : null,
    created_at: formatDatetime(now),
    expires_at: formatDatetime(expiresAt),
    consumed_at: null,
  });

  return value;
}

export async function consumeNonce(
  value: string,
  purpose: string,
  expectedUserId?: number | null,
  knexInstance: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<void> {
  const now = clock.now();
  const row = await knexInstance('nonces').where({ value }).first<NonceRow | undefined>();

  if (!row) {
    throw new AppError(ErrorCodes.NONCE_INVALID, 'Nonce not found', 401);
  }

  if (row.consumed_at) {
    throw new AppError(ErrorCodes.NONCE_INVALID, 'Nonce already consumed', 401);
  }

  const expiresAt = parseDbDate(row.expires_at);
  if (!expiresAt || expiresAt < now) {
    throw new AppError(ErrorCodes.NONCE_EXPIRED, 'Nonce has expired', 401);
  }

  if (row.purpose !== purpose) {
    throw new AppError(ErrorCodes.NONCE_INVALID, 'Nonce purpose mismatch', 401);
  }

  // Actor binding: if expectedUserId is provided and the nonce has a user_id, they must match
  if (expectedUserId !== undefined && expectedUserId !== null && row.user_id !== null) {
    if (Number(row.user_id) !== expectedUserId) {
      throw new AppError(ErrorCodes.NONCE_INVALID, 'Nonce actor mismatch', 401);
    }
  }

  await knexInstance('nonces').where({ value }).update({
    consumed_at: formatDatetime(now),
  });
}
