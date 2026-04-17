import { Knex as KnexType } from 'knex';
import { Clock, systemClock } from '../clock';
import defaultKnex from '../db/knex';

export interface ConsentVersion {
  id: number;
  version: string;
  body_md: string;
  effective_from: Date | string;
}

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

export async function getLatestConsentVersion(
  knexInstance: KnexType = defaultKnex,
): Promise<ConsentVersion | null> {
  const row = await knexInstance('consent_versions')
    .orderBy('effective_from', 'desc')
    .first<ConsentVersion | undefined>();
  return row ?? null;
}

export async function hasUserAcceptedLatest(
  userId: bigint,
  knexInstance: KnexType = defaultKnex,
): Promise<boolean> {
  const latest = await getLatestConsentVersion(knexInstance);
  if (!latest) {
    return true; // No consent required if no version exists
  }

  const record = await knexInstance('consent_records')
    .where({ user_id: userId.toString(), consent_version_id: latest.id })
    .first();

  return !!record;
}

export async function recordConsent(
  userId: bigint,
  versionId: bigint,
  ip: string,
  knexInstance: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<void> {
  const now = clock.now();
  await knexInstance('consent_records').insert({
    user_id: userId.toString(),
    consent_version_id: versionId.toString(),
    accepted_at: formatDatetime(now),
    ip,
  });

  // Update user's consent fields
  await knexInstance('users').where({ id: userId.toString() }).update({
    consent_version_accepted: versionId.toString(),
    consent_accepted_at: formatDatetime(now),
  });
}
