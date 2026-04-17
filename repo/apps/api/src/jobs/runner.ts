import { Knex as KnexType } from 'knex';
import defaultKnex from '../db/knex';
import { Clock, systemClock } from '../clock';
import { rollupDailyKpi, rollupMonthlyKpi } from '../services/kpi';
import { expireOldExports, runExportJob } from '../services/exportService';
import { decayAllUsers } from '../services/risk';
import { verifyChain } from '../audit/chain';
import { storageRepository } from '../storage/repository';

export const JOBS = {
  KPI_DAILY_ROLLUP: 'kpi.rollup_daily',
  KPI_MONTHLY_ROLLUP: 'kpi.rollup_monthly',
  RETENTION_LISTINGS: 'retention.listings_purge',
  RETENTION_AUDIT: 'retention.audit_compact',
  RETENTION_EXPORTS: 'retention.exports_purge',
  AUDIT_VERIFY_CHAIN: 'audit.verify_chain',
  RISK_DECAY: 'risk.decay',
  ATTACHMENT_ORPHAN_SWEEP: 'attachments.orphan_sweep',
  SEARCH_REINDEX: 'search.reindex',
  EXPORT_PROCESS: 'export.process',
} as const;

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
 * Run a job with idempotency via job_runs table.
 */
export async function runJob(
  jobName: string,
  handler: () => Promise<{ records?: number }>,
  knex?: KnexType,
  clock: Clock = systemClock,
): Promise<void> {
  const db = getDb(knex);
  const now = clock.now();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneHourAgoStr = formatDatetime(oneHourAgo);

  // Check if already running (started within 1h)
  const running = await db('job_runs')
    .where({ job_name: jobName, status: 'running' })
    .where('started_at', '>', oneHourAgoStr)
    .first();

  if (running) {
    // Already running, skip
    return;
  }

  const nowStr = formatDatetime(now);
  const [runId] = await db('job_runs').insert({
    job_name: jobName,
    status: 'running',
    started_at: nowStr,
    records_processed: 0,
    error_detail: null,
  });

  try {
    const result = await handler();
    const finishedStr = formatDatetime(clock.now());

    await db('job_runs').where({ id: runId }).update({
      status: 'completed',
      finished_at: finishedStr,
      records_processed: result.records ?? 0,
    });
  } catch (err: unknown) {
    const errorDetail = err instanceof Error ? err.message : String(err);
    const finishedStr = formatDatetime(clock.now());

    await db('job_runs').where({ id: runId }).update({
      status: 'failed',
      finished_at: finishedStr,
      error_detail: errorDetail,
    });
  }
}

/**
 * Check if a job has completed successfully today.
 */
async function hasCompletedToday(jobName: string, now: Date, db: KnexType): Promise<boolean> {
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const todayStartStr = formatDatetime(todayStart);

  const result = await db('job_runs')
    .where({ job_name: jobName, status: 'completed' })
    .where('started_at', '>=', todayStartStr)
    .first();

  return !!result;
}

/**
 * Check if a job has completed successfully this month.
 */
async function hasCompletedThisMonth(jobName: string, now: Date, db: KnexType): Promise<boolean> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const monthStartStr = formatDatetime(monthStart);

  const result = await db('job_runs')
    .where({ job_name: jobName, status: 'completed' })
    .where('started_at', '>=', monthStartStr)
    .first();

  return !!result;
}

/**
 * Start the job scheduler. Returns the interval handle.
 */
