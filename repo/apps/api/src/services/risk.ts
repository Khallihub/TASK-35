import { Knex as KnexType } from 'knex';
import defaultKnex from '../db/knex';
import { Clock, systemClock } from '../clock';
import { appendAuditEvent } from '../audit/chain';
import { revokeAllUserSessions } from './session';

export interface RiskProfile {
  id: number;
  user_id: number;
  credit_score: number;
  last_decay_at: string | null;
  flags: Record<string, unknown> | string | null;
}

export interface BlacklistEntry {
  id: number;
  subject_type: 'user' | 'ip' | 'device';
  subject_value: string;
  reason: string;
  expires_at: string | null;
  created_by: number | null;
  created_at: string;
}

export interface RiskEvent {
  id: number;
  user_id: number;
  event_type: string;
  delta: number;
  new_score: number;
  detail_json: Record<string, unknown> | string | null;
  created_at: string;
}

export const PENALTIES: Record<string, number> = {
  'no_show_approval': -5,
  'policy_violation': -10,
  'multi_device_login': -3,
  'abnormal_ip_pattern': -5,
};

function getDb(knex?: KnexType): KnexType {
  return knex ?? defaultKnex;
}

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

function isSQLite(knex: KnexType): boolean {
  return (knex.client as { config?: { client?: string } }).config?.client === 'better-sqlite3';
}

/**
 * Get or create a risk profile for a user.
 */
export async function getOrCreateProfile(
  userId: number,
  knex?: KnexType,
  clock: Clock = systemClock,
): Promise<RiskProfile> {
  const db = getDb(knex);

  const existing = await db('risk_profiles').where({ user_id: userId }).first<RiskProfile>();
  if (existing) return existing;

  const now = formatDatetime(clock.now());

  if (isSQLite(db)) {
    await db.raw(
      `INSERT OR IGNORE INTO risk_profiles (user_id, credit_score, last_decay_at, flags) VALUES (?, 100, NULL, NULL)`,
      [userId],
    );
  } else {
    await db.raw(
      `INSERT IGNORE INTO risk_profiles (user_id, credit_score, last_decay_at, flags) VALUES (?, 100, NULL, NULL)`,
      [userId],
    );
  }

  void now; // suppress unused warning
  const profile = await db('risk_profiles').where({ user_id: userId }).first<RiskProfile>();
  return profile!;
}

/**
 * Get risk profile for a user (must exist).
 */
export async function getRiskProfile(userId: number, knex?: KnexType): Promise<RiskProfile> {
  const db = getDb(knex);
  const profile = await db('risk_profiles').where({ user_id: userId }).first<RiskProfile>();
  if (!profile) throw new Error(`Risk profile not found for user ${userId}`);
  return profile;
}

/**
 * Apply threshold actions based on score.
 */
export async function applyThresholdActions(
  userId: number,
  score: number,
  knex?: KnexType,
  clock: Clock = systemClock,
): Promise<void> {
  const db = getDb(knex);
  const now = clock.now();
  const nowStr = formatDatetime(now);

  if (score < 20) {
    // Disable account + event + audit — all atomic
    await db.transaction(async (trx) => {
      await trx('users').where({ id: userId }).update({ status: 'disabled' });
      await revokeAllUserSessions(BigInt(userId), 'risk_disabled', trx, clock);

      await trx('risk_events').insert({
        user_id: userId,
        event_type: 'threshold_disabled',
        delta: 0,
        new_score: score,
        detail_json: JSON.stringify({ reason: 'score_below_20' }),
        created_at: nowStr,
      });

      await appendAuditEvent({
        actor_id: null,
        actor_role: 'system',
        action: 'risk.threshold_disabled',
        entity_type: 'user',
        entity_id: String(userId),
        after_json: { score, action: 'account_disabled' },
      }, clock, trx);
    });
  } else if (score < 40) {
    // Check current status
    const user = await db('users').where({ id: userId }).first<{ status: string }>();
    if (user && user.status !== 'disabled') {
      const lockedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const lockedUntilStr = formatDatetime(lockedUntil);

      await db.transaction(async (trx) => {
        await trx('users').where({ id: userId }).update({
          status: 'locked',
          locked_until: lockedUntilStr,
        });
        await revokeAllUserSessions(BigInt(userId), 'risk_locked', trx, clock);

        await trx('risk_events').insert({
          user_id: userId,
          event_type: 'threshold_lockout',
          delta: 0,
          new_score: score,
          detail_json: JSON.stringify({ reason: 'score_below_40', locked_until: lockedUntilStr }),
          created_at: nowStr,
        });

        await appendAuditEvent({
          actor_id: null,
          actor_role: 'system',
          action: 'risk.threshold_lockout',
          entity_type: 'user',
          entity_id: String(userId),
          after_json: { score, action: 'account_locked', locked_until: lockedUntilStr },
        }, clock, trx);
      });
    }
  } else if (score < 60) {
    // Force password reset + revoke sessions + audit — atomic
    await db.transaction(async (trx) => {
      await trx('users').where({ id: userId }).update({ must_change_password: 1 });
      await revokeAllUserSessions(BigInt(userId), 'risk_must_change_password', trx, clock);

      await appendAuditEvent({
        actor_id: null,
        actor_role: 'system',
        action: 'risk.threshold_must_change_password',
        entity_type: 'user',
        entity_id: String(userId),
        after_json: { score, action: 'must_change_password' },
      }, clock, trx);
    });
  }
}

