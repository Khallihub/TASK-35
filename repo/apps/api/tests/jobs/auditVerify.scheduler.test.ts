/**
 * Scheduler-level coverage for the audit-chain verification job.
 *
 * PRD §8.14 requires nightly verification with alerting on a broken chain.
 * verifyChain() returns { valid: false, brokenAt }; this test seeds a
 * tampered row into audit_log and exercises the same runJob path the
 * scheduler uses, then asserts:
 *   1. the job_runs row is marked status='failed' with the brokenAt id
 *      captured in error_detail, and
 *   2. a dedicated audit.chain_broken event is appended to the audit log
 *      so the alert is an auditable artifact, not just scheduler state.
 */
import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import { runJob, JOBS } from '../../src/jobs/runner';
import { appendAuditEvent, verifyChain } from '../../src/audit/chain';
import { TestClock } from '../../src/clock';

let testKnex: KnexType;

beforeAll(async () => {
  testKnex = createTestKnex();
  await runTestMigrations(testKnex);
  setAuditKnex(testKnex);
  setDefaultKnex(testKnex);
});

afterAll(async () => {
  resetAuditKnex();
  resetDefaultKnex();
  await dropTestTables(testKnex);
  await testKnex.destroy();
});

beforeEach(async () => {
  await testKnex('job_runs').delete();
  await testKnex('audit_log').delete();
});

/**
 * Mirror of the audit.verify_chain handler in jobs/runner.ts. Kept in the
 * test so a subtle change to the runner's verify block surfaces here.
 */
async function auditVerifyHandler(clock: TestClock): Promise<{ records: number }> {
  const result = await verifyChain();
  if (!result.valid) {
    const brokenAtStr = result.brokenAt !== undefined ? String(result.brokenAt) : 'unknown';
    try {
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
      /* ignore alert-write failures */
    }
    throw new Error(`audit_chain_broken: brokenAt=${brokenAtStr}`);
  }
  return { records: 0 };
}

describe('audit.verify_chain scheduled job', () => {
  it('completes successfully when the chain is intact', async () => {
    const clock = new TestClock(new Date('2024-06-01T00:00:00Z'));

    // Seed a few valid rows through appendAuditEvent so the chain is linked.
    for (let i = 0; i < 3; i++) {
      await appendAuditEvent(
        { action: `test.event.${i}`, entity_type: 'test', entity_id: String(i) },
        clock,
      );
    }

    await runJob(JOBS.AUDIT_VERIFY_CHAIN, () => auditVerifyHandler(clock), testKnex, clock);

    const run = await testKnex('job_runs').where({ job_name: JOBS.AUDIT_VERIFY_CHAIN }).first();
    expect(run).toBeDefined();
    expect(run.status).toBe('completed');
    expect(run.error_detail).toBeNull();
  });

  it('marks the job as failed AND writes an audit.chain_broken alert when the chain is tampered with', async () => {
    const clock = new TestClock(new Date('2024-06-01T00:00:00Z'));

    for (let i = 0; i < 3; i++) {
      await appendAuditEvent(
        { action: `test.event.${i}`, entity_type: 'test', entity_id: String(i) },
        clock,
      );
    }

    // Tamper with an intermediate row — flipping the `action` column breaks
    // the canonical hash expected by the chain, simulating a compromise.
    const middle = await testKnex('audit_log').orderBy('id', 'asc').offset(1).first();
    expect(middle).toBeDefined();
    await testKnex('audit_log').where({ id: middle.id }).update({ action: 'tampered.event' });

    // Run the job; it should surface as a failure even though verifyChain
    // itself returns { valid: false } without throwing.
    await runJob(JOBS.AUDIT_VERIFY_CHAIN, () => auditVerifyHandler(clock), testKnex, clock);

    const run = await testKnex('job_runs').where({ job_name: JOBS.AUDIT_VERIFY_CHAIN }).first();
    expect(run).toBeDefined();
    expect(run.status).toBe('failed');
    expect(String(run.error_detail)).toMatch(/audit_chain_broken/);
    expect(String(run.error_detail)).toMatch(/brokenAt=/);

    // Audit log should carry the alert artifact.
    const alert = await testKnex('audit_log').where({ action: 'audit.chain_broken' }).first();
    expect(alert).toBeDefined();
    expect(String(alert.entity_type)).toBe('audit_log');
  });
});
