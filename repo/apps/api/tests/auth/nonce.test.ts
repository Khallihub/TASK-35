import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { generateNonce, consumeNonce } from '../../src/services/nonce';
import { TestClock } from '../../src/clock';
import { AppError } from '../../src/errors';
import { Knex as KnexType } from 'knex';

describe('nonce service', () => {
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

  it('generateNonce returns a value that is 24 characters', async () => {
    const value = await generateNonce('change_password', null, knex, clock);
    expect(value).toHaveLength(24);
  });

  it('consumeNonce marks consumed_at', async () => {
    const value = await generateNonce('change_password', null, knex, clock);
    await consumeNonce(value, 'change_password', undefined, knex, clock);

    const row = await knex('nonces').where({ value }).first();
    expect(row.consumed_at).not.toBeNull();
  });

  it('consumeNonce throws if already consumed', async () => {
    const value = await generateNonce('change_password', null, knex, clock);
    await consumeNonce(value, 'change_password', undefined, knex, clock);

    await expect(consumeNonce(value, 'change_password', undefined, knex, clock))
      .rejects.toBeInstanceOf(AppError);
  });

  it('consumeNonce throws if expired', async () => {
    const value = await generateNonce('change_password', null, knex, clock);

    // Advance past TTL (5 minutes + 1 second)
    clock.advance(5 * 60 * 1000 + 1000);

    await expect(consumeNonce(value, 'change_password', undefined, knex, clock))
      .rejects.toBeInstanceOf(AppError);
  });

  it('consumeNonce throws if purpose does not match', async () => {
    const value = await generateNonce('change_password', null, knex, clock);

    await expect(consumeNonce(value, 'publish', undefined, knex, clock))
      .rejects.toBeInstanceOf(AppError);
  });

  it('consumeNonce succeeds when expectedUserId matches nonce user_id', async () => {
    const userId = BigInt(42);
    const value = await generateNonce('approve', userId, knex, clock);
    await expect(consumeNonce(value, 'approve', 42, knex, clock)).resolves.toBeUndefined();
  });

  it('consumeNonce throws NONCE_INVALID when expectedUserId does not match nonce user_id (cross-user replay)', async () => {
    const userId = BigInt(42);
    const value = await generateNonce('approve', userId, knex, clock);

    // Different user (id=99) tries to consume the nonce
    await expect(consumeNonce(value, 'approve', 99, knex, clock))
      .rejects.toBeInstanceOf(AppError);
  });
});
