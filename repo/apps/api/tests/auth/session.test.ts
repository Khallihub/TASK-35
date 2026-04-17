import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { createSession, touchSession, revokeSession, getActiveSession } from '../../src/services/session';
import { TestClock } from '../../src/clock';
import { Knex as KnexType } from 'knex';

const ROLE = 'regular_user' as const;

async function createTestUser(knex: KnexType): Promise<bigint> {
  const now = new Date();
  const [id] = await knex('users').insert({
    username: 'sessionuser',
    password_hash: '$2b$12$placeholder',
    role: ROLE,
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: now,
    updated_at: now,
  });
  return BigInt(id);
}

describe('session service', () => {
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

  it('createSession returns tokens and inserts a session row', async () => {
    const { session, accessToken, refreshToken } = await createSession(
      { userId, role: ROLE, officeId: null },
      knex,
      clock,
    );

    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
    expect(session).toBeDefined();
    expect(session.jti).toBeTruthy();
    expect(session.revoked_at).toBeNull();

    const row = await knex('sessions').where({ jti: session.jti }).first();
    expect(row).toBeDefined();
    expect(row.user_id).toBe(Number(userId));
  });

  it('touchSession with active session succeeds and updates last_activity_at', async () => {
    const { session } = await createSession(
      { userId, role: ROLE, officeId: null },
      knex,
      clock,
    );

    // Advance time by 10 minutes (within inactivity window)
    clock.advance(10 * 60 * 1000);
    await touchSession(session.jti, knex, clock);

    const active = await getActiveSession(session.jti, knex, clock);
    expect(active).not.toBeNull();
  });

  it('touchSession after inactivity timeout revokes session', async () => {
    const { session } = await createSession(
      { userId, role: ROLE, officeId: null },
      knex,
      clock,
    );

    // Advance time past inactivity window (31 minutes)
    clock.advance(31 * 60 * 1000);
    await touchSession(session.jti, knex, clock);

    const active = await getActiveSession(session.jti, knex, clock);
    expect(active).toBeNull();
  });

  it('revokeSession marks revoked_at', async () => {
    const { session } = await createSession(
      { userId, role: ROLE, officeId: null },
      knex,
      clock,
    );

    await revokeSession(session.jti, 'test_reason', knex, clock);

    const row = await knex('sessions').where({ jti: session.jti }).first();
    expect(row.revoked_at).not.toBeNull();
    expect(row.revoke_reason).toBe('test_reason');
  });

  it('getActiveSession returns null and revokes when idle >30 minutes (blocks stale refresh)', async () => {
    const { session } = await createSession(
      { userId, role: ROLE, officeId: null },
      knex,
      clock,
    );

    // Advance time past inactivity window (31 minutes) WITHOUT touching
    clock.advance(31 * 60 * 1000);

    // getActiveSession itself should now detect inactivity and return null
    const active = await getActiveSession(session.jti, knex, clock);
    expect(active).toBeNull();

    // Session should be revoked with 'inactivity' reason
    const row = await knex('sessions').where({ jti: session.jti }).first();
    expect(row.revoked_at).not.toBeNull();
    expect(row.revoke_reason).toBe('inactivity');
  });

  it('getActiveSession after revocation returns null', async () => {
    const { session } = await createSession(
      { userId, role: ROLE, officeId: null },
      knex,
      clock,
    );

    await revokeSession(session.jti, 'logout', knex, clock);

    const active = await getActiveSession(session.jti, knex, clock);
    expect(active).toBeNull();
  });
});
