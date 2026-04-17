import { Knex as KnexType } from 'knex';
import defaultKnex from '../db/knex';
import { Clock, systemClock } from '../clock';

export type KpiMetric =
  | 'new_users'
  | 'active_users'
  | 'listings_published'
  | 'engagement_actions'
  | 'funnel_draft'
  | 'funnel_approved'
  | 'funnel_published';

export interface KpiRow {
  grain_date: string;
  office_id: number | null;
  agent_id: number | null;
  metric: KpiMetric;
  value: number;
}

export interface FunnelData {
  draft: number;
  approved: number;
  published: number;
  approvalRate: number;
  publishRate: number;
}

// Row type for intermediate query results
interface QueryRow {
  office_id?: number | null;
  agent_id?: number | null;
  user_id?: number | null;
  cnt?: number | string;
  total?: number | string;
  metric?: string;
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

function getDb(knex?: KnexType): KnexType {
  return knex ?? defaultKnex;
}

function isSQLite(knex: KnexType): boolean {
  return (knex.client as { config?: { client?: string } }).config?.client === 'better-sqlite3';
}

function dayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function dayEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function lastDayOfMonth(monthStart: Date): Date {
  const y = monthStart.getUTCFullYear();
  const m = monthStart.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 0));
}

type KpiUpsertRow = {
  grain_date: string;
  office_id: number | null;
  agent_id: number | null;
  metric: string;
  value: number;
};

/**
 * Build a NULL-aware WHERE clause that matches a row by its natural key.
 * MySQL unique indexes treat NULL != NULL, so ON DUPLICATE KEY UPDATE
 * silently inserts duplicates when office_id or agent_id is NULL.
 * This helper uses IS NULL / = consistently across both drivers.
 */
function matchRow(q: KnexType.QueryBuilder, row: KpiUpsertRow): KnexType.QueryBuilder {
  q = q.where({ grain_date: row.grain_date, metric: row.metric });
  q = row.office_id === null ? q.whereNull('office_id') : q.where('office_id', row.office_id);
  q = row.agent_id === null ? q.whereNull('agent_id') : q.where('agent_id', row.agent_id);
  return q;
}

/**
 * Upsert KPI rows into the given table.
 * Uses explicit SELECT → UPDATE/INSERT to handle NULL columns correctly
 * on both SQLite and MySQL (where unique indexes ignore NULLs).
 */
async function upsertKpiRows(
  table: string,
  rows: KpiUpsertRow[],
  knex: KnexType,
): Promise<number> {
  if (rows.length === 0) return 0;

  for (const row of rows) {
    const existing = await matchRow(knex(table), row).first();
    if (existing) {
      await matchRow(knex(table), row).update({ value: row.value });
    } else {
      await knex(table).insert(row);
    }
  }

  return rows.length;
}