export function startScheduler(knex?: KnexType, clock: Clock = systemClock): NodeJS.Timeout {
  const db = getDb(knex);

  const handle = setInterval(async () => {
    const now = clock.now();

    try {
      // kpi.rollup_daily: run if no successful run today
      if (!(await hasCompletedToday(JOBS.KPI_DAILY_ROLLUP, now, db))) {
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        await runJob(
          JOBS.KPI_DAILY_ROLLUP,
          async () => {
            const result = await rollupDailyKpi(yesterday, db, clock);
            return { records: result.inserted };
          },
          db,
          clock,
        );
      }

      // kpi.rollup_monthly: run if no successful run this month
      if (!(await hasCompletedThisMonth(JOBS.KPI_MONTHLY_ROLLUP, now, db))) {
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        await runJob(
          JOBS.KPI_MONTHLY_ROLLUP,
          async () => {
            const result = await rollupMonthlyKpi(monthStart, db, clock);
            return { records: result.inserted };
          },
          db,
          clock,
        );
      }

      // retention.listings_purge: run if no successful run today
      if (!(await hasCompletedToday(JOBS.RETENTION_LISTINGS, now, db))) {
        await runJob(
          JOBS.RETENTION_LISTINGS,
          async () => {
            // Import here to avoid circular dependency
            const { purgeListings } = await import('./retention');
            const result = await purgeListings(db, clock);
            return { records: result.deleted };
          },
          db,
          clock,
        );
      }

      // retention.audit_compact: run if no successful run today
      if (!(await hasCompletedToday(JOBS.RETENTION_AUDIT, now, db))) {
        await runJob(
          JOBS.RETENTION_AUDIT,
          async () => {
            const { compactAuditLog } = await import('./retention');
            const result = await compactAuditLog(db, clock);
            return { records: result.deleted };
          },
          db,
          clock,
        );
      }

      // retention.exports_purge: run if no successful run today
      if (!(await hasCompletedToday(JOBS.RETENTION_EXPORTS, now, db))) {
        await runJob(
          JOBS.RETENTION_EXPORTS,
          async () => {
            const { purgeExpiredExports } = await import('./retention');
            const result = await purgeExpiredExports(storageRepository, db, clock);
            return { records: result.expired };
          },
          db,
          clock,
        );
      }

      // audit.verify_chain: run if no successful run today
      //
      // PRD §8.14 requires nightly verification + alerting on a broken hash
      // chain. verifyChain() returns { valid: false, brokenAt } rather than
      // throwing, so we translate that into a failed job_run (error_detail
      // carries the brokenAt id) and a dedicated audit_log entry admins can
      // page on. The AdminView surfaces job_runs and the audit-chain status
      // endpoint already, so a broken chain becomes admin-visible.
      if (!(await hasCompletedToday(JOBS.AUDIT_VERIFY_CHAIN, now, db))) {
        await runJob(
          JOBS.AUDIT_VERIFY_CHAIN,
          async () => {
            const result = await verifyChain();
            if (!result.valid) {
              const brokenAtStr = result.brokenAt !== undefined ? String(result.brokenAt) : 'unknown';
              // Record an audit event so the chain break is itself an
              // auditable artifact, not just a transient scheduler state.
              try {
                const { appendAuditEvent } = await import('../audit/chain');
                await appendAuditEvent(
                  {
                    actor_id: null as unknown as number,
                    actor_role: 'system',
                    action: 'audit.chain_broken',
                    entity_type: 'audit_log',
                    entity_id: brokenAtStr,
                    after_json: { brokenAt: brokenAtStr },
                    ip: '127.0.0.1',
                  },
                  clock,
                );
              } catch {
                // Don't let alert-write failures mask the broken-chain signal.
              }
              // Surface to the scheduler as a failed job so runJob marks it
              // status=failed and writes the brokenAt into error_detail.
              throw new Error(`audit_chain_broken: brokenAt=${brokenAtStr}`);
            }
            return { records: 0 };
          },
          db,
          clock,
        );
      }

      // risk.decay: run if no successful run today
      if (!(await hasCompletedToday(JOBS.RISK_DECAY, now, db))) {
        await runJob(
          JOBS.RISK_DECAY,
          async () => {
            const result = await decayAllUsers(db, clock);
            return { records: result.processed };
          },
          db,
          clock,
        );
      }

      // attachments.orphan_sweep: run if no successful run today
      if (!(await hasCompletedToday(JOBS.ATTACHMENT_ORPHAN_SWEEP, now, db))) {
        await runJob(
          JOBS.ATTACHMENT_ORPHAN_SWEEP,
          async () => {
            const { sweepOrphanBlobs } = await import('../services/attachment');
            const result = await sweepOrphanBlobs(storageRepository, db, clock);
            return { records: result.deleted };
          },
          db,
          clock,
        );
      }

      // search.reindex: nightly FULLTEXT reindex maintenance
      if (!(await hasCompletedToday(JOBS.SEARCH_REINDEX, now, db))) {
        await runJob(
          JOBS.SEARCH_REINDEX,
          async () => {
            // Rebuild MySQL FULLTEXT index on listings (address_line, city, layout_normalized)
            // For MySQL, OPTIMIZE TABLE refreshes the FTS index. On SQLite this is a no-op.
            try {
              await db.raw('OPTIMIZE TABLE listings');
            } catch {
              // SQLite or non-MySQL: skip silently
            }
            return { records: 0 };
          },
          db,
          clock,
        );
      }

      // export.process: run queued export jobs (up to 5 per tick)
      // Respect next_attempt_at for backoff-scheduled retries
      const nowStr = formatDatetime(now);
      const queuedExports = await db('export_jobs')
        .where('status', 'queued')
        .where(function () {
          this.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', nowStr);
        })
        .orderBy('requested_at', 'asc')
        .limit(5)
        .select<Array<{ id: number }>>('id');

      for (const { id } of queuedExports) {
        const jobName = `${JOBS.EXPORT_PROCESS}:${id}`;
        await runJob(
          jobName,
          async () => {
            await runExportJob(id, storageRepository, db, clock);
            return { records: 1 };
          },
          db,
          clock,
        );
      }
    } catch (_err) {
      // Scheduler errors are non-fatal
    }
  }, 60 * 1000);

  return handle;
}

/**
 * Stop the scheduler.
 */
export function stopScheduler(handle: NodeJS.Timeout): void {
  clearInterval(handle);
}
