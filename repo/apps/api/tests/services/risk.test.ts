import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import {
  getOrCreateProfile,
  applyPenalty,
  applyDecay,
  checkBlacklist,
  addBlacklist,
  removeBlacklist,
  listRiskEvents,
} from '../../src/services/risk';
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
  await testKnex('sessions').delete();
  await testKnex('risk_events').delete();
  await testKnex('risk_profiles').delete();
  await testKnex('blacklist_entries').delete();
  await testKnex('users').delete();
  await testKnex('audit_log').delete();
});

async function createUser(username: string): Promise<number> {
  const now = new Date('2024-01-01T00:00:00Z');
  const [id] = await testKnex('users').insert({
    username,
    password_hash: 'hash',
    role: 'regular_user',
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: formatDatetime(now),
    updated_at: formatDatetime(now),
  });
  return id;
}

describe('getOrCreateProfile', () => {
  it('creates a profile with score=100 for new user', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const userId = await createUser('riskuser1');

    const profile = await getOrCreateProfile(userId, testKnex, clock);

    expect(profile.user_id).toBe(userId);
    expect(profile.credit_score).toBe(100);
    expect(profile.last_decay_at).toBeNull();
  });

  it('returns existing profile', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const userId = await createUser('riskuser2');

    const profile1 = await getOrCreateProfile(userId, testKnex, clock);
    const profile2 = await getOrCreateProfile(userId, testKnex, clock);

    expect(profile1.id).toBe(profile2.id);
  });
});

describe('applyPenalty', () => {
  it('reduces score and creates risk_event', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const userId = await createUser('riskuser3');
    await getOrCreateProfile(userId, testKnex, clock);

    const profile = await applyPenalty(userId, 'policy_violation', { reason: 'test' }, testKnex, clock);

    expect(profile.credit_score).toBe(90); // 100 - 10

    const events = await listRiskEvents(userId, 10, testKnex);
    expect(events.length).toBeGreaterThan(0);
    const penaltyEvent = events.find(e => e.event_type === 'policy_violation');
    expect(penaltyEvent).toBeDefined();
    expect(penaltyEvent!.delta).toBe(-10);
    expect(penaltyEvent!.new_score).toBe(90);
  });

  it('sets must_change_password when score drops below 60', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const userId = await createUser('riskuser4');

    // Set score to 65
    await getOrCreateProfile(userId, testKnex, clock);
    await testKnex('risk_profiles').where({ user_id: userId }).update({ credit_score: 65 });

    // Apply penalty to drop below 60
    await applyPenalty(userId, 'policy_violation', {}, testKnex, clock); // -10, so 55

    const user = await testKnex('users').where({ id: userId }).first();
    expect(user.must_change_password).toBe(1);
  });

  it('locks account 24h when score drops below 40', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const userId = await createUser('riskuser5');

    await getOrCreateProfile(userId, testKnex, clock);
    await testKnex('risk_profiles').where({ user_id: userId }).update({ credit_score: 45 });

    // Apply penalty to drop below 40
    await applyPenalty(userId, 'policy_violation', {}, testKnex, clock); // -10, so 35

    const user = await testKnex('users').where({ id: userId }).first();
    expect(user.status).toBe('locked');
    expect(user.locked_until).toBeDefined();
  });

  it('disables account when score drops below 20', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const userId = await createUser('riskuser6');

    await getOrCreateProfile(userId, testKnex, clock);
    await testKnex('risk_profiles').where({ user_id: userId }).update({ credit_score: 25 });

    // Apply penalty to drop below 20
    await applyPenalty(userId, 'policy_violation', {}, testKnex, clock); // -10, so 15

    const user = await testKnex('users').where({ id: userId }).first();
    expect(user.status).toBe('disabled');
  });

  it('clamps score to 0 minimum', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const userId = await createUser('riskuser7');

    await getOrCreateProfile(userId, testKnex, clock);
    await testKnex('risk_profiles').where({ user_id: userId }).update({ credit_score: 3 });

    const profile = await applyPenalty(userId, 'policy_violation', {}, testKnex, clock); // -10, clamp to 0

    expect(profile.credit_score).toBe(0);
  });
});