/**
 * Apply a penalty to a user's risk score.
 */
export async function applyPenalty(
  userId: number,
  penaltyType: string,
  detail: Record<string, unknown>,
  knex?: KnexType,
  clock: Clock = systemClock,
): Promise<RiskProfile> {
  const db = getDb(knex);

  if (!(penaltyType in PENALTIES)) {
    throw new Error(`Unknown penalty type: ${penaltyType}`);
  }

  const profile = await getOrCreateProfile(userId, db, clock);
  const delta = PENALTIES[penaltyType];
  const newScore = Math.max(0, profile.credit_score + delta);

  const now = formatDatetime(clock.now());

  // Update risk_profiles + insert risk_events + audit atomically
  await db.transaction(async (trx) => {
    await trx('risk_profiles').where({ user_id: userId }).update({ credit_score: newScore });

    await trx('risk_events').insert({
      user_id: userId,
      event_type: penaltyType,
      delta,
      new_score: newScore,
      detail_json: JSON.stringify(detail),
      created_at: now,
    });

    await appendAuditEvent({
      actor_id: null,
      actor_role: 'system',
      action: 'risk.penalty_applied',
      entity_type: 'user',
      entity_id: String(userId),
      after_json: { penaltyType, delta, newScore, detail },
    }, clock, trx);
  });

  await applyThresholdActions(userId, newScore, db, clock);

  const updatedProfile = await db('risk_profiles').where({ user_id: userId }).first<RiskProfile>();
  return updatedProfile!;
}

/**
 * Apply decay to a user's risk score (+1 per 7 days of clean activity).
 */
export async function applyDecay(
  userId: number,
  knex?: KnexType,
  clock: Clock = systemClock,
): Promise<RiskProfile> {
  const db = getDb(knex);
  const profile = await getOrCreateProfile(userId, db, clock);

  const now = clock.now();
  const lastDecay = profile.last_decay_at ? new Date(profile.last_decay_at) : null;

  let daysDiff = 0;
  if (lastDecay) {
    daysDiff = (now.getTime() - lastDecay.getTime()) / (1000 * 60 * 60 * 24);
  } else {
    // No decay yet; start from when we just apply 0
    daysDiff = 0;
  }

  const increment = Math.floor(daysDiff / 7);
  const newScore = Math.min(100, profile.credit_score + increment);
  const delta = newScore - profile.credit_score;

  const nowStr = formatDatetime(now);
  await db('risk_profiles').where({ user_id: userId }).update({
    credit_score: newScore,
    last_decay_at: nowStr,
  });

  await db('risk_events').insert({
    user_id: userId,
    event_type: 'decay',
    delta,
    new_score: newScore,
    detail_json: JSON.stringify({ days_elapsed: Math.floor(daysDiff), increment }),
    created_at: nowStr,
  });

  const updatedProfile = await db('risk_profiles').where({ user_id: userId }).first<RiskProfile>();
  return updatedProfile!;
}

/**
 * Apply decay to all active users with existing risk profiles.
 */
