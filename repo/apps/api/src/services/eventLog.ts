import { Knex as KnexType } from 'knex';
import { Clock, systemClock } from '../clock';
import defaultKnex from '../db/knex';

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

export async function logEvent(params: {
  user_id?: number;
  event_type: string;
  entity_type?: string;
  entity_id?: number;
  office_id?: number;
  payload?: Record<string, unknown>;
  ip?: string;
  clock?: Clock;
  knex?: KnexType;
}): Promise<void> {
  const db = params.knex ?? defaultKnex;
  const clock = params.clock ?? systemClock;
  const now = clock.now();

  await db('event_log').insert({
    user_id: params.user_id ?? null,
    event_type: params.event_type,
    entity_type: params.entity_type ?? null,
    entity_id: params.entity_id ?? null,
    office_id: params.office_id ?? null,
    payload_json: params.payload ? JSON.stringify(params.payload) : null,
    ip: params.ip ?? null,
    created_at: formatDatetime(now),
  });
}
