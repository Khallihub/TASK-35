import crypto from 'crypto';
import { Knex as KnexType } from 'knex';
import defaultKnex from '../db/knex';
import { Clock, systemClock } from '../clock';
import { StorageRepository } from '../storage/repository';
import { queryKpi, KpiMetric, KpiRow } from './kpi';
import { AppError, ErrorCodes } from '../errors';

export interface ExportParams {
  grain: 'daily' | 'monthly';
  from: string;   // ISO date 'YYYY-MM-DD'
  to: string;
  officeId?: number;
  agentId?: number;
  metrics?: KpiMetric[];
}

export interface ExportJob {
  id: number;
  requested_by: number;
  params_json: ExportParams | string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'expired';
  file_key: string | null;
  sha256: string | null;
  bytes: number | null;
  attempt_count: number;
  last_error: string | null;
  requested_at: string;
  completed_at: string | null;
  expires_at: string;
}

/**
 * Public (client-facing) projection of an export job. Internal storage
 * metadata (file_key, sha256) and operational counters (attempt_count,
 * last_error) are omitted — the UI only needs to know when the job is
 * complete, its size, and how to construct the download URL.
 */
export interface ExportJobPublic {
  id: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'expired';
  bytes: number | null;
  requested_at: string;
  completed_at: string | null;
  expires_at: string;
}

export function toPublicExportJob(job: ExportJob): ExportJobPublic {
  return {
    id: job.id,
    status: job.status,
    bytes: job.bytes,
    requested_at: job.requested_at,
    completed_at: job.completed_at,
    expires_at: job.expires_at,
  };
}

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

/**
 * RFC-4180 compliant CSV field quoting.
 */
