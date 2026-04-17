import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { recordFailedLogin, recordSuccessfulLogin, checkLockout } from '../../src/services/lockout';
import { TestClock } from '../../src/clock';
import { Knex as KnexType } from 'knex';

async function createTestUser(knex: KnexType, status = 'active'): Promise<bigint> {
  const now = new Date();
  const [id] = await knex('users').insert({
    username: `lockdepth_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    password_hash: '$2b$12$placeholder',
    role: 'regular_user',
    status,
    failed_login_count: 0,
    must_change_password: 0,
    created_at: now,
    updated_at: now,
  });
  return BigInt(id);
}

describe('lockout depth coverage', () => {
  let knex: KnexType;
  let clock: TestClock;

  beforeEach(async () => {
    knex = createTestKnex();
    await runTestMigrations(knex);
    clock = new TestClock(new Date('2024-06-01T12:00:00.000Z'));
  });

  afterEach(async () => {
    await dropTestTables(knex);
    await knex.destroy();
  });

  it('honours settings-backed lockout thresholds', async () => {
    // Tight policy: lock after 3 attempts within 1 minute for 5 minutes
    await knex('settings').insert([
      { key: 'security.lockout_attempts', value: '3' },
      { key: 'security.lockout_window_minutes', value: '1' },
      { key: 'security.lockout_duration_minutes', value: '5' },
    ]);
    const userId = await createTestUser(knex);

    let lastResult = { locked: false } as { locked: boolean; lockedUntil?: Date };
    for (let i = 0; i < 3; i++) {
      lastResult = await recordFailedLogin(userId, knex, clock);
    }
    expect(lastResult.locked).toBe(true);

    const user = await knex('users').where({ id: Number(userId) }).first();
    expect(user.status).toBe('locked');
    expect(user.locked_until).not.toBeNull();
  });

  it('ignores non-numeric settings values silently', async () => {
    await knex('settings').insert([
      { key: 'security.lockout_attempts', value: 'not-a-number' },
    ]);
    const userId = await createTestUser(knex);

    // Default threshold is 10 — 9 failures should not lock even with bogus config
    let lastResult = { locked: false } as { locked: boolean; lockedUntil?: Date };
    for (let i = 0; i < 9; i++) {
      lastResult = await recordFailedLogin(userId, knex, clock);
    }
    expect(lastResult.locked).toBe(false);
  });

  it('recordFailedLogin is a no-op for missing users', async () => {
    const result = await recordFailedLogin(BigInt(999999), knex, clock);
    expect(result.locked).toBe(false);
  });

  it('recordSuccessfulLogin is a no-op for missing users', async () => {
    await expect(recordSuccessfulLogin(BigInt(999999), knex, clock)).resolves.toBeUndefined();
  });

  it('recordSuccessfulLogin clears a timed lock whose window has expired', async () => {
    const userId = await createTestUser(knex, 'locked');
    const past = new Date(clock.now().getTime() - 60 * 1000);
    await knex('users').where({ id: Number(userId) }).update({ locked_until: past });

    await recordSuccessfulLogin(userId, knex, clock);

    const row = await knex('users').where({ id: Number(userId) }).first();
    expect(row.status).toBe('active');
    expect(row.locked_until).toBeNull();
    expect(row.failed_login_count).toBe(0);
  });

  it('recordSuccessfulLogin leaves a permanent admin lock (null locked_until) intact', async () => {
    const userId = await createTestUser(knex, 'locked');
    await knex('users').where({ id: Number(userId) }).update({ locked_until: null });

    await recordSuccessfulLogin(userId, knex, clock);

    const row = await knex('users').where({ id: Number(userId) }).first();
    expect(row.status).toBe('locked');
    expect(row.locked_until).toBeNull();
  });

  it('checkLockout blocks permanently on locked status with null locked_until', async () => {
    const userId = await createTestUser(knex, 'locked');
    await knex('users').where({ id: Number(userId) }).update({ locked_until: null });
    const result = await checkLockout(userId, knex, clock);
    expect(result.blocked).toBe(true);
    expect(result.until).toBeUndefined();
  });

  it('checkLockout returns unblocked and clears a lapsed lock', async () => {
    const userId = await createTestUser(knex, 'locked');
    const past = new Date(clock.now().getTime() - 60 * 1000);
    await knex('users').where({ id: Number(userId) }).update({ locked_until: past });

    const result = await checkLockout(userId, knex, clock);
    expect(result.blocked).toBe(false);

    const row = await knex('users').where({ id: Number(userId) }).first();
    expect(row.status).toBe('active');
    expect(row.locked_until).toBeNull();
  });

  it('checkLockout is a no-op for missing users', async () => {
    const r = await checkLockout(BigInt(999999), knex, clock);
    expect(r.blocked).toBe(false);
  });
});
