import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { TestClock } from '../../src/clock';
import {
  getLatestConsentVersion,
  hasUserAcceptedLatest,
  recordConsent,
} from '../../src/services/consent';

/**
 * Consent service coverage — previously only exercised indirectly through
 * auth tests. These tests lock the contract:
 *
 *   - getLatestConsentVersion returns the row with the latest effective_from
 *   - hasUserAcceptedLatest returns true when no consent version exists
 *   - hasUserAcceptedLatest returns false for a user that hasn't signed the
 *     latest version
 *   - recordConsent inserts the consent_records row AND mirrors the fields
 *     onto the user row
 */

let knex: KnexType;
let clock: TestClock;

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

beforeAll(async () => {
  knex = createTestKnex();
  await runTestMigrations(knex);
  clock = new TestClock(new Date('2025-01-15T12:00:00.000Z'));
});

afterAll(async () => {
  await dropTestTables(knex);
  await knex.destroy();
});

beforeEach(async () => {
  await knex('consent_records').delete();
  await knex('consent_versions').delete();
  await knex('users').delete();
  await knex('offices').delete();
});

async function seedUser(): Promise<bigint> {
  await knex('offices').insert({ id: 1, name: 'Main', code: 'M', active: 1 });
  const [id] = await knex('users').insert({
    username: `u_${Date.now()}`,
    password_hash: 'x',
    role: 'regular_user',
    office_id: 1,
    status: 'active',
    failed_login_count: 0,
    must_change_password: 0,
    created_at: formatDatetime(new Date()),
    updated_at: formatDatetime(new Date()),
  });
  return BigInt(id);
}

describe('getLatestConsentVersion', () => {
  it('returns null when no consent versions exist', async () => {
    expect(await getLatestConsentVersion(knex)).toBeNull();
  });

  it('returns the row with the latest effective_from', async () => {
    await knex('consent_versions').insert([
      { version: '1.0', body_md: 'old', effective_from: formatDatetime(new Date('2024-01-01')) },
      { version: '2.0', body_md: 'new', effective_from: formatDatetime(new Date('2025-06-01')) },
      { version: '1.5', body_md: 'mid', effective_from: formatDatetime(new Date('2024-12-01')) },
    ]);
    const latest = await getLatestConsentVersion(knex);
    expect(latest?.version).toBe('2.0');
  });
});

describe('hasUserAcceptedLatest', () => {
  it('returns true when no consent version exists (no requirement)', async () => {
    const uid = await seedUser();
    expect(await hasUserAcceptedLatest(uid, knex)).toBe(true);
  });

  it('returns false when the user has not accepted the latest version', async () => {
    const uid = await seedUser();
    await knex('consent_versions').insert({
      version: '1.0',
      body_md: 'x',
      effective_from: formatDatetime(new Date('2024-01-01')),
    });
    expect(await hasUserAcceptedLatest(uid, knex)).toBe(false);
  });

  it('returns true when the user has accepted the latest version', async () => {
    const uid = await seedUser();
    const [cvId] = await knex('consent_versions').insert({
      version: '1.0',
      body_md: 'x',
      effective_from: formatDatetime(new Date('2024-01-01')),
    });
    await recordConsent(uid, BigInt(cvId), '127.0.0.1', knex, clock);
    expect(await hasUserAcceptedLatest(uid, knex)).toBe(true);
  });

  it('returns false if a newer version supersedes what the user previously accepted', async () => {
    const uid = await seedUser();
    const [oldId] = await knex('consent_versions').insert({
      version: '1.0',
      body_md: 'old',
      effective_from: formatDatetime(new Date('2024-01-01')),
    });
    await recordConsent(uid, BigInt(oldId), '127.0.0.1', knex, clock);
    // A new version is published.
    await knex('consent_versions').insert({
      version: '2.0',
      body_md: 'new',
      effective_from: formatDatetime(new Date('2025-06-01')),
    });
    expect(await hasUserAcceptedLatest(uid, knex)).toBe(false);
  });
});

describe('recordConsent', () => {
  it('inserts consent_records and updates the user mirror fields', async () => {
    const uid = await seedUser();
    const [cvId] = await knex('consent_versions').insert({
      version: '1.0',
      body_md: 'x',
      effective_from: formatDatetime(new Date('2024-01-01')),
    });

    await recordConsent(uid, BigInt(cvId), '10.0.0.5', knex, clock);

    const record = await knex('consent_records')
      .where({ user_id: String(uid), consent_version_id: String(cvId) })
      .first();
    expect(record).toBeDefined();
    expect(record.ip).toBe('10.0.0.5');

    const user = await knex('users').where({ id: String(uid) }).first();
    expect(String(user.consent_version_accepted)).toBe(String(cvId));
    expect(user.consent_accepted_at).toBeTruthy();
  });
});