describe('applyDecay', () => {
  it('increases score by 1 per 7 days', async () => {
    const startClock = new TestClock(new Date('2024-01-01T00:00:00Z'));
    const userId = await createUser('riskuser8');

    await getOrCreateProfile(userId, testKnex, startClock);
    await testKnex('risk_profiles').where({ user_id: userId }).update({
      credit_score: 80,
      last_decay_at: formatDatetime(new Date('2024-01-01T00:00:00Z')),
    });

    // Advance 14 days (2 increments)
    const laterClock = new TestClock(new Date('2024-01-15T00:00:00Z'));
    const profile = await applyDecay(userId, testKnex, laterClock);

    expect(profile.credit_score).toBe(82); // 80 + 2
  });

  it('caps score at 100', async () => {
    const startClock = new TestClock(new Date('2024-01-01T00:00:00Z'));
    const userId = await createUser('riskuser9');

    await getOrCreateProfile(userId, testKnex, startClock);
    await testKnex('risk_profiles').where({ user_id: userId }).update({
      credit_score: 99,
      last_decay_at: formatDatetime(new Date('2024-01-01T00:00:00Z')),
    });

    // Advance 14 days (would be +2, but capped at 100)
    const laterClock = new TestClock(new Date('2024-01-15T00:00:00Z'));
    const profile = await applyDecay(userId, testKnex, laterClock);

    expect(profile.credit_score).toBe(100);
  });
});

describe('threshold session revocation', () => {
  it('revokes all sessions when score drops below 20 (disabled)', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const userId = await createUser('riskrevoke1');

    // Insert a fake active session
    await testKnex('sessions').insert({
      jti: 'session-risk-disabled',
      user_id: String(userId),
      issued_at: formatDatetime(clock.now()),
      last_activity_at: formatDatetime(clock.now()),
      expires_at: formatDatetime(new Date('2025-01-15T12:00:00Z')),
    });

    await getOrCreateProfile(userId, testKnex, clock);
    await testKnex('risk_profiles').where({ user_id: userId }).update({ credit_score: 25 });

    await applyPenalty(userId, 'policy_violation', {}, testKnex, clock); // -10 → 15, disabled

    const user = await testKnex('users').where({ id: userId }).first();
    expect(user.status).toBe('disabled');

    // All sessions should be revoked
    const session = await testKnex('sessions').where({ jti: 'session-risk-disabled' }).first();
    expect(session.revoked_at).toBeTruthy();
  });

  it('revokes all sessions when score drops below 40 (locked)', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const userId = await createUser('riskrevoke2');

    // Insert a fake active session
    await testKnex('sessions').insert({
      jti: 'session-risk-locked',
      user_id: String(userId),
      issued_at: formatDatetime(clock.now()),
      last_activity_at: formatDatetime(clock.now()),
      expires_at: formatDatetime(new Date('2025-01-15T12:00:00Z')),
    });

    await getOrCreateProfile(userId, testKnex, clock);
    await testKnex('risk_profiles').where({ user_id: userId }).update({ credit_score: 45 });

    await applyPenalty(userId, 'policy_violation', {}, testKnex, clock); // -10 → 35, locked

    const user = await testKnex('users').where({ id: userId }).first();
    expect(user.status).toBe('locked');

    // All sessions should be revoked
    const session = await testKnex('sessions').where({ jti: 'session-risk-locked' }).first();
    expect(session.revoked_at).toBeTruthy();
  });
});

describe('checkBlacklist', () => {
  it('returns true for active entry (no expiry)', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));

    await addBlacklist({
      subjectType: 'user',
      subjectValue: '123',
      reason: 'test',
    }, testKnex, clock);

    const result = await checkBlacklist('user', '123', testKnex, clock);
    expect(result).toBe(true);
  });

  it('returns false for expired entry', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const pastDate = new Date('2024-01-10T00:00:00Z');

    await addBlacklist({
      subjectType: 'user',
      subjectValue: '456',
      reason: 'test',
      expiresAt: pastDate,
    }, testKnex, clock);

    const result = await checkBlacklist('user', '456', testKnex, clock);
    expect(result).toBe(false);
  });

  it('returns false for non-existent entry', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));
    const result = await checkBlacklist('user', 'nonexistent', testKnex, clock);
    expect(result).toBe(false);
  });
});

describe('addBlacklist + removeBlacklist', () => {
  it('adds and removes blacklist entry', async () => {
    const clock = new TestClock(new Date('2024-01-15T12:00:00Z'));

    const entry = await addBlacklist({
      subjectType: 'ip',
      subjectValue: '192.168.1.1',
      reason: 'suspicious',
    }, testKnex, clock);

    expect(entry.subject_type).toBe('ip');
    expect(entry.subject_value).toBe('192.168.1.1');

    await removeBlacklist(entry.id, { id: 1, role: 'administrator' }, testKnex, clock);

    const afterRemove = await checkBlacklist('ip', '192.168.1.1', testKnex, clock);
    expect(afterRemove).toBe(false);
  });
});
