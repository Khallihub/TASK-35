import Router from 'koa-router';
import { AppError, ErrorCodes } from '../errors';
import { requireAuth, requireConsent, requireRole } from '../middleware/auth';
import { systemClock } from '../clock';
import defaultKnex from '../db/knex';
import { storageRepository } from '../storage/repository';
import { appendAuditEvent } from '../audit';
import {
  queryKpi,
  getFunnelData,
  rollupDailyKpi,
  KpiMetric,
} from '../services/kpi';
import {
  createExportJob,
  runExportJob,
  getExportJob,
  downloadExport,
  toPublicExportJob,
  ExportParams,
} from '../services/exportService';

const router = new Router({ prefix: '/api/v1/analytics' });

function getClientIp(ctx: Router.RouterContext): string {
  const forwarded = ctx.get('X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  return ctx.ip ?? 'unknown';
}

function isOpsOrAdmin(role: string): boolean {
  return ['operations', 'administrator'].includes(role);
}

/**
 * Analytics (KPI monitoring + CSV exports) is an Operations capability per
 * the product brief:
 *
 *   "Operations users get an analytics dashboard showing daily and monthly
 *    KPIs … with exports to CSV for a selected date range."
 *
 * Merchants and regular users do not have analytics access. Previously
 * merchants were allowed in with office-scoped results — that widened the
 * least-privilege boundary beyond what the prompt and PRD describe. The
 * gate below now matches the documented role model.
 */
function canAccessAnalytics(role: string): boolean {
  return isOpsOrAdmin(role);
}

/**
 * Materialize KPI rollup rows for every day in [from, to].
 * This ensures the kpi_daily table is up-to-date before querying.
 * Capped at 92 days (~3 months) to bound work per request.
 */
async function ensureRollup(from: Date, to: Date): Promise<void> {
  const MAX_DAYS = 92;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  let count = 0;
  while (cursor <= end && count < MAX_DAYS) {
    await rollupDailyKpi(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    count++;
  }
}

// GET /api/v1/analytics/kpi
router.get('/kpi', requireAuth(), requireConsent(), async (ctx) => {
  const user = ctx.state.user;
  const role = user.role;

  if (!canAccessAnalytics(role)) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Insufficient role', 403);
  }

  const q = ctx.query;
  // Accept both canonical (daily/monthly) and short (day/month) grain values
  const rawGrain = q.grain as string;
  const grainMap: Record<string, 'daily' | 'monthly'> = { day: 'daily', daily: 'daily', month: 'monthly', monthly: 'monthly' };
  const grain = grainMap[rawGrain];

  if (!grain) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'grain must be daily or monthly', 400);
  }

  const fromStr = q.from as string;
  const toStr = q.to as string;

  if (!fromStr || !toStr) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'from and to are required', 400);
  }

  const from = new Date(fromStr);
  const to = new Date(toStr);

  let officeId: number | undefined;
  if (q.officeId) {
    officeId = parseInt(q.officeId as string, 10);
  }

  // Only ops/admin reach this point (canAccessAnalytics gate above) — no
  // merchant-office forcing is needed.

  let agentId: number | undefined;
  if (q.agentId) {
    agentId = parseInt(q.agentId as string, 10);
  }

  let metrics: KpiMetric[] | undefined;
  if (q.metrics) {
    metrics = (q.metrics as string).split(',').map(m => m.trim()) as KpiMetric[];
  }

  await ensureRollup(from, to);

  const [rows, funnel] = await Promise.all([
    queryKpi({ grain, from, to, officeId, agentId, metrics }),
    getFunnelData({ from, to, officeId, agentId }),
  ]);

  ctx.status = 200;
  ctx.body = { ok: true, data: { rows, funnel } };
});