export async function rollupDailyKpi(
  date: Date,
  knex?: KnexType,
  _clock?: Clock,
): Promise<{ inserted: number }> {
  const db = getDb(knex);
  const grainDate = formatDate(date);
  const start = formatDatetime(dayStart(date));
  const end = formatDatetime(dayEnd(date));

  // Delete existing rows for this date to avoid duplicates from prior
  // buggy upserts (MySQL unique indexes ignore NULLs, so rows with
  // NULL office_id/agent_id were duplicated on every rollup run).
  await db('kpi_daily').where({ grain_date: grainDate }).delete();

  const rows: KpiUpsertRow[] = [];

  function addRow(office_id: number | null, agent_id: number | null, metric: string, value: number) {
    if (value > 0) {
      rows.push({ grain_date: grainDate, office_id, agent_id, metric, value });
    }
  }

  // ---- new_users ----
  const newUsersGlobal = await db('users').whereBetween('created_at', [start, end]).count('id as cnt').first() as QueryRow | undefined;
  addRow(null, null, 'new_users', Number(newUsersGlobal?.cnt ?? 0));

  const newUsersByOffice = (await db('users').select('office_id').whereBetween('created_at', [start, end]).groupBy('office_id').count('id as cnt')) as QueryRow[];
  for (const r of newUsersByOffice) {
    addRow(r.office_id !== undefined ? (r.office_id ?? null) : null, null, 'new_users', Number(r.cnt ?? 0));
  }

  // ---- active_users ----
  // PRD §5: "distinct users with >=1 auth-bearing request". sessions.issued_at
  // would over-count users whose tokens were minted but never used; the real
  // signal is `last_activity_at`, which is bumped by touchSession() on every
  // authenticated request (see services/session.ts).
  const activeUsersGlobal = await db('sessions')
    .whereBetween('last_activity_at', [start, end])
    .whereNotNull('user_id')
    .countDistinct('user_id as cnt')
    .first() as QueryRow | undefined;
  addRow(null, null, 'active_users', Number(activeUsersGlobal?.cnt ?? 0));

  const activeUsersByOffice = (await db('sessions as s')
    .join('users as u', 'u.id', db.raw('CAST(s.user_id AS UNSIGNED)'))
    .select('u.office_id as office_id')
    .whereBetween('s.last_activity_at', [start, end])
    .whereNotNull('s.user_id')
    .groupBy('u.office_id')
    .countDistinct('s.user_id as cnt')) as QueryRow[];
  for (const r of activeUsersByOffice) {
    if (r.office_id !== null && r.office_id !== undefined) {
      addRow(r.office_id, null, 'active_users', Number(r.cnt ?? 0));
    }
  }

  // Per-agent rows count each distinct user once for the day so the office /
  // global rollups that sum agent rows do NOT double-count multi-session users.
  const activeUsersByAgent = (await db('sessions as s')
    .join('users as u', 'u.id', db.raw('CAST(s.user_id AS UNSIGNED)'))
    .distinct('s.user_id', 'u.office_id as office_id')
    .whereBetween('s.last_activity_at', [start, end])
    .whereNotNull('s.user_id')) as QueryRow[];
  for (const r of activeUsersByAgent) {
    addRow(r.office_id !== undefined ? (r.office_id ?? null) : null, r.user_id !== undefined ? (r.user_id ?? null) : null, 'active_users', 1);
  }

  // ---- listings_published / funnel_published ----
  const publishedGlobal = await db('listing_status_history as lsh').join('listings as l', 'lsh.listing_id', 'l.id').whereBetween('lsh.created_at', [start, end]).where('lsh.to_status', 'published').count('lsh.id as cnt').first() as QueryRow | undefined;
  const pubGlobalCount = Number(publishedGlobal?.cnt ?? 0);
  addRow(null, null, 'listings_published', pubGlobalCount);
  addRow(null, null, 'funnel_published', pubGlobalCount);

  const publishedByOffice = (await db('listing_status_history as lsh').join('listings as l', 'lsh.listing_id', 'l.id').select('l.office_id as office_id').whereBetween('lsh.created_at', [start, end]).where('lsh.to_status', 'published').groupBy('l.office_id').count('lsh.id as cnt')) as QueryRow[];
  for (const r of publishedByOffice) {
    addRow(r.office_id !== undefined ? (r.office_id ?? null) : null, null, 'listings_published', Number(r.cnt ?? 0));
    addRow(r.office_id !== undefined ? (r.office_id ?? null) : null, null, 'funnel_published', Number(r.cnt ?? 0));
  }

  const publishedByAgent = (await db('listing_status_history as lsh').join('listings as l', 'lsh.listing_id', 'l.id').select('l.office_id as office_id', 'l.created_by as agent_id').whereBetween('lsh.created_at', [start, end]).where('lsh.to_status', 'published').groupBy('l.office_id', 'l.created_by').count('lsh.id as cnt')) as QueryRow[];
  for (const r of publishedByAgent) {
    addRow(r.office_id !== undefined ? (r.office_id ?? null) : null, r.agent_id !== undefined ? (r.agent_id ?? null) : null, 'listings_published', Number(r.cnt ?? 0));
    addRow(r.office_id !== undefined ? (r.office_id ?? null) : null, r.agent_id !== undefined ? (r.agent_id ?? null) : null, 'funnel_published', Number(r.cnt ?? 0));
  }

  // ---- engagement_actions ----
  const engagementTypes = ['listing.view', 'listing.favorite', 'listing.share', 'promo.click'];

  const engagementGlobal = await db('event_log').whereBetween('created_at', [start, end]).whereIn('event_type', engagementTypes).count('id as cnt').first() as QueryRow | undefined;
  addRow(null, null, 'engagement_actions', Number(engagementGlobal?.cnt ?? 0));

  const engagementByOffice = (await db('event_log').select('office_id').whereBetween('created_at', [start, end]).whereIn('event_type', engagementTypes).groupBy('office_id').count('id as cnt')) as QueryRow[];
  for (const r of engagementByOffice) {
    if (r.office_id !== null && r.office_id !== undefined) {
      addRow(r.office_id, null, 'engagement_actions', Number(r.cnt ?? 0));
    }
  }

  const engagementByAgent = (await db('event_log').select('user_id', 'office_id').whereBetween('created_at', [start, end]).whereIn('event_type', engagementTypes).whereNotNull('user_id').groupBy('user_id', 'office_id').count('id as cnt')) as QueryRow[];
  for (const r of engagementByAgent) {
    addRow(r.office_id !== undefined ? (r.office_id ?? null) : null, r.user_id !== undefined ? (r.user_id ?? null) : null, 'engagement_actions', Number(r.cnt ?? 0));
  }

  // ---- funnel_draft ----
  const draftGlobal = await db('listing_status_history as lsh').join('listings as l', 'lsh.listing_id', 'l.id').whereBetween('lsh.created_at', [start, end]).where('lsh.to_status', 'draft').whereNull('lsh.from_status').count('lsh.id as cnt').first() as QueryRow | undefined;
  addRow(null, null, 'funnel_draft', Number(draftGlobal?.cnt ?? 0));

  const draftByOffice = (await db('listing_status_history as lsh').join('listings as l', 'lsh.listing_id', 'l.id').select('l.office_id as office_id').whereBetween('lsh.created_at', [start, end]).where('lsh.to_status', 'draft').whereNull('lsh.from_status').groupBy('l.office_id').count('lsh.id as cnt')) as QueryRow[];
  for (const r of draftByOffice) {
    addRow(r.office_id !== undefined ? (r.office_id ?? null) : null, null, 'funnel_draft', Number(r.cnt ?? 0));
  }

  const draftByAgent = (await db('listing_status_history as lsh').join('listings as l', 'lsh.listing_id', 'l.id').select('l.office_id as office_id', 'l.created_by as agent_id').whereBetween('lsh.created_at', [start, end]).where('lsh.to_status', 'draft').whereNull('lsh.from_status').groupBy('l.office_id', 'l.created_by').count('lsh.id as cnt')) as QueryRow[];
  for (const r of draftByAgent) {
    addRow(r.office_id !== undefined ? (r.office_id ?? null) : null, r.agent_id !== undefined ? (r.agent_id ?? null) : null, 'funnel_draft', Number(r.cnt ?? 0));
  }

  // ---- funnel_approved ----
  const approvedGlobal = await db('listing_status_history as lsh').join('listings as l', 'lsh.listing_id', 'l.id').whereBetween('lsh.created_at', [start, end]).where('lsh.to_status', 'approved').count('lsh.id as cnt').first() as QueryRow | undefined;
  addRow(null, null, 'funnel_approved', Number(approvedGlobal?.cnt ?? 0));

  const approvedByOffice = (await db('listing_status_history as lsh').join('listings as l', 'lsh.listing_id', 'l.id').select('l.office_id as office_id').whereBetween('lsh.created_at', [start, end]).where('lsh.to_status', 'approved').groupBy('l.office_id').count('lsh.id as cnt')) as QueryRow[];
  for (const r of approvedByOffice) {
    addRow(r.office_id !== undefined ? (r.office_id ?? null) : null, null, 'funnel_approved', Number(r.cnt ?? 0));
  }

  const approvedByAgent = (await db('listing_status_history as lsh').join('listings as l', 'lsh.listing_id', 'l.id').select('l.office_id as office_id', 'l.created_by as agent_id').whereBetween('lsh.created_at', [start, end]).where('lsh.to_status', 'approved').groupBy('l.office_id', 'l.created_by').count('lsh.id as cnt')) as QueryRow[];
  for (const r of approvedByAgent) {
    addRow(r.office_id !== undefined ? (r.office_id ?? null) : null, r.agent_id !== undefined ? (r.agent_id ?? null) : null, 'funnel_approved', Number(r.cnt ?? 0));
  }

  const inserted = await upsertKpiRows('kpi_daily', rows, db);
  return { inserted };
}

