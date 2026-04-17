import { Knex as KnexType } from 'knex';
import defaultKnex from '../db/knex';
import { AppError, ErrorCodes } from '../errors';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

interface IdempotencyRow {
  key_value: string;
  user_id: number;
  route: string;
  request_hash: string;
  response_snapshot: string | null;
  status_code: number;
  created_at: Date | string;
  expires_at: Date | string;
}

export async function checkIdempotency(
  key: string,
  userId: bigint,
  route: string,
  requestHash: string,
  knexInstance: KnexType = defaultKnex,
): Promise<{ exists: boolean; response?: { status: number; body: unknown } }> {
  const row = await knexInstance('idempotency_keys')
    .where({ key_value: key })
    .first<IdempotencyRow | undefined>();

  if (!row) {
    return { exists: false };
  }

  // Enforce collision semantics: same key must match user, route, and request hash
  if (
    String(row.user_id) !== String(userId) ||
    row.route !== route ||
    row.request_hash !== requestHash
  ) {
    throw new AppError(
      ErrorCodes.CONFLICT,
      'Idempotency key reused with different user, route, or payload',
      409,
    );
  }

  // Check TTL
  const expiresAt = new Date(row.expires_at);
  if (expiresAt < new Date()) {
    // Expired record — treat as new request
    return { exists: false };
  }

  const snapshot = row.response_snapshot
    ? (typeof row.response_snapshot === 'string'
        ? (JSON.parse(row.response_snapshot) as unknown)
        : row.response_snapshot)
    : null;

  return {
    exists: true,
    response: {
      status: row.status_code,
      body: snapshot,
    },
  };
}

export async function saveIdempotency(
  key: string,
  userId: bigint,
  route: string,
  requestHash: string,
  status: number,
  body: unknown,
  knexInstance: KnexType = defaultKnex,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);

  const row = {
    key_value: key,
    user_id: userId.toString(),
    route,
    request_hash: requestHash,
    response_snapshot: JSON.stringify(body),
    status_code: status,
    created_at: formatDatetime(now),
    expires_at: formatDatetime(expiresAt),
  };

  // Check if exists for upsert
  const existing = await knexInstance('idempotency_keys').where({ key_value: key }).first();
  if (existing) {
    await knexInstance('idempotency_keys').where({ key_value: key }).update({
      response_snapshot: row.response_snapshot,
      status_code: row.status_code,
    });
  } else {
    await knexInstance('idempotency_keys').insert(row).catch(() => {
      // Ignore duplicate key on race condition
    });
  }
}
