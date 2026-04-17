import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import {
  rollupDailyKpi,
  rollupMonthlyKpi,
  queryKpi,
  getFunnelData,
} from '../../src/services/kpi';
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
  // Clean up test data
  await testKnex('kpi_monthly').delete();
  await testKnex('kpi_daily').delete();
  await testKnex('event_log').delete();
  await testKnex('listing_status_history').delete();
  await testKnex('listing_revisions').delete();
  await testKnex('listings').delete();
  await testKnex('sessions').delete();
  await testKnex('users').delete();
  await testKnex('offices').delete();
});

async function createOffice(code: string, name: string): Promise<number> {
  const [id] = await testKnex('offices').insert({ name, code, active: 1 });
  return id;
}

async function createUser(officeId: number | null, username: string, createdAt: Date): Promise<number> {
  const [id] = await testKnex('users').insert({
    username,
    password_hash: 'hash',
    role: 'regular_user',
    office_id: officeId,
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: formatDatetime(createdAt),
    updated_at: formatDatetime(createdAt),
  });
  return id;
}

async function createListing(officeId: number, createdBy: number, createdAt: Date): Promise<number> {
  const [id] = await testKnex('listings').insert({
    office_id: officeId,
    created_by: createdBy,
    status: 'draft',
    version: 1,
    created_at: formatDatetime(createdAt),
    updated_at: formatDatetime(createdAt),
  });
  return id;
}

async function createStatusHistory(listingId: number, fromStatus: string | null, toStatus: string, actorId: number, createdAt: Date): Promise<void> {
  await testKnex('listing_status_history').insert({
    listing_id: listingId,
    from_status: fromStatus,
    to_status: toStatus,
    actor_id: actorId,
    created_at: formatDatetime(createdAt),
  });
}

async function createEventLog(userId: number | null, eventType: string, officeId: number | null, createdAt: Date): Promise<void> {
  await testKnex('event_log').insert({
    user_id: userId,
    event_type: eventType,
    office_id: officeId,
    created_at: formatDatetime(createdAt),
  });
}