export async function rollupMonthlyKpi(
  monthStart: Date,
  knex?: KnexType,
  _clock?: Clock,
): Promise<{ inserted: number }> {
  const db = getDb(knex);
  const startDate = formatDate(monthStart);
  const endDate = formatDate(lastDayOfMonth(monthStart));
  const monthStartTs = formatDatetime(dayStart(monthStart));
  const monthEndTs = formatDatetime(dayEnd(lastDayOfMonth(monthStart)));

  // Clear stale rows for this month (same NULL-duplicate issue as daily).
  await db('kpi_monthly').where({ grain_date: startDate }).delete();

  // Sum-aggregable metrics — counts of discrete events that compose linearly
  // across days. active_users is intentionally excluded: it is a distinct-user
  // metric that is NOT additive (a user active on Mon+Tue is one monthly
  // active user, not two).
  const SUMMABLE: KpiMetric[] = [
    'new_users',
    'listings_published',
    'engagement_actions',
    'funnel_draft',
    'funnel_approved',
    'funnel_published',
  ];

  const aggregated = (await db('kpi_daily')
    .select('office_id', 'agent_id', 'metric')
    .whereBetween('grain_date', [startDate, endDate])
    .whereIn('metric', SUMMABLE)
    .groupBy('office_id', 'agent_id', 'metric')
    .sum('value as total')) as QueryRow[];

  const rows: KpiUpsertRow[] = aggregated.map((r) => ({
    grain_date: startDate,
    office_id: r.office_id !== undefined ? (r.office_id ?? null) : null,
    agent_id: r.agent_id !== undefined ? (r.agent_id ?? null) : null,
    metric: r.metric ?? '',
    value: Number(r.total ?? 0),
  }));

  // active_users (monthly) — distinct users with an authenticated request
  // anywhere in the month. Computed directly from sessions.last_activity_at
  // so the result is a true distinct count, not a sum of daily distinct
  // counts.
  const activeMonthlyGlobal = await db('sessions')
    .whereBetween('last_activity_at', [monthStartTs, monthEndTs])
    .whereNotNull('user_id')
    .countDistinct('user_id as cnt')
    .first() as QueryRow | undefined;
  if (Number(activeMonthlyGlobal?.cnt ?? 0) > 0) {
    rows.push({
      grain_date: startDate,
      office_id: null,
      agent_id: null,
      metric: 'active_users',
      value: Number(activeMonthlyGlobal?.cnt ?? 0),
    });
  }

  const activeMonthlyByOffice = (await db('sessions as s')
    .join('users as u', 'u.id', db.raw('CAST(s.user_id AS UNSIGNED)'))
    .select('u.office_id as office_id')
    .whereBetween('s.last_activity_at', [monthStartTs, monthEndTs])
    .whereNotNull('s.user_id')
    .groupBy('u.office_id')
    .countDistinct('s.user_id as cnt')) as QueryRow[];
  for (const r of activeMonthlyByOffice) {
    if (r.office_id !== null && r.office_id !== undefined) {
      rows.push({
        grain_date: startDate,
        office_id: r.office_id,
        agent_id: null,
        metric: 'active_users',
        value: Number(r.cnt ?? 0),
      });
    }
  }

  const activeMonthlyByAgent = (await db('sessions as s')
    .join('users as u', 'u.id', db.raw('CAST(s.user_id AS UNSIGNED)'))
    .distinct('s.user_id', 'u.office_id as office_id')
    .whereBetween('s.last_activity_at', [monthStartTs, monthEndTs])
    .whereNotNull('s.user_id')) as QueryRow[];
  for (const r of activeMonthlyByAgent) {
    rows.push({
      grain_date: startDate,
      office_id: r.office_id !== undefined ? (r.office_id ?? null) : null,
      agent_id: r.user_id !== undefined ? (r.user_id ?? null) : null,
      metric: 'active_users',
      value: 1,
    });
  }

  const inserted = await upsertKpiRows('kpi_monthly', rows, db);
  return { inserted };
}

