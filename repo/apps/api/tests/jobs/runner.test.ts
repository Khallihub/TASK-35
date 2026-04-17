/**
 * Unit coverage for the job scheduler's idempotent `runJob` helper and for
 * the `startScheduler` / `stopScheduler` lifecycle. Exercises the success,
 * skip-if-running, and failed paths against the in-memory SQLite test db.
 */
import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import { runJob, startScheduler, stopScheduler, JOBS } from '../../src/jobs/runner';

let testKnex: KnexType;

beforeAll(async () => {
  testKnex = createTestKnex();
  await runTestMigrations(testKnex);
  setDefaultKnex(testKnex);
});

afterAll(async () => {
  resetDefaultKnex();
  await dropTestTables(testKnex);
  await testKnex.destroy();
});

beforeEach(async () => {
  await testKnex('job_runs').delete();
});

describe('runJob', () => {
  it('records a completed run with records_processed', async () => {
    const handler = jest.fn().mockResolvedValue({ records: 42 });
    await runJob('test.completed_job', handler, testKnex);
    expect(handler).toHaveBeenCalledTimes(1);

    const row = await testKnex('job_runs').where({ job_name: 'test.completed_job' }).first();
    expect(row.status).toBe('completed');
    expect(row.records_processed).toBe(42);
    expect(row.finished_at).not.toBeNull();
    expect(row.error_detail).toBeNull();
  });

  it('records zero when handler returns no records field', async () => {
    const handler = jest.fn().mockResolvedValue({});
    await runJob('test.zero_records', handler, testKnex);
    const row = await testKnex('job_runs').where({ job_name: 'test.zero_records' }).first();
    expect(row.records_processed).toBe(0);
  });

  it('records a failed run with error_detail on handler error', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    await runJob('test.failing_job', handler, testKnex);
    const row = await testKnex('job_runs').where({ job_name: 'test.failing_job' }).first();
    expect(row.status).toBe('failed');
    expect(row.error_detail).toBe('boom');
  });

  it('serialises non-Error rejections via String()', async () => {
    const handler = jest.fn().mockRejectedValue('weird');
    await runJob('test.string_reject', handler, testKnex);
    const row = await testKnex('job_runs').where({ job_name: 'test.string_reject' }).first();
    expect(row.status).toBe('failed');
    expect(row.error_detail).toBe('weird');
  });

  it('skips if another run is already in progress within the last hour', async () => {
    const now = new Date();
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    const nowStr =
      `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ` +
      `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}.` +
      `${pad(now.getUTCMilliseconds(), 3)}`;
    await testKnex('job_runs').insert({
      job_name: 'test.locked_job',
      status: 'running',
      started_at: nowStr,
      records_processed: 0,
    });

    const handler = jest.fn().mockResolvedValue({ records: 1 });
    await runJob('test.locked_job', handler, testKnex);

    // Handler NOT invoked because the concurrent run guard short-circuited.
    expect(handler).not.toHaveBeenCalled();

    // No additional row was created.
    const count = await testKnex('job_runs').where({ job_name: 'test.locked_job' }).count<{ n: number }[]>('id as n');
    expect(Number(count[0].n)).toBe(1);
  });

  it('exposes the canonical JOBS name map', () => {
    expect(JOBS.KPI_DAILY_ROLLUP).toBe('kpi.rollup_daily');
    expect(JOBS.RETENTION_LISTINGS).toBe('retention.listings_purge');
    expect(JOBS.AUDIT_VERIFY_CHAIN).toBe('audit.verify_chain');
    expect(JOBS.EXPORT_PROCESS).toBe('export.process');
  });
});

describe('startScheduler / stopScheduler', () => {
  it('returns a Timeout that can be cleared via stopScheduler', () => {
    const handle = startScheduler(testKnex);
    // Node timers have .ref/.unref available — make sure it's a real timer.
    expect(typeof (handle as unknown as { ref?: () => void }).ref).toBe('function');
    stopScheduler(handle);
  });
});
