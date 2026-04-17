import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { setAuditKnex, resetAuditKnex } from '../../src/audit/chain';
import { setDefaultKnex, resetDefaultKnex } from '../../src/db/knex';
import { TestClock } from '../../src/clock';
import {
  createPromo,
  getPromo,
  activatePromo,
  cancelPromo,
  addSlot,
  removeSlot,
  reorderSlots,
} from '../../src/services/promo';
import { AppError, ErrorCodes } from '../../src/errors';

let testKnex: KnexType;
let clock: TestClock;

async function setupUser(id = 1, role = 'operations', officeId = 1): Promise<void> {
  const officeExists = await testKnex('offices').where({ id: officeId }).first();
  if (!officeExists) {
    await testKnex('offices').insert({ id: officeId, name: 'Test Office', code: `OFF${officeId}`, active: 1 });
  }
  const userExists = await testKnex('users').where({ id }).first();
  if (!userExists) {
    await testKnex('users').insert({
      id,
      username: `user${id}`,
      password_hash: 'hash',
      role,
      office_id: officeId,
      status: 'active',
      failed_login_count: 0,
      must_change_password: 0,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }
}

async function createPublishedListing(actor: { id: number; role: string; officeId: number }): Promise<number> {
  const now = clock.now();
  const nowStr = now.toISOString().replace('T', ' ').replace('Z', '');
  const [id] = await testKnex('listings').insert({
    office_id: actor.officeId,
    created_by: actor.id,
    status: 'published',
    price_usd_cents: 500000,
    area_sqft: 1000,
    beds: 2,
    baths: 2,
    address_line: '123 Main St',
    state_code: 'MA',
    postal_code: '02101',
    anomaly_flags: '[]',
    version: 1,
    created_at: nowStr,
    updated_at: nowStr,
  });
  return id;
}

beforeAll(async () => {
  testKnex = createTestKnex();
  await runTestMigrations(testKnex);
  setAuditKnex(testKnex);
  setDefaultKnex(testKnex);
  clock = new TestClock(new Date('2025-01-01T00:00:00.000Z'));
});

afterAll(async () => {
  resetAuditKnex();
  resetDefaultKnex();
  await dropTestTables(testKnex);
  await testKnex.destroy();
});

beforeEach(async () => {
  await testKnex('promo_slots').delete();
  await testKnex('promo_collections').delete();
  await testKnex('event_log').delete();
  await testKnex('listing_status_history').delete();
  await testKnex('listing_revisions').delete();
  await testKnex('listings').delete();
});

const opsActor = { id: 1, role: 'operations', officeId: 1 };
const adminActor = { id: 2, role: 'administrator', officeId: 1 };

describe('createPromo', () => {
  it('inserts collection with status=draft', async () => {
    await setupUser(1, 'operations');

    const collection = await createPromo(
      opsActor,
      {
        title: 'Summer Sale',
        starts_at: '2025-06-01T00:00:00.000Z',
        ends_at: '2025-06-30T00:00:00.000Z',
      },
      testKnex,
      clock,
    );

    expect(collection.id).toBeGreaterThan(0);
    expect(collection.status).toBe('draft');
    expect(collection.title).toBe('Summer Sale');
    expect(collection.created_by).toBe(1);
  });

  it('throws VALIDATION_ERROR if title is empty', async () => {
    await setupUser(1, 'operations');

    await expect(
      createPromo(
        opsActor,
        { title: '', starts_at: '2025-06-01T00:00:00.000Z', ends_at: '2025-06-30T00:00:00.000Z' },
        testKnex,
        clock,
      ),
    ).rejects.toThrow(AppError);
  });

  it('throws VALIDATION_ERROR if ends_at <= starts_at', async () => {
    await setupUser(1, 'operations');

    await expect(
      createPromo(
        opsActor,
        { title: 'Bad Dates', starts_at: '2025-06-30T00:00:00.000Z', ends_at: '2025-06-01T00:00:00.000Z' },
        testKnex,
        clock,
      ),
    ).rejects.toThrow(AppError);
  });
});

describe('activatePromo', () => {
  it('transitions draft → scheduled (starts_at in future)', async () => {
    await setupUser(1, 'operations');

    const collection = await createPromo(
      opsActor,
      {
        title: 'Future Promo',
        starts_at: '2025-06-01T00:00:00.000Z',  // in future relative to clock (2025-01-01)
        ends_at: '2025-06-30T00:00:00.000Z',
      },
      testKnex,
      clock,
    );

    const activated = await activatePromo(collection.id, opsActor, testKnex, clock);
    expect(activated.status).toBe('scheduled');
  });

  it('computes live when now is between starts_at and ends_at', async () => {
    await setupUser(1, 'operations');

    // Set clock to be in the middle of the promo window
    const liveClock = new TestClock(new Date('2025-06-15T00:00:00.000Z'));

    const collection = await createPromo(
      opsActor,
      {
        title: 'Live Promo',
        starts_at: '2025-06-01T00:00:00.000Z',
        ends_at: '2025-06-30T00:00:00.000Z',
      },
      testKnex,
      liveClock,
    );

    const activated = await activatePromo(collection.id, opsActor, testKnex, liveClock);
    expect(activated.status).toBe('live');
  });

  it('throws ILLEGAL_TRANSITION if already cancelled', async () => {
    await setupUser(1, 'operations');

    const collection = await createPromo(
      opsActor,
      {
        title: 'Cancelled Promo',
        starts_at: '2025-06-01T00:00:00.000Z',
        ends_at: '2025-06-30T00:00:00.000Z',
      },
      testKnex,
      clock,
    );

    await cancelPromo(collection.id, opsActor, testKnex, clock);

    await expect(
      activatePromo(collection.id, opsActor, testKnex, clock),
    ).rejects.toMatchObject({ code: ErrorCodes.ILLEGAL_TRANSITION });
  });
});

describe('addSlot', () => {
  it('adds a slot to a collection', async () => {
    await setupUser(1, 'operations');
    await setupUser(2, 'administrator');

    const listingId = await createPublishedListing(opsActor);

    const collection = await createPromo(
      opsActor,
      {
        title: 'Slot Test',
        starts_at: '2025-06-01T00:00:00.000Z',
        ends_at: '2025-06-30T00:00:00.000Z',
      },
      testKnex,
      clock,
    );

    const slot = await addSlot(collection.id, listingId, 1, opsActor, testKnex, clock);
    expect(slot.id).toBeGreaterThan(0);
    expect(slot.collection_id).toBe(collection.id);
    expect(slot.listing_id).toBe(listingId);
    expect(slot.rank).toBe(1);
  });

  it('enforces max 20 slots', async () => {
    await setupUser(1, 'operations');

    const collection = await createPromo(
      opsActor,
      {
        title: 'Full Collection',
        starts_at: '2025-06-01T00:00:00.000Z',
        ends_at: '2025-06-30T00:00:00.000Z',
      },
      testKnex,
      clock,
    );

    // Insert 20 slots directly
    const now = clock.now().toISOString().replace('T', ' ').replace('Z', '');
    for (let i = 1; i <= 20; i++) {
      const [lid] = await testKnex('listings').insert({
        office_id: opsActor.officeId,
        created_by: opsActor.id,
        status: 'published',
        price_usd_cents: 500000,
        area_sqft: 1000,
        beds: 2,
        baths: 2,
        address_line: `${i} Main St`,
        state_code: 'MA',
        postal_code: '02101',
        anomaly_flags: '[]',
        version: 1,
        created_at: now,
        updated_at: now,
      });
      await testKnex('promo_slots').insert({
        collection_id: collection.id,
        listing_id: lid,
        rank: i,
        added_by: opsActor.id,
        added_at: now,
      });
    }

    // Add one more listing
    const [extraId] = await testKnex('listings').insert({
      office_id: opsActor.officeId,
      created_by: opsActor.id,
      status: 'published',
      price_usd_cents: 500000,
      area_sqft: 1000,
      beds: 2,
      baths: 2,
      address_line: '99 Extra St',
      state_code: 'MA',
      postal_code: '02101',
      anomaly_flags: '[]',
      version: 1,
      created_at: now,
      updated_at: now,
    });

    await expect(
      addSlot(collection.id, extraId, 21, opsActor, testKnex, clock),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
  });

  it('duplicate listing → CONFLICT', async () => {
    await setupUser(1, 'operations');

    const listingId = await createPublishedListing(opsActor);
    const collection = await createPromo(
      opsActor,
      { title: 'Dup Test', starts_at: '2025-06-01T00:00:00.000Z', ends_at: '2025-06-30T00:00:00.000Z' },
      testKnex,
      clock,
    );

    await addSlot(collection.id, listingId, 1, opsActor, testKnex, clock);

    await expect(
      addSlot(collection.id, listingId, 2, opsActor, testKnex, clock),
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT });
  });

  it('duplicate rank → CONFLICT', async () => {
    await setupUser(1, 'operations');

    const listingId1 = await createPublishedListing(opsActor);
    const listingId2 = await createPublishedListing(opsActor);

    const collection = await createPromo(
      opsActor,
      { title: 'Rank Test', starts_at: '2025-06-01T00:00:00.000Z', ends_at: '2025-06-30T00:00:00.000Z' },
      testKnex,
      clock,
    );

    await addSlot(collection.id, listingId1, 1, opsActor, testKnex, clock);

    await expect(
      addSlot(collection.id, listingId2, 1, opsActor, testKnex, clock),
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT });
  });

  it('non-published listing → VALIDATION_ERROR', async () => {
    await setupUser(1, 'operations');

    const now = clock.now().toISOString().replace('T', ' ').replace('Z', '');
    const [draftListingId] = await testKnex('listings').insert({
      office_id: opsActor.officeId,
      created_by: opsActor.id,
      status: 'draft',
      anomaly_flags: '[]',
      version: 1,
      created_at: now,
      updated_at: now,
    });

    const collection = await createPromo(
      opsActor,
      { title: 'Draft Listing Test', starts_at: '2025-06-01T00:00:00.000Z', ends_at: '2025-06-30T00:00:00.000Z' },
      testKnex,
      clock,
    );

    await expect(
      addSlot(collection.id, draftListingId, 1, opsActor, testKnex, clock),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
  });
});

describe('removeSlot', () => {
  it('removes a slot row', async () => {
    await setupUser(1, 'operations');

    const listingId = await createPublishedListing(opsActor);
    const collection = await createPromo(
      opsActor,
      { title: 'Remove Test', starts_at: '2025-06-01T00:00:00.000Z', ends_at: '2025-06-30T00:00:00.000Z' },
      testKnex,
      clock,
    );

    const slot = await addSlot(collection.id, listingId, 1, opsActor, testKnex, clock);
    await removeSlot(collection.id, slot.id, opsActor, testKnex, clock);

    const remaining = await testKnex('promo_slots').where({ id: slot.id }).first();
    expect(remaining).toBeUndefined();
  });
});

describe('reorderSlots', () => {
  it('updates ranks atomically', async () => {
    await setupUser(1, 'operations');

    const listingId1 = await createPublishedListing(opsActor);
    const listingId2 = await createPublishedListing(opsActor);
    const listingId3 = await createPublishedListing(opsActor);

    const collection = await createPromo(
      opsActor,
      { title: 'Reorder Test', starts_at: '2025-06-01T00:00:00.000Z', ends_at: '2025-06-30T00:00:00.000Z' },
      testKnex,
      clock,
    );

    const slot1 = await addSlot(collection.id, listingId1, 1, opsActor, testKnex, clock);
    const slot2 = await addSlot(collection.id, listingId2, 2, opsActor, testKnex, clock);
    const slot3 = await addSlot(collection.id, listingId3, 3, opsActor, testKnex, clock);

    // Reverse the order
    const updated = await reorderSlots(
      collection.id,
      [
        { slotId: slot1.id, rank: 3 },
        { slotId: slot2.id, rank: 2 },
        { slotId: slot3.id, rank: 1 },
      ],
      opsActor,
      testKnex,
      clock,
    );

    expect(updated).toHaveLength(3);
    expect(updated[0].rank).toBe(1);
    expect(updated[0].listing_id).toBe(listingId3);
    expect(updated[1].rank).toBe(2);
    expect(updated[1].listing_id).toBe(listingId2);
    expect(updated[2].rank).toBe(3);
    expect(updated[2].listing_id).toBe(listingId1);
  });

  it('throws VALIDATION_ERROR if slotId does not belong to collection', async () => {
    await setupUser(1, 'operations');

    const collection = await createPromo(
      opsActor,
      { title: 'Reorder Mismatch', starts_at: '2025-06-01T00:00:00.000Z', ends_at: '2025-06-30T00:00:00.000Z' },
      testKnex,
      clock,
    );

    await expect(
      reorderSlots(collection.id, [{ slotId: 9999, rank: 1 }], opsActor, testKnex, clock),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
  });
});