export async function queryKpi(
  params: {
    grain: 'daily' | 'monthly';
    from: Date;
    to: Date;
    officeId?: number;
    agentId?: number;
    metrics?: KpiMetric[];
  },
  knex?: KnexType,
): Promise<KpiRow[]> {
  const db = getDb(knex);
  const table = params.grain === 'daily' ? 'kpi_daily' : 'kpi_monthly';

  const fromStr = formatDate(params.from);
  const toStr = formatDate(params.to);

  let q = db(table)
    .select('grain_date', 'office_id', 'agent_id', 'metric', 'value')
    .whereBetween('grain_date', [fromStr, toStr]);

  if (params.officeId !== undefined) {
    q = q.where('office_id', params.officeId);
  }
  if (params.agentId !== undefined) {
    q = q.where('agent_id', params.agentId);
  }
  if (params.metrics && params.metrics.length > 0) {
    q = q.whereIn('metric', params.metrics);
  }

  const rows = (await q.orderBy('grain_date', 'asc')) as Array<{
    grain_date: string | Date;
    office_id: number | null;
    agent_id: number | null;
    metric: string;
    value: number | string;
  }>;

  return rows.map((r) => ({
    grain_date: typeof r.grain_date === 'string' ? r.grain_date : formatDate(new Date(r.grain_date as Date)),
    office_id: r.office_id !== undefined ? r.office_id : null,
    agent_id: r.agent_id !== undefined ? r.agent_id : null,
    metric: r.metric as KpiMetric,
    value: Number(r.value),
  }));
}