// GET /api/v1/analytics/funnel
router.get('/funnel', requireAuth(), requireConsent(), async (ctx) => {
  const user = ctx.state.user;
  const role = user.role;

  if (!canAccessAnalytics(role)) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Insufficient role', 403);
  }

  const q = ctx.query;
  const fromStr = q.from as string;
  const toStr = q.to as string;

  if (!fromStr || !toStr) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'from and to are required', 400);
  }

  const from = new Date(fromStr);
  const to = new Date(toStr);

  let officeId: number | undefined;
  if (q.officeId) {
    officeId = parseInt(q.officeId as string, 10);
  }

  // Only ops/admin reach this point (canAccessAnalytics gate above).

  await ensureRollup(from, to);

  const funnel = await getFunnelData({ from, to, officeId });

  ctx.status = 200;
  ctx.body = { ok: true, data: funnel };
});

// POST /api/v1/analytics/exports
router.post('/exports', requireAuth(), requireConsent(), async (ctx) => {
  const user = ctx.state.user;
  const role = user.role;

  if (!canAccessAnalytics(role)) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Insufficient role', 403);
  }

  const body = ctx.request.body as ExportParams;

  // Normalize grain: accept day/daily and month/monthly
  const exportGrainMap: Record<string, 'daily' | 'monthly'> = { day: 'daily', daily: 'daily', month: 'monthly', monthly: 'monthly' };
  const normalizedExportGrain = exportGrainMap[body.grain];
  if (!normalizedExportGrain) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'grain must be daily or monthly', 400);
  }
  body.grain = normalizedExportGrain;
  if (!body.from || !body.to) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'from and to are required', 400);
  }

  // Only ops/admin reach this point (canAccessAnalytics gate above); the
  // requested body.officeId flows through unchanged, allowing ops to scope
  // exports by office or leave it blank for a global export.

  // Export job creation + audit atomic in one transaction
  let job!: Awaited<ReturnType<typeof createExportJob>>;
  await defaultKnex.transaction(async (trx) => {
    job = await createExportJob(Number(user.id), body, trx, systemClock);

    await appendAuditEvent({
      actor_id: Number(user.id),
      actor_role: role,
      action: 'export.request',
      entity_type: 'export_job',
      entity_id: String(job.id),
      after_json: { grain: body.grain, from: body.from, to: body.to, officeId: body.officeId },
      ip: getClientIp(ctx),
    }, systemClock, trx);
  });

  ctx.status = 202;
  ctx.body = { ok: true, data: { jobId: job.id, status: 'queued' } };
});

// GET /api/v1/analytics/exports/:jobId
router.get('/exports/:jobId', requireAuth(), requireConsent(), async (ctx) => {
  const user = ctx.state.user;
  const jobId = parseInt(ctx.params.jobId, 10);

  if (isNaN(jobId)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid jobId', 400);
  }

  const job = await getExportJob(jobId, Number(user.id), user.role);

  let downloadUrl: string | undefined;
  if (job.status === 'completed') {
    downloadUrl = `/api/v1/analytics/exports/${jobId}/download`;
  }

  ctx.status = 200;
  // Public projection — file_key and sha256 are internal storage-layer
  // details; clients use the downloadUrl to fetch the file instead.
  ctx.body = { ok: true, data: { ...toPublicExportJob(job), downloadUrl } };
});

// GET /api/v1/analytics/exports/:jobId/download
router.get('/exports/:jobId/download', requireAuth(), requireConsent(), async (ctx) => {
  const user = ctx.state.user;
  const jobId = parseInt(ctx.params.jobId, 10);

  if (isNaN(jobId)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid jobId', 400);
  }

  const { buffer, filename, sha256 } = await downloadExport(
    jobId,
    Number(user.id),
    user.role,
    storageRepository,
    undefined,
    systemClock,
  );

  await appendAuditEvent({
    actor_id: Number(user.id),
    actor_role: user.role,
    action: 'export.download',
    entity_type: 'export_job',
    entity_id: String(jobId),
    after_json: { filename, sha256 },
    ip: getClientIp(ctx),
  }, systemClock);

  ctx.set('Content-Type', 'text/csv');
  ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
  ctx.set('X-SHA256', sha256);
  ctx.status = 200;
  ctx.body = buffer;
});

export default router;
