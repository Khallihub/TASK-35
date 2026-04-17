import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import { TestClock } from '../../src/clock';
import {
  createListing,
  getListing,
  updateListing,
  transitionStatus,
  softDeleteListing,
  restoreListing,
} from '../../src/services/listing';
import { AppError } from '../../src/errors';

let testKnex: KnexType;
let clock: TestClock;

// Helper: create test office and user
async function setupOfficeAndUser(officeId = 1, userId = 1): Promise<void> {
  const officeExists = await testKnex('offices').where({ id: officeId }).first();
  if (!officeExists) {
    await testKnex('offices').insert({ id: officeId, name: 'Test Office', code: `OFF${officeId}`, active: 1 });
  }

  const userExists = await testKnex('users').where({ id: userId }).first();
  if (!userExists) {
    await testKnex('users').insert({
      id: userId,
      username: `testuser${userId}`,
      password_hash: 'hash',
      role: 'regular_user',
      office_id: officeId,
      status: 'active',
      failed_login_count: 0,
      must_change_password: 0,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }
}

beforeAll(async () => {
  testKnex = createTestKnex();
  await runTestMigrations(testKnex);
  setAuditKnex(testKnex);
  setDefaultKnex(testKnex);
  clock = new TestClock(new Date('2024-06-01T12:00:00.000Z'));
});

afterAll(async () => {
  resetAuditKnex();
  resetDefaultKnex();
  await dropTestTables(testKnex);
  await testKnex.destroy();
});

beforeEach(async () => {
  // Clean listing-related tables before each test to avoid interference
  await testKnex('event_log').delete();
  await testKnex('listing_status_history').delete();
  await testKnex('listing_revisions').delete();
  await testKnex('listings').delete();
});

describe('createListing', () => {
  it('inserts DB row + revision row + event_log row', async () => {
    await setupOfficeAndUser(1, 1);

    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const input = {
      address_line: '123 Main St',
      city: 'Boston',
      state_code: 'MA',
      beds: 2,
      baths: 1.5,
      price_usd_cents: 500000,
      area_sqft: 1000,
    };

    const listing = await createListing(actor, input, '127.0.0.1', testKnex, clock);

    expect(listing.id).toBeGreaterThan(0);
    expect(listing.status).toBe('draft');
    expect(listing.version).toBe(1);
    expect(listing.beds).toBe(2);
    expect(listing.baths).toBe(1.5);
    expect(listing.city).toBe('Boston');

    // Check DB row exists
    const dbRow = await testKnex('listings').where({ id: listing.id }).first();
    expect(dbRow).toBeDefined();
    expect(dbRow.baths).toBe(3); // stored as baths * 2

    // Check revision row
    const revisions = await testKnex('listing_revisions').where({ listing_id: listing.id });
    expect(revisions).toHaveLength(1);
    expect(revisions[0].version).toBe(1);

    // Check event_log row
    const events = await testKnex('event_log').where({ entity_id: listing.id });
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('listing.created');
  });

  it('throws VALIDATION_ERROR on invalid input', async () => {
    await setupOfficeAndUser(1, 1);
    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    await expect(
      createListing(actor, { state_code: 'INVALID' }, '127.0.0.1', testKnex, clock),
    ).rejects.toThrow(AppError);
  });
});

describe('getListing', () => {
  it('scope enforcement: regular_user can get own draft listing', async () => {
    await setupOfficeAndUser(1, 1);
    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const listing = await createListing(actor, { city: 'NY' }, '127.0.0.1', testKnex, clock);

    const fetched = await getListing(listing.id, actor, testKnex);
    expect(fetched.id).toBe(listing.id);
  });

  it('scope enforcement: regular_user cannot see other agent draft', async () => {
    await setupOfficeAndUser(1, 1);
    await setupOfficeAndUser(1, 2);

    const actor1 = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const actor2 = { id: 2, role: 'regular_user' as const, officeId: 1 };

    const listing = await createListing(actor1, { city: 'NY' }, '127.0.0.1', testKnex, clock);

    await expect(getListing(listing.id, actor2, testKnex)).rejects.toThrow(AppError);
  });

  it('returns 404 for non-existent listing', async () => {
    const actor = { id: 1, role: 'administrator' as const, officeId: null };
    await expect(getListing(99999, actor, testKnex)).rejects.toThrow(AppError);
  });
});

describe('updateListing', () => {
  it('optimistic lock failure: wrong version → VERSION_CONFLICT', async () => {
    await setupOfficeAndUser(1, 1);
    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const listing = await createListing(actor, { city: 'Boston' }, '127.0.0.1', testKnex, clock);

    await expect(
      updateListing(listing.id, actor, { city: 'NYC' }, 999, '127.0.0.1', testKnex, clock),
    ).rejects.toThrow(AppError);

    try {
      await updateListing(listing.id, actor, { city: 'NYC' }, 999, '127.0.0.1', testKnex, clock);
    } catch (err) {
      expect((err as AppError).code).toBe('VERSION_CONFLICT');
    }
  });

  it('success: increments version and creates revision', async () => {
    await setupOfficeAndUser(1, 1);
    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const listing = await createListing(actor, { city: 'Boston' }, '127.0.0.1', testKnex, clock);

    clock.advance(1000);
    const updated = await updateListing(listing.id, actor, { city: 'NYC' }, 1, '127.0.0.1', testKnex, clock);

    expect(updated.version).toBe(2);
    expect(updated.city).toBe('NYC');

    const revisions = await testKnex('listing_revisions').where({ listing_id: listing.id });
    expect(revisions).toHaveLength(2);
  });
});

describe('transitionStatus', () => {
  it('draft → in_review: success', async () => {
    await setupOfficeAndUser(1, 1);
    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const listing = await createListing(actor, { city: 'Boston' }, '127.0.0.1', testKnex, clock);

    const updated = await transitionStatus(listing.id, actor, 'in_review', undefined, undefined, '127.0.0.1', testKnex, clock);
    expect(updated.status).toBe('in_review');

    // Check status history (includes initial draft entry from createListing + transition)
    const history = await testKnex('listing_status_history').where({ listing_id: listing.id }).orderBy('id', 'asc');
    expect(history).toHaveLength(2);
    expect(history[0].from_status).toBeNull();
    expect(history[0].to_status).toBe('draft');
    expect(history[1].from_status).toBe('draft');
    expect(history[1].to_status).toBe('in_review');
  });

  it('draft → published (illegal): ILLEGAL_TRANSITION error', async () => {
    await setupOfficeAndUser(1, 1);
    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const listing = await createListing(actor, { city: 'Boston' }, '127.0.0.1', testKnex, clock);

    try {
      await transitionStatus(listing.id, actor, 'published', undefined, undefined, '127.0.0.1', testKnex, clock);
      fail('Should have thrown');
    } catch (err) {
      expect((err as AppError).code).toBe('ILLEGAL_TRANSITION');
    }
  });
});

describe('softDeleteListing + restoreListing', () => {
  it('soft delete sets soft_deleted_at and status=deleted', async () => {
    await setupOfficeAndUser(1, 1);
    const actor = { id: 1, role: 'regular_user' as const, officeId: 1 };
    const listing = await createListing(actor, { city: 'Boston' }, '127.0.0.1', testKnex, clock);

    await softDeleteListing(listing.id, actor, '127.0.0.1', testKnex, clock);

    const dbRow = await testKnex('listings').where({ id: listing.id }).first();
    expect(dbRow.status).toBe('deleted');
    expect(dbRow.soft_deleted_at).toBeTruthy();
  });

  it('restore within 90 days: clears soft_deleted_at, sets status=draft', async () => {
    await setupOfficeAndUser(1, 1);
    const merchantActor = { id: 1, role: 'merchant' as const, officeId: 1 };
    const listing = await createListing(merchantActor, { city: 'Boston' }, '127.0.0.1', testKnex, clock);

    clock.advance(1000);
    await softDeleteListing(listing.id, merchantActor, '127.0.0.1', testKnex, clock);

    // Advance 1 day (within 90 days)
    clock.advance(24 * 60 * 60 * 1000);
    const restored = await restoreListing(listing.id, merchantActor, '127.0.0.1', testKnex, clock);

    expect(restored.status).toBe('draft');
    expect(restored.soft_deleted_at).toBeNull();
  });

  it('restore after 90 days: throws VALIDATION_ERROR', async () => {
    await setupOfficeAndUser(1, 1);
    const merchantActor = { id: 1, role: 'merchant' as const, officeId: 1 };
    const listing = await createListing(merchantActor, { city: 'Chicago' }, '127.0.0.1', testKnex, clock);

    clock.advance(1000);
    await softDeleteListing(listing.id, merchantActor, '127.0.0.1', testKnex, clock);

    // Advance 91 days
    clock.advance(91 * 24 * 60 * 60 * 1000);

    try {
      await restoreListing(listing.id, merchantActor, '127.0.0.1', testKnex, clock);
      fail('Should have thrown');
    } catch (err) {
      expect((err as AppError).code).toBe('VALIDATION_ERROR');
    }
  });
});