function csvField(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Build CSV buffer from KPI rows.
 * UTF-8 BOM + header + data rows, CRLF line endings.
 */
function buildCsv(rows: KpiRow[]): Buffer {
  const BOM = '\uFEFF';
  const CRLF = '\r\n';
  const header = 'grain_date,office_id,agent_id,metric,value';
  const lines: string[] = [BOM + header];

  for (const row of rows) {
    const line = [
      csvField(row.grain_date),
      csvField(row.office_id),
      csvField(row.agent_id),
      csvField(row.metric),
      csvField(row.value),
    ].join(',');
    lines.push(line);
  }

  return Buffer.from(lines.join(CRLF) + CRLF, 'utf8');
}

/**
 * Create a new export job (queued).
 */
export async function createExportJob(
  requestedBy: number,
  params: ExportParams,
  knex?: KnexType,
  clock: Clock = systemClock,
): Promise<ExportJob> {
  const db = getDb(knex);
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [id] = await db('export_jobs').insert({
    requested_by: requestedBy,
    params_json: JSON.stringify(params),
    status: 'queued',
    file_key: null,
    sha256: null,
    bytes: null,
    attempt_count: 0,
    last_error: null,
    requested_at: formatDatetime(now),
    completed_at: null,
    expires_at: formatDatetime(expiresAt),
  });

  const job = await db('export_jobs').where({ id }).first<ExportJob>();
  return job!;
}

/**
 * Run an export job: query KPI data, build CSV, store it.
 */
export async function runExportJob(
  jobId: number,
  storage: StorageRepository,
  knex?: KnexType,
  clock: Clock = systemClock,
): Promise<void> {
  const db = getDb(knex);

  const job = await db('export_jobs').where({ id: jobId }).first<ExportJob>();
  if (!job) throw new AppError(ErrorCodes.NOT_FOUND, 'Export job not found', 404);

  // Idempotent: only run queued jobs
  if (job.status !== 'queued') return;

  const newAttemptCount = job.attempt_count + 1;

  // Mark as running
  await db('export_jobs').where({ id: jobId }).update({
    status: 'running',
    attempt_count: newAttemptCount,
  });

  try {
    const params: ExportParams = typeof job.params_json === 'string'
      ? JSON.parse(job.params_json)
      : job.params_json;

    // Query KPI data
    const rows = await queryKpi({
      grain: params.grain,
      from: new Date(params.from),
      to: new Date(params.to),
      officeId: params.officeId,
      agentId: params.agentId,
      metrics: params.metrics,
    }, db);

    // Build CSV
    const csvBuffer = buildCsv(rows);

    // Compute SHA-256
    const sha256 = crypto.createHash('sha256').update(csvBuffer).digest('hex');

    // Generate PRD-compliant storage key: kpi_{grain}_{from}_{to}_{office|all}.csv
    const officeSuffix = params.officeId ? String(params.officeId) : 'all';
    const storageKey = `exports/${jobId}/kpi_${params.grain}_${params.from}_${params.to}_${officeSuffix}.csv`;

    // Write to storage
    await storage.write(storageKey, csvBuffer);

    // Update job to completed
    const now = clock.now();
    await db('export_jobs').where({ id: jobId }).update({
      status: 'completed',
      file_key: storageKey,
      sha256,
      bytes: csvBuffer.length,
      completed_at: formatDatetime(now),
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (newAttemptCount < 3) {
      // Requeue for retry with exponential backoff: 30s, 2m, 10m
      const backoffMs = [30_000, 120_000, 600_000];
      const delay = backoffMs[newAttemptCount - 1] ?? 600_000;
      const nextAttemptAt = new Date(clock.now().getTime() + delay);
      await db('export_jobs').where({ id: jobId }).update({
        status: 'queued',
        last_error: errorMessage,
        next_attempt_at: formatDatetime(nextAttemptAt),
      });
    } else {
      // Terminal failure
      await db('export_jobs').where({ id: jobId }).update({
        status: 'failed',
        last_error: errorMessage,
      });
    }
  }
}

/**
 * Get an export job (own job or administrator).
 */
export async function getExportJob(
  jobId: number,
  requestedBy: number,
  role: string,
  knex?: KnexType,
): Promise<ExportJob> {
  const db = getDb(knex);

  const job = await db('export_jobs').where({ id: jobId }).first<ExportJob>();
  if (!job) throw new AppError(ErrorCodes.NOT_FOUND, 'Export job not found', 404);

  if (role !== 'administrator' && job.requested_by !== requestedBy) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
  }

  return job;
}

/**
 * Download an export: returns buffer + filename + sha256.
 */
export async function downloadExport(
  jobId: number,
  requestedBy: number,
  role: string,
  storage: StorageRepository,
  knex?: KnexType,
  clock: Clock = systemClock,
): Promise<{ buffer: Buffer; filename: string; sha256: string }> {
  const db = getDb(knex);
  const job = await getExportJob(jobId, requestedBy, role, db);

  if (job.status !== 'completed') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Export job is not completed', 400);
  }

  const now = clock.now();
  const expiresAt = new Date(job.expires_at);
  if (now > expiresAt) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Export has expired', 404);
  }

  if (!job.file_key || !job.sha256) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Export file not available', 500);
  }

  const buffer = await storage.read(job.file_key);
  const filename = job.file_key.split('/').pop() ?? `export_${jobId}.csv`;

  return { buffer, filename, sha256: job.sha256 };
}

/**
 * Expire old export jobs.
 */
export async function expireOldExports(
  storage: StorageRepository,
  knex?: KnexType,
  clock: Clock = systemClock,
): Promise<{ expired: number }> {
  const db = getDb(knex);
  const now = clock.now();
  const nowStr = formatDatetime(now);

  const expiredJobs = await db('export_jobs')
    .where('expires_at', '<', nowStr)
    .whereNot('status', 'expired');

  let expired = 0;
  for (const job of expiredJobs) {
    // Delete blob from storage if exists
    if (job.file_key) {
      try {
        await storage.delete(job.file_key);
      } catch {
        // Ignore errors
      }
    }

    await db('export_jobs').where({ id: job.id }).update({ status: 'expired' });
    expired++;
  }

  return { expired };
}
