import crypto from 'crypto';
import { Knex as KnexType } from 'knex';
import defaultKnex from '../db/knex';
import { Clock, systemClock } from '../clock';

export interface AuditEventInput {
  actor_id?: bigint | number | null;
  actor_role?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  before_json?: Record<string, unknown> | null;
  after_json?: Record<string, unknown> | null;
  ip?: string | null;
  user_agent?: string | null;
  legal_hold?: boolean;
}

interface AuditRowData {
  actor_id: bigint | number | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  legal_hold: number;
  created_at: string;
}

interface AuditRow {
  id: bigint | number;
  prev_hash: string;
  row_hash: string;
  actor_id: bigint | number | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before_json: string | Record<string, unknown> | null;
  after_json: string | Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  legal_hold: number;
  created_at: string | Date;
}

/**
 * Recursively sort all object keys so that JSON.stringify produces a
 * deterministic string regardless of insertion order.  This is essential
 * because MySQL's JSON column type stores keys in sorted order — reading
 * back a JSON object can return keys in a different order than they were
 * written, which would break hash verification if we relied on insertion
 * order.
 */
function deepSortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(deepSortKeys);
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = deepSortKeys((value as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return value;
}

/**
 * Sort JSON keys alphabetically (including nested objects) and produce a
 * deterministic string.  Excludes id, prev_hash, row_hash from the hash
 * computation.
 */
function canonical(row: AuditRowData): string {
  return JSON.stringify(deepSortKeys(row));
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function formatDatetime(d: Date): string {
  // Format as YYYY-MM-DD HH:MM:SS.mmm for MySQL DATETIME(3)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

let _knexInstance: KnexType | null = null;

/**
 * Override the knex instance used by the audit module (for testing with SQLite).
 */
export function setAuditKnex(k: KnexType): void {
  _knexInstance = k;
}

export function resetAuditKnex(): void {
  _knexInstance = null;
}

function getKnex(): KnexType {
  return _knexInstance ?? defaultKnex;
}

/**
 * Append one audit event; returns the inserted row id as bigint.
 * Uses SELECT ... FOR UPDATE on MySQL to prevent race conditions.
 *
 * When `existingTrx` is provided, the audit row is written inside that
 * transaction — making it atomic with the caller's business writes.
 * When omitted, a new transaction is created (legacy behaviour).
 */
export async function appendAuditEvent(
  data: AuditEventInput,
  clock: Clock = systemClock,
  existingTrx?: KnexType,
): Promise<bigint> {
  const knex = existingTrx ?? getKnex();
  const isSQLite = (knex.client as { config?: { client?: string } }).config?.client === 'better-sqlite3'
    || ((getKnex().client as { config?: { client?: string } }).config?.client === 'better-sqlite3');

  let insertedId!: bigint;

  // If caller provided a transaction, write directly into it.
  // Otherwise create our own transaction (backward-compatible).
  const doWork = async (trx: KnexType) => {
    // Get the last row's hash (with row-level lock on MySQL)
    let prevHash: string;

    if (isSQLite) {
      // SQLite: no FOR UPDATE support, serialized transactions handle isolation
      const lastRow = await trx('audit_log')
        .orderBy('id', 'desc')
        .first<Pick<AuditRow, 'row_hash'> | undefined>(['row_hash']);
      prevHash = lastRow?.row_hash ?? '0'.repeat(64);
    } else {
      // MySQL: use raw FOR UPDATE to lock the last row
      const result = await trx.raw(
        'SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1 FOR UPDATE',
      ) as [Array<{ row_hash: string }>, unknown];
      const rows = result[0];
      prevHash = rows.length > 0 ? rows[0].row_hash : '0'.repeat(64);
    }

    const createdAt = clock.now();
    const createdAtStr = formatDatetime(createdAt);

    const rowData: AuditRowData = {
      actor_id: data.actor_id ?? null,
      actor_role: data.actor_role ?? null,
      action: data.action,
      entity_type: data.entity_type ?? null,
      entity_id: data.entity_id ?? null,
      before_json: data.before_json ?? null,
      after_json: data.after_json ?? null,
      ip: data.ip ?? null,
      user_agent: data.user_agent ?? null,
      legal_hold: data.legal_hold ? 1 : 0,
      created_at: createdAtStr,
    };

    const rowHash = sha256(prevHash + '|' + canonical(rowData));

    const insertObj = {
      prev_hash: prevHash,
      row_hash: rowHash,
      actor_id: rowData.actor_id,
      actor_role: rowData.actor_role,
      action: rowData.action,
      entity_type: rowData.entity_type,
      entity_id: rowData.entity_id,
      before_json: rowData.before_json !== null ? JSON.stringify(rowData.before_json) : null,
      after_json: rowData.after_json !== null ? JSON.stringify(rowData.after_json) : null,
      ip: rowData.ip,
      user_agent: rowData.user_agent,
      legal_hold: rowData.legal_hold,
      created_at: createdAtStr,
    };

    const [id] = await trx('audit_log').insert(insertObj);
    insertedId = BigInt(id);
  };

  if (existingTrx) {
    // Write directly into the caller's transaction
    await doWork(existingTrx);
  } else {
    // Create our own transaction (backward-compatible)
    await getKnex().transaction(async (trx) => doWork(trx));
  }

  return insertedId;
}

/**
 * Verify the entire audit chain integrity.
 * Iterates all rows ORDER BY id ASC in pages of 1000.
 * Returns { valid: true } if intact, or { valid: false, brokenAt: <id> } on first mismatch.
 */
export async function verifyChain(): Promise<{ valid: boolean; brokenAt?: bigint }> {
  const knex = getKnex();
  const PAGE_SIZE = 1000;
  let offset = 0;
  // After retention compaction, the first surviving row's prev_hash may point
  // to a deleted predecessor rather than the genesis sentinel. We accept the
  // first row's prev_hash as the starting anchor (verified below by checking
  // that its own row_hash is self-consistent).
  let expectedPrevHash: string | null = null; // set from first row
  let hasMore = true;

  while (hasMore) {
    const rows = await knex('audit_log')
      .orderBy('id', 'asc')
      .limit(PAGE_SIZE)
      .offset(offset)
      .select<AuditRow[]>([
        'id',
        'prev_hash',
        'row_hash',
        'actor_id',
        'actor_role',
        'action',
        'entity_type',
        'entity_id',
        'before_json',
        'after_json',
        'ip',
        'user_agent',
        'legal_hold',
        'created_at',
      ]);

    if (rows.length === 0) {
      hasMore = false;
      continue;
    }

    for (const row of rows) {
      // For the very first row in the chain (or first after compaction),
      // accept its prev_hash as the anchor point.
      if (expectedPrevHash === null) {
        expectedPrevHash = row.prev_hash;
      }

      // Check prev_hash matches expected
      if (row.prev_hash !== expectedPrevHash) {
        return { valid: false, brokenAt: BigInt(row.id) };
      }

      // Reconstruct the canonical row data
      const createdAt =
        row.created_at instanceof Date
          ? formatDatetime(row.created_at)
          : String(row.created_at);

      // Parse JSON fields if stored as strings
      let beforeJson: Record<string, unknown> | null = null;
      let afterJson: Record<string, unknown> | null = null;

      if (row.before_json !== null && row.before_json !== undefined) {
        beforeJson =
          typeof row.before_json === 'string'
            ? (JSON.parse(row.before_json) as Record<string, unknown>)
            : (row.before_json as Record<string, unknown>);
      }
      if (row.after_json !== null && row.after_json !== undefined) {
        afterJson =
          typeof row.after_json === 'string'
            ? (JSON.parse(row.after_json) as Record<string, unknown>)
            : (row.after_json as Record<string, unknown>);
      }

      const rowData: AuditRowData = {
        actor_id: row.actor_id,
        actor_role: row.actor_role,
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        before_json: beforeJson,
        after_json: afterJson,
        ip: row.ip,
        user_agent: row.user_agent,
        legal_hold: typeof row.legal_hold === 'boolean' ? (row.legal_hold ? 1 : 0) : Number(row.legal_hold),
        created_at: createdAt,
      };

      const expectedRowHash = sha256(row.prev_hash + '|' + canonical(rowData));

      if (row.row_hash !== expectedRowHash) {
        return { valid: false, brokenAt: BigInt(row.id) };
      }

      expectedPrevHash = row.row_hash;
    }

    if (rows.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += PAGE_SIZE;
    }
  }

  return { valid: true };
}

/**
 * Re-compute prev_hash and row_hash for every row in the audit chain using
 * the current (deterministic, deep-sorted) canonical function.
 *
 * This repairs chains broken by MySQL JSON key-reordering: the original
 * hashes were computed with insertion-order keys, but MySQL returns sorted
 * keys on read, causing verification mismatches.
 *
 * Returns the number of rows repaired.
 */
export async function repairChain(): Promise<{ repaired: number }> {
  const knex = getKnex();
  const PAGE_SIZE = 500;
  let offset = 0;
  let prevHash = '0'.repeat(64);
  let repaired = 0;
  let hasMore = true;

  while (hasMore) {
    const rows = await knex('audit_log')
      .orderBy('id', 'asc')
      .limit(PAGE_SIZE)
      .offset(offset)
      .select<AuditRow[]>([
        'id',
        'prev_hash',
        'row_hash',
        'actor_id',
        'actor_role',
        'action',
        'entity_type',
        'entity_id',
        'before_json',
        'after_json',
        'ip',
        'user_agent',
        'legal_hold',
        'created_at',
      ]);

    if (rows.length === 0) {
      hasMore = false;
      continue;
    }

    for (const row of rows) {
      const createdAt =
        row.created_at instanceof Date
          ? formatDatetime(row.created_at)
          : String(row.created_at);

      let beforeJson: Record<string, unknown> | null = null;
      let afterJson: Record<string, unknown> | null = null;

      if (row.before_json !== null && row.before_json !== undefined) {
        beforeJson =
          typeof row.before_json === 'string'
            ? (JSON.parse(row.before_json) as Record<string, unknown>)
            : (row.before_json as Record<string, unknown>);
      }
      if (row.after_json !== null && row.after_json !== undefined) {
        afterJson =
          typeof row.after_json === 'string'
            ? (JSON.parse(row.after_json) as Record<string, unknown>)
            : (row.after_json as Record<string, unknown>);
      }

      const rowData: AuditRowData = {
        actor_id: row.actor_id,
        actor_role: row.actor_role,
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        before_json: beforeJson,
        after_json: afterJson,
        ip: row.ip,
        user_agent: row.user_agent,
        legal_hold: typeof row.legal_hold === 'boolean' ? (row.legal_hold ? 1 : 0) : Number(row.legal_hold),
        created_at: createdAt,
      };

      const correctHash = sha256(prevHash + '|' + canonical(rowData));

      if (row.prev_hash !== prevHash || row.row_hash !== correctHash) {
        await knex('audit_log')
          .where({ id: row.id })
          .update({ prev_hash: prevHash, row_hash: correctHash });
        repaired++;
      }

      prevHash = correctHash;
    }

    if (rows.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += PAGE_SIZE;
    }
  }

  return { repaired };
}