describe('rollupDailyKpi', () => {
  it('inserts KPI rows for new_users metric', async () => {
    const targetDate = new Date('2024-01-15T12:00:00Z');
    const officeId = await createOffice('OFF1', 'Office 1');
    await createUser(officeId, 'user1', targetDate);
    await createUser(officeId, 'user2', targetDate);
    // User created on different date should not count
    await createUser(officeId, 'user3', new Date('2024-01-14T12:00:00Z'));

    const result = await rollupDailyKpi(targetDate, testKnex);
    expect(result.inserted).toBeGreaterThan(0);

    // Check global new_users
    const globalRow = await testKnex('kpi_daily')
      .where({ grain_date: '2024-01-15', metric: 'new_users' })
      .whereNull('office_id')
      .whereNull('agent_id')
      .first();
    expect(globalRow).toBeDefined();
    expect(Number(globalRow.value)).toBe(2);
  });

  it('inserts KPI rows for engagement_actions metric', async () => {
    const targetDate = new Date('2024-01-15T12:00:00Z');
    const officeId = await createOffice('OFF2', 'Office 2');
    const userId = await createUser(officeId, 'euser1', new Date('2024-01-01T00:00:00Z'));

    // Create engagement events
    await createEventLog(userId, 'listing.view', officeId, targetDate);
    await createEventLog(userId, 'listing.favorite', officeId, targetDate);
    await createEventLog(userId, 'listing.share', officeId, targetDate);
    await createEventLog(userId, 'promo.click', officeId, targetDate);
    // Non-engagement event
    await createEventLog(userId, 'user.login', officeId, targetDate);

    const result = await rollupDailyKpi(targetDate, testKnex);
    expect(result.inserted).toBeGreaterThan(0);

    const globalRow = await testKnex('kpi_daily')
      .where({ grain_date: '2024-01-15', metric: 'engagement_actions' })
      .whereNull('office_id')
      .whereNull('agent_id')
      .first();
    expect(globalRow).toBeDefined();
    expect(Number(globalRow.value)).toBe(4);
  });

  it('inserts funnel metrics for draft/approved/published transitions', async () => {
    const targetDate = new Date('2024-01-15T12:00:00Z');
    const officeId = await createOffice('OFF3', 'Office 3');
    const userId = await createUser(officeId, 'fuser1', new Date('2024-01-01T00:00:00Z'));

    const listing1 = await createListing(officeId, userId, targetDate);
    const listing2 = await createListing(officeId, userId, targetDate);

    // Draft transitions
    await createStatusHistory(listing1, null, 'draft', userId, targetDate);
    await createStatusHistory(listing2, null, 'draft', userId, targetDate);
    // Approved transitions
    await createStatusHistory(listing1, 'draft', 'approved', userId, targetDate);
    // Published transitions
    await createStatusHistory(listing1, 'approved', 'published', userId, targetDate);

    await rollupDailyKpi(targetDate, testKnex);

    const draftRow = await testKnex('kpi_daily')
      .where({ grain_date: '2024-01-15', metric: 'funnel_draft' })
      .whereNull('office_id')
      .whereNull('agent_id')
      .first();
    expect(Number(draftRow?.value ?? 0)).toBe(2);

    const approvedRow = await testKnex('kpi_daily')
      .where({ grain_date: '2024-01-15', metric: 'funnel_approved' })
      .whereNull('office_id')
      .whereNull('agent_id')
      .first();
    expect(Number(approvedRow?.value ?? 0)).toBe(1);

    const publishedRow = await testKnex('kpi_daily')
      .where({ grain_date: '2024-01-15', metric: 'funnel_published' })
      .whereNull('office_id')
      .whereNull('agent_id')
      .first();
    expect(Number(publishedRow?.value ?? 0)).toBe(1);
  });
});

describe('rollupDailyKpi active_users semantics', () => {
  async function createSession(userId: number, lastActivity: Date): Promise<void> {
    const issued = new Date(lastActivity.getTime() - 60_000);
    const expires = new Date(lastActivity.getTime() + 30 * 60_000);
    await testKnex('sessions').insert({
      jti: `jti_${userId}_${Math.random().toString(36).slice(2)}`,
      user_id: String(userId),
      ip: '127.0.0.1',
      device_fingerprint: 'fp',
      issued_at: formatDatetime(issued),
      last_activity_at: formatDatetime(lastActivity),
      expires_at: formatDatetime(expires),
      revoked_at: null,
      revoke_reason: null,
    });
  }

  it('counts users by last_activity_at, not issued_at — silent sessions are excluded', async () => {
    const targetDate = new Date('2024-01-15T12:00:00Z');
    const officeId = await createOffice('AOFF', 'Active Office');
    const userActive = await createUser(officeId, 'au_real', new Date('2024-01-01T00:00:00Z'));
    const userIssuedOnly = await createUser(officeId, 'au_silent', new Date('2024-01-01T00:00:00Z'));

    // Active user: session whose last_activity_at is on the target day
    await createSession(userActive, targetDate);
    // Silent user: session issued earlier but never touched within the day
    const issued = new Date(targetDate.getTime() - 30 * 60_000);
    const longAgoActivity = new Date('2024-01-10T00:00:00Z');
    await testKnex('sessions').insert({
      jti: `jti_silent_${Math.random().toString(36).slice(2)}`,
      user_id: String(userIssuedOnly),
      ip: '127.0.0.1',
      device_fingerprint: 'fp',
      issued_at: formatDatetime(issued),
      last_activity_at: formatDatetime(longAgoActivity),
      expires_at: formatDatetime(new Date(targetDate.getTime() + 30 * 60_000)),
      revoked_at: null,
      revoke_reason: null,
    });

    await rollupDailyKpi(targetDate, testKnex);

    const globalRow = await testKnex('kpi_daily')
      .where({ grain_date: '2024-01-15', metric: 'active_users' })
      .whereNull('office_id')
      .whereNull('agent_id')
      .first();
    expect(globalRow).toBeDefined();
    expect(Number(globalRow.value)).toBe(1);
  });

  it('counts a user only once per day even when they have multiple sessions', async () => {
    const targetDate = new Date('2024-01-15T12:00:00Z');
    const officeId = await createOffice('MOFF', 'Multi Office');
    const userId = await createUser(officeId, 'au_multi', new Date('2024-01-01T00:00:00Z'));

    await createSession(userId, targetDate);
    await createSession(userId, new Date(targetDate.getTime() + 60_000));
    await createSession(userId, new Date(targetDate.getTime() + 120_000));

    await rollupDailyKpi(targetDate, testKnex);

    const globalRow = await testKnex('kpi_daily')
      .where({ grain_date: '2024-01-15', metric: 'active_users' })
      .whereNull('office_id')
      .whereNull('agent_id')
      .first();
    expect(Number(globalRow.value)).toBe(1);
  });
});

