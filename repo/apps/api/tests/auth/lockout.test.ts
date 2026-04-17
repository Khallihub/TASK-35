import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { recordFailedLogin, recordSuccessfulLogin, checkLockout } from '../../src/services/lockout';
import { TestClock } from '../../src/clock';
import { Knex as KnexType } from 'knex';

async function createTestUser(knex: KnexType): Promise<bigint> {
  const now = new Date();
  const [id] = await knex('users').insert({
    username: 'lockoutuser',
    password_hash: '$2b$12$placeholder',
    role: 'regular_user',
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: now,
    updated_at: now,
  });
  return BigInt(id);
}

describe('lockout service', () => {
  let knex: KnexType;
  let userId: bigint;
  let clock: TestClock;

  beforeEach(async () => {
    knex = createTestKnex();
    await runTestMigrations(knex);
    userId = await createTestUser(knex);
    clock = new TestClock(new Date('2024-06-01T12:00:00.000Z'));
  });

  afterEach(async () => {
    await dropTestTables(knex);
    await knex.destroy();
  });

  it('9 failures do not lock the account', async () => {
    let result: { locked: boolean; lockedUntil?: Date } = { locked: false };
    for (let i = 0; i < 9; i++) {
      result = await recordFailedLogin(userId, knex, clock);
    }
    expect(result.locked).toBe(false);

    const user = await knex('users').where({ id: Number(userId) }).first();
    expect(user.failed_login_count).toBe(9);
    expect(user.status).toBe('active');
  });

  it('10th failure locks the account', async () => {
    for (let i = 0; i < 9; i++) {
      await recordFailedLogin(userId, knex, clock);
    }
    const result = await recordFailedLogin(userId, knex, clock);
    expect(result.locked).toBe(true);
    expect(result.lockedUntil).toBeDefined();

    const user = await knex('users').where({ id: Number(userId) }).first();
    expect(user.status).toBe('locked');
    expect(user.failed_login_count).toBe(10);
  });

  it('recordSuccessfulLogin resets failed count', async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailedLogin(userId, knex, clock);
    }
    await recordSuccessfulLogin(userId, knex, clock);

    const user = await knex('users').where({ id: Number(userId) }).first();
    expect(user.failed_login_count).toBe(0);
  });

  it('checkLockout after lock returns blocked=true', async () => {
    for (let i = 0; i < 10; i++) {
      await recordFailedLogin(userId, knex, clock);
    }

    const status = await checkLockout(userId, knex, clock);
    expect(status.blocked).toBe(true);
    expect(status.until).toBeDefined();
  });

  it('checkLockout returns blocked=false after lock expires', async () => {
    for (let i = 0; i < 10; i++) {
      await recordFailedLogin(userId, knex, clock);
    }

    // Advance past lockout duration (31 minutes)
    clock.advance(31 * 60 * 1000);

    const status = await checkLockout(userId, knex, clock);
    expect(status.blocked).toBe(false);
  });
});