export async function decayAllUsers(
  knex?: KnexType,
  clock: Clock = systemClock,
): Promise<{ processed: number }> {
  const db = getDb(knex);
  const now = clock.now();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoStr = formatDatetime(sevenDaysAgo);

  const users = await db('users as u')
    .join('risk_profiles as rp', 'rp.user_id', 'u.id')
    .where('u.status', 'active')
    .where(function() {
      this.whereNull('rp.last_decay_at')
        .orWhere('rp.last_decay_at', '<', sevenDaysAgoStr);
    })
    .select('u.id');

  let processed = 0;
  for (const user of users) {
    await applyDecay(user.id, db, clock);
    processed++;
  }

  return { processed };
}

/**
 * Check if a subject is blacklisted.
 */
export async function checkBlacklist(
  subjectType: 'user' | 'ip' | 'device',
  subjectValue: string,
  knex?: KnexType,
  clock: Clock = systemClock,
): Promise<boolean> {
  const db = getDb(knex);
  const now = formatDatetime(clock.now());

  const entry = await db('blacklist_entries')
    .where({ subject_type: subjectType, subject_value: subjectValue })
    .where(function() {
      this.whereNull('expires_at').orWhere('expires_at', '>', now);
    })
    .first();

  return !!entry;
}

/**
 * Add a blacklist entry.
 */
export async function addBlacklist(
  entry: {
    subjectType: 'user' | 'ip' | 'device';
    subjectValue: string;
    reason: string;
    expiresAt?: Date | string;
    createdBy?: number;
  },
  knex?: KnexType,
  clock: Clock = systemClock,
): Promise<BlacklistEntry> {
  const db = getDb(knex);
  const now = formatDatetime(clock.now());

  const expiresAtStr = entry.expiresAt
    ? (entry.expiresAt instanceof Date ? formatDatetime(entry.expiresAt) : entry.expiresAt)
    : null;

  let result!: BlacklistEntry;
  await db.transaction(async (trx) => {
    if (isSQLite(db)) {
      await trx.raw(
        `INSERT OR REPLACE INTO blacklist_entries (subject_type, subject_value, reason, expires_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [entry.subjectType, entry.subjectValue, entry.reason, expiresAtStr, entry.createdBy ?? null, now],
      );
    } else {
      await trx.raw(
        `INSERT INTO blacklist_entries (subject_type, subject_value, reason, expires_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE reason = VALUES(reason), expires_at = VALUES(expires_at)`,
        [entry.subjectType, entry.subjectValue, entry.reason, expiresAtStr, entry.createdBy ?? null, now],
      );
    }

    await appendAuditEvent({
      actor_id: entry.createdBy ?? null,
      actor_role: 'system',
      action: 'blacklist.added',
      entity_type: 'blacklist',
      entity_id: `${entry.subjectType}:${entry.subjectValue}`,
      after_json: { subjectType: entry.subjectType, subjectValue: entry.subjectValue, reason: entry.reason },
    }, clock, trx);

    result = await trx('blacklist_entries')
      .where({ subject_type: entry.subjectType, subject_value: entry.subjectValue })
      .first<BlacklistEntry>();
  });
  return result;
}

/**
 * Remove a blacklist entry.
 */
export async function removeBlacklist(
  id: number,
  actor: { id: number; role: string },
  knex?: KnexType,
  clock: Clock = systemClock,
): Promise<void> {
  const db = getDb(knex);

  const entry = await db('blacklist_entries').where({ id }).first<BlacklistEntry>();
  if (!entry) throw new Error(`Blacklist entry ${id} not found`);

  await db.transaction(async (trx) => {
    await trx('blacklist_entries').where({ id }).delete();

    await appendAuditEvent({
      actor_id: actor.id,
      actor_role: actor.role,
      action: 'blacklist.removed',
      entity_type: 'blacklist',
      entity_id: String(id),
      before_json: { subjectType: entry.subject_type, subjectValue: entry.subject_value },
    }, clock, trx);
  });
}

/**
 * List all blacklist entries.
 */
export async function listBlacklist(knex?: KnexType): Promise<BlacklistEntry[]> {
  const db = getDb(knex);
  return db('blacklist_entries').select('*').orderBy('id', 'asc');
}

/**
 * List risk events for a user.
 */
export async function listRiskEvents(
  userId: number,
  limit: number,
  knex?: KnexType,
): Promise<RiskEvent[]> {
  const db = getDb(knex);
  return db('risk_events')
    .where({ user_id: userId })
    .orderBy('id', 'desc')
    .limit(limit)
    .select('*');
}