describe('rollupMonthlyKpi', () => {
  it('aggregates daily rows into monthly', async () => {
    // Insert some daily KPI rows directly
    await testKnex('kpi_daily').insert([
      { grain_date: '2024-01-01', office_id: null, agent_id: null, metric: 'new_users', value: 5 },
      { grain_date: '2024-01-02', office_id: null, agent_id: null, metric: 'new_users', value: 3 },
      { grain_date: '2024-01-15', office_id: null, agent_id: null, metric: 'new_users', value: 7 },
      { grain_date: '2024-02-01', office_id: null, agent_id: null, metric: 'new_users', value: 10 },
    ]);

    const monthStart = new Date('2024-01-01T00:00:00Z');
    const result = await rollupMonthlyKpi(monthStart, testKnex);
    expect(result.inserted).toBeGreaterThan(0);

    const monthlyRow = await testKnex('kpi_monthly')
      .where({ grain_date: '2024-01-01', metric: 'new_users' })
      .whereNull('office_id')
      .whereNull('agent_id')
      .first();
    expect(monthlyRow).toBeDefined();
    expect(Number(monthlyRow.value)).toBe(15); // 5 + 3 + 7
  });

  it('does NOT sum daily active_users — uses distinct count over the month', async () => {
    const monthStart = new Date('2024-01-01T00:00:00Z');
    const officeId = await createOffice('MAFF', 'Monthly Active Office');
    const userA = await createUser(officeId, 'monthly_a', new Date('2023-12-01T00:00:00Z'));
    const userB = await createUser(officeId, 'monthly_b', new Date('2023-12-01T00:00:00Z'));

    // userA active on 5 different days; userB active on 1 day. Distinct count = 2.
    const days = ['2024-01-02', '2024-01-05', '2024-01-10', '2024-01-15', '2024-01-20'];
    for (const d of days) {
      const ts = new Date(`${d}T12:00:00Z`);
      await testKnex('sessions').insert({
        jti: `jti_${userA}_${d}`,
        user_id: String(userA),
        ip: '127.0.0.1',
        device_fingerprint: 'fp',
        issued_at: formatDatetime(ts),
        last_activity_at: formatDatetime(ts),
        expires_at: formatDatetime(new Date(ts.getTime() + 60_000)),
        revoked_at: null,
        revoke_reason: null,
      });
    }
    const tsB = new Date('2024-01-15T08:00:00Z');
    await testKnex('sessions').insert({
      jti: `jti_${userB}_b`,
      user_id: String(userB),
      ip: '127.0.0.1',
      device_fingerprint: 'fp',
      issued_at: formatDatetime(tsB),
      last_activity_at: formatDatetime(tsB),
      expires_at: formatDatetime(new Date(tsB.getTime() + 60_000)),
      revoked_at: null,
      revoke_reason: null,
    });

    // Pre-populate kpi_daily with sums that would WRONGLY total to 6 if monthly
    // simply summed daily values.
    await testKnex('kpi_daily').insert([
      { grain_date: '2024-01-02', office_id: null, agent_id: null, metric: 'active_users', value: 1 },
      { grain_date: '2024-01-05', office_id: null, agent_id: null, metric: 'active_users', value: 1 },
      { grain_date: '2024-01-10', office_id: null, agent_id: null, metric: 'active_users', value: 1 },
      { grain_date: '2024-01-15', office_id: null, agent_id: null, metric: 'active_users', value: 2 },
      { grain_date: '2024-01-20', office_id: null, agent_id: null, metric: 'active_users', value: 1 },
    ]);

    await rollupMonthlyKpi(monthStart, testKnex);

    const monthlyRow = await testKnex('kpi_monthly')
      .where({ grain_date: '2024-01-01', metric: 'active_users' })
      .whereNull('office_id')
      .whereNull('agent_id')
      .first();
    expect(monthlyRow).toBeDefined();
    expect(Number(monthlyRow.value)).toBe(2);
  });
});