export async function getFunnelData(
  params: {
    from: Date;
    to: Date;
    officeId?: number;
    agentId?: number;
  },
  knex?: KnexType,
): Promise<FunnelData> {
  const db = getDb(knex);
  const fromStr = formatDate(params.from);
  const toStr = formatDate(params.to);

  const metrics: KpiMetric[] = ['funnel_draft', 'funnel_approved', 'funnel_published'];

  let q = db('kpi_daily')
    .select('metric')
    .whereBetween('grain_date', [fromStr, toStr])
    .whereIn('metric', metrics);

  if (params.agentId !== undefined) {
    q = q.where('agent_id', params.agentId);
  } else {
    q = q.whereNull('agent_id');
  }

  if (params.officeId !== undefined) {
    q = q.where('office_id', params.officeId);
  } else {
    if (params.agentId === undefined) {
      q = q.whereNull('office_id');
    }
  }

  q = q.groupBy('metric').sum('value as total');

  const rows = (await q) as Array<{ metric: string; total: number | string }>;

  let draft = 0;
  let approved = 0;
  let published = 0;

  for (const r of rows) {
    const val = Number(r.total);
    if (r.metric === 'funnel_draft') draft = val;
    else if (r.metric === 'funnel_approved') approved = val;
    else if (r.metric === 'funnel_published') published = val;
  }

  const approvalRate = draft > 0 ? approved / draft : 0;
  const publishRate = approved > 0 ? published / approved : 0;

  return { draft, approved, published, approvalRate, publishRate };
}
