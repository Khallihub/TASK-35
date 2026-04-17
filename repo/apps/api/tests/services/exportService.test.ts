import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import {
  createExportJob,
  runExportJob,
  getExportJob,
  downloadExport,
  expireOldExports,
  ExportParams,
} from '../../src/services/exportService';
import { InMemoryRepository } from '../../src/storage/repository';
import { TestClock } from '../../src/clock';

let testKnex: KnexType;

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

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
  await testKnex('export_jobs').delete();
  await testKnex('kpi_daily').delete();
});

async function createTestUser(): Promise<number> {
  const now = new Date('2024-01-01T00:00:00Z');
  const [id] = await testKnex('users').insert({
    username: `exportuser_${Date.now()}`,
    password_hash: 'hash',
    role: 'operations',
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: formatDatetime(now),
    updated_at: formatDatetime(now),
  });
  return id;
}

describe('createExportJob', () => {
  it('inserts a queued export job', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const userId = await createTestUser();
    const params: ExportParams = {
      grain: 'daily',
      from: '2024-01-01',
      to: '2024-01-14',
    };

    const job = await createExportJob(userId, params, testKnex, clock);

    expect(job.id).toBeDefined();
    expect(job.status).toBe('queued');
    expect(job.attempt_count).toBe(0);
    expect(job.requested_by).toBe(userId);
  });
});

describe('runExportJob', () => {
  it('completes job and writes CSV to storage', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const storage = new InMemoryRepository();
    const userId = await createTestUser();

    // Insert some KPI data
    await testKnex('kpi_daily').insert([
      { grain_date: '2024-01-10', office_id: null, agent_id: null, metric: 'new_users', value: 5 },
      { grain_date: '2024-01-11', office_id: null, agent_id: null, metric: 'new_users', value: 3 },
    ]);

    const params: ExportParams = {
      grain: 'daily',
      from: '2024-01-10',
      to: '2024-01-11',
    };

    const job = await createExportJob(userId, params, testKnex, clock);
    await runExportJob(job.id, storage, testKnex, clock);

    const updatedJob = await testKnex('export_jobs').where({ id: job.id }).first();
    expect(updatedJob.status).toBe('completed');
    expect(updatedJob.file_key).toBeDefined();
    expect(updatedJob.sha256).toBeDefined();
    expect(Number(updatedJob.bytes)).toBeGreaterThan(0);

    // Verify file was written to storage
    const exists = await storage.exists(updatedJob.file_key);
    expect(exists).toBe(true);

    // Verify CSV content
    const buffer = await storage.read(updatedJob.file_key);
    const content = buffer.toString('utf8');
    expect(content).toContain('grain_date,office_id,agent_id,metric,value');
    expect(content).toContain('new_users');
  });

  it('is idempotent for non-queued jobs', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const storage = new InMemoryRepository();
    const userId = await createTestUser();

    const params: ExportParams = {
      grain: 'daily',
      from: '2024-01-10',
      to: '2024-01-11',
    };

    const job = await createExportJob(userId, params, testKnex, clock);
    await runExportJob(job.id, storage, testKnex, clock);

    // Set to completed status
    const completed = await testKnex('export_jobs').where({ id: job.id }).first();
    expect(completed.status).toBe('completed');

    // Run again - should be idempotent
    await runExportJob(job.id, storage, testKnex, clock);

    const stillCompleted = await testKnex('export_jobs').where({ id: job.id }).first();
    expect(stillCompleted.status).toBe('completed');
    expect(Number(stillCompleted.attempt_count)).toBe(1); // attempt_count should not increase
  });

  it('requeues job on failure with attempt_count < 3', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const userId = await createTestUser();

    // Storage that throws errors
    const failingStorage = {
      write: async () => { throw new Error('Storage failure'); },
      read: async () => Buffer.from(''),
      delete: async () => {},
      exists: async () => false,
      list: async () => [],
    };

    const params: ExportParams = {
      grain: 'daily',
      from: '2024-01-10',
      to: '2024-01-11',
    };

    const job = await createExportJob(userId, params, testKnex, clock);
    await runExportJob(job.id, failingStorage, testKnex, clock);

    const updatedJob = await testKnex('export_jobs').where({ id: job.id }).first();
    expect(updatedJob.status).toBe('queued'); // requeued
    expect(Number(updatedJob.attempt_count)).toBe(1);
    expect(updatedJob.last_error).toContain('Storage failure');
  });

  it('marks job as failed after 3 attempts', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const userId = await createTestUser();

    const failingStorage = {
      write: async () => { throw new Error('Persistent failure'); },
      read: async () => Buffer.from(''),
      delete: async () => {},
      exists: async () => false,
      list: async () => [],
    };

    const params: ExportParams = {
      grain: 'daily',
      from: '2024-01-10',
      to: '2024-01-11',
    };

    const job = await createExportJob(userId, params, testKnex, clock);
    // Set attempt_count to 2 so next attempt (3rd) triggers terminal failure
    await testKnex('export_jobs').where({ id: job.id }).update({ attempt_count: 2 });

    await runExportJob(job.id, failingStorage, testKnex, clock);

    const updatedJob = await testKnex('export_jobs').where({ id: job.id }).first();
    expect(updatedJob.status).toBe('failed'); // terminal
    expect(Number(updatedJob.attempt_count)).toBe(3);
  });
});

describe('downloadExport', () => {
  it('returns buffer and sha256 for completed job', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const storage = new InMemoryRepository();
    const userId = await createTestUser();

    const params: ExportParams = {
      grain: 'daily',
      from: '2024-01-10',
      to: '2024-01-11',
    };

    const job = await createExportJob(userId, params, testKnex, clock);
    await runExportJob(job.id, storage, testKnex, clock);

    const result = await downloadExport(job.id, userId, 'operations', storage, testKnex, clock);

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.sha256).toBeDefined();
    expect(result.filename).toMatch(/\.csv$/);
  });
});

describe('expireOldExports', () => {
  it('marks expired jobs and does not affect active ones', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const storage = new InMemoryRepository();
    const userId = await createTestUser();

    // Create a job that should expire
    const now = new Date('2024-01-15T12:00:00Z');
    const past = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000); // 8 days ago

    await testKnex('export_jobs').insert({
      requested_by: userId,
      params_json: JSON.stringify({ grain: 'daily', from: '2024-01-01', to: '2024-01-01' }),
      status: 'completed',
      attempt_count: 1,
      requested_at: formatDatetime(past),
      expires_at: formatDatetime(new Date(past.getTime() + 7 * 24 * 60 * 60 * 1000)),
    });

    // Create a job that should NOT expire
    const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [activeJobId] = await testKnex('export_jobs').insert({
      requested_by: userId,
      params_json: JSON.stringify({ grain: 'daily', from: '2024-01-01', to: '2024-01-01' }),
      status: 'queued',
      attempt_count: 0,
      requested_at: formatDatetime(now),
      expires_at: formatDatetime(future),
    });

    const result = await expireOldExports(storage, testKnex, clock);
    expect(result.expired).toBeGreaterThanOrEqual(1);

    // Active job should not be expired
    const activeJob = await testKnex('export_jobs').where({ id: activeJobId }).first();
    expect(activeJob.status).toBe('queued');
  });
});