describe('queryKpi', () => {
  it('returns filtered KPI rows', async () => {
    await testKnex('kpi_daily').insert([
      { grain_date: '2024-01-01', office_id: null, agent_id: null, metric: 'new_users', value: 5 },
      { grain_date: '2024-01-02', office_id: null, agent_id: null, metric: 'new_users', value: 3 },
      { grain_date: '2024-01-02', office_id: null, agent_id: null, metric: 'active_users', value: 10 },
      { grain_date: '2024-01-03', office_id: null, agent_id: null, metric: 'new_users', value: 1 },
    ]);

    const rows = await queryKpi({
      grain: 'daily',
      from: new Date('2024-01-01'),
      to: new Date('2024-01-02'),
      metrics: ['new_users'],
    }, testKnex);

    expect(rows.length).toBe(2);
    expect(rows.every(r => r.metric === 'new_users')).toBe(true);
  });

  it('returns all metrics when no filter specified', async () => {
    await testKnex('kpi_daily').insert([
      { grain_date: '2024-01-01', office_id: null, agent_id: null, metric: 'new_users', value: 5 },
      { grain_date: '2024-01-01', office_id: null, agent_id: null, metric: 'active_users', value: 10 },
    ]);

    const rows = await queryKpi({
      grain: 'daily',
      from: new Date('2024-01-01'),
      to: new Date('2024-01-01'),
    }, testKnex);

    expect(rows.length).toBe(2);
  });
});

describe('getFunnelData', () => {
  it('computes funnel rates correctly', async () => {
    await testKnex('kpi_daily').insert([
      { grain_date: '2024-01-01', office_id: null, agent_id: null, metric: 'funnel_draft', value: 10 },
      { grain_date: '2024-01-01', office_id: null, agent_id: null, metric: 'funnel_approved', value: 5 },
      { grain_date: '2024-01-01', office_id: null, agent_id: null, metric: 'funnel_published', value: 2 },
    ]);

    const data = await getFunnelData({ from: new Date('2024-01-01'), to: new Date('2024-01-01') }, testKnex);

    expect(data.draft).toBe(10);
    expect(data.approved).toBe(5);
    expect(data.published).toBe(2);
    expect(data.approvalRate).toBeCloseTo(0.5);
    expect(data.publishRate).toBeCloseTo(0.4);
  });

  it('handles zero division gracefully', async () => {
    const data = await getFunnelData({ from: new Date('2024-03-01'), to: new Date('2024-03-01') }, testKnex);

    expect(data.draft).toBe(0);
    expect(data.approved).toBe(0);
    expect(data.published).toBe(0);
    expect(data.approvalRate).toBe(0);
    expect(data.publishRate).toBe(0);
  });
});
