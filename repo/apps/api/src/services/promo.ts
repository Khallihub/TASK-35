import { Knex as KnexType } from 'knex';
import { AppError, ErrorCodes } from '../errors';
import { Clock, systemClock } from '../clock';
import defaultKnex from '../db/knex';
import { logEvent } from './eventLog';
import { appendAuditEvent } from '../audit/chain';
import { computePromoStatus } from './promoStatus';
import { canTransitionPromo } from './promoStateMachine';
import {
  PromoCollection,
  PromoSlot,
  PromoStatus,
  CreatePromoInput,
  UpdatePromoInput,
} from '../types/promo';

// ─── helpers ────────────────────────────────────────────────────────────────

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

function parseDbDateToIso(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  const str = String(val).replace(' ', 'T');
  const d = new Date(str.includes('Z') || str.includes('+') ? str : str + 'Z');
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function parseDbDateOnly(val: string | null | undefined): string | null {
  if (!val) return null;
  return String(val).substring(0, 10);
}

function rowToCollection(row: Record<string, unknown>): PromoCollection {
  return {
    id: Number(row.id),
    title: String(row.title),
    theme_date: parseDbDateOnly(row.theme_date as string | null),
    starts_at: parseDbDateToIso(row.starts_at as string | Date) ?? String(row.starts_at),
    ends_at: parseDbDateToIso(row.ends_at as string | Date) ?? String(row.ends_at),
    status: row.status as PromoStatus,
    created_by: Number(row.created_by),
    created_at: parseDbDateToIso(row.created_at as string | Date) ?? String(row.created_at),
    updated_at: parseDbDateToIso(row.updated_at as string | Date) ?? String(row.updated_at),
  };
}

function rowToSlot(row: Record<string, unknown>): PromoSlot {
  return {
    id: Number(row.id),
    collection_id: Number(row.collection_id),
    listing_id: Number(row.listing_id),
    rank: Number(row.rank),
    added_by: Number(row.added_by),
    added_at: parseDbDateToIso(row.added_at as string | Date) ?? String(row.added_at),
  };
}

// ─── Actor type ─────────────────────────────────────────────────────────────

interface Actor {
  id: number;
  role: string;
  officeId: number | null;
  ip?: string;
}

// ─── createPromo ─────────────────────────────────────────────────────────────

export async function createPromo(
  actor: Actor,
  input: CreatePromoInput,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<PromoCollection> {
  if (!input.title || input.title.trim().length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'title is required', 400);
  }
  if (!input.starts_at || !input.ends_at) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'starts_at and ends_at are required', 400);
  }

  const startsAt = new Date(input.starts_at);
  const endsAt = new Date(input.ends_at);

  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'starts_at and ends_at must be valid ISO dates', 400);
  }

  if (endsAt <= startsAt) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'ends_at must be after starts_at', 400);
  }

  const now = clock.now();
  const nowStr = formatDatetime(now);

  const insertObj: Record<string, unknown> = {
    title: input.title.trim(),
    theme_date: input.theme_date ?? null,
    starts_at: formatDatetime(startsAt),
    ends_at: formatDatetime(endsAt),
    status: 'draft',
    created_by: actor.id,
    created_at: nowStr,
    updated_at: nowStr,
  };

  let collection!: PromoCollection;

  await knex.transaction(async (trx) => {
    const [insertedId] = await trx('promo_collections').insert(insertObj);
    const raw = await trx('promo_collections').where({ id: insertedId }).first<Record<string, unknown>>();
    collection = rowToCollection(raw);

    await logEvent({
      user_id: actor.id,
      event_type: 'promo.created',
      entity_type: 'promo_collection',
      entity_id: Number(insertedId),
      payload: { title: collection.title },
      clock,
      knex: trx,
    });

    await appendAuditEvent({
      actor_id: actor.id,
      actor_role: actor.role,
      action: 'promo.created',
      entity_type: 'promo_collection',
      entity_id: String(collection.id),
      after_json: { title: collection.title, status: 'draft', starts_at: collection.starts_at, ends_at: collection.ends_at, theme_date: collection.theme_date },
      ip: actor.ip,
    }, clock, trx);
  });

  return collection;
}

// ─── getPromo ─────────────────────────────────────────────────────────────────

export async function getPromo(
  id: number,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<PromoCollection & { slots: PromoSlot[] }> {
  const raw = await knex('promo_collections').where({ id }).first<Record<string, unknown> | undefined>();
  if (!raw) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Promo collection not found', 404);
  }

  const collection = rowToCollection(raw);
  const now = clock.now();
  const computedStatus = computePromoStatus(collection, now);

  // Update status in DB if changed
  if (computedStatus !== collection.status) {
    const nowStr = formatDatetime(now);
    await knex('promo_collections').where({ id }).update({
      status: computedStatus,
      updated_at: nowStr,
    });
    collection.status = computedStatus;
    collection.updated_at = now.toISOString();
  }

  const slotRows = await knex('promo_slots')
    .where({ collection_id: id })
    .orderBy('rank', 'asc')
    .select<Record<string, unknown>[]>('*');

  const slots = slotRows.map(rowToSlot);

  return { ...collection, slots };
}

// ─── listPromos ───────────────────────────────────────────────────────────────

export interface ListPromoFilters {
  status?: PromoStatus;
  from?: string;
  to?: string;
}

export interface ListPromoPagination {
  cursor?: string;
  limit: number;
}

export async function listPromos(
  filters: ListPromoFilters,
  pagination: ListPromoPagination,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<{ items: PromoCollection[]; nextCursor: string | null }> {
  const limit = Math.min(pagination.limit || 25, 100);
  const now = clock.now();

  let query = knex('promo_collections');

  if (filters.from) {
    query = query.where('starts_at', '>=', formatDatetime(new Date(filters.from)));
  }
  if (filters.to) {
    query = query.where('ends_at', '<=', formatDatetime(new Date(filters.to)));
  }

  if (pagination.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(pagination.cursor, 'base64').toString('utf8')) as { created_at: string; id: number };
      query = query.where(function () {
        this.where('created_at', '<', cursor.created_at)
          .orWhere(function () {
            this.where('created_at', '=', cursor.created_at).where('id', '<', cursor.id);
          });
      });
    } catch {
      // Invalid cursor, ignore
    }
  }

  query = query.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit + 1);

  const rows = await query.select<Record<string, unknown>[]>('*');
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  // Apply computePromoStatus per row (but do NOT update DB on list)
  const collections = items.map((row) => {
    const col = rowToCollection(row);
    col.status = computePromoStatus(col, now);
    return col;
  });

  // Apply status filter after computing status
  const filtered = filters.status
    ? collections.filter((c) => c.status === filters.status)
    : collections;

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    const cursorData = {
      created_at: last.created_at instanceof Date
        ? formatDatetime(last.created_at as Date)
        : String(last.created_at),
      id: Number(last.id),
    };
    nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64');
  }

  return { items: filtered, nextCursor };
}

// ─── updatePromo ─────────────────────────────────────────────────────────────

export async function updatePromo(
  id: number,
  actor: Actor,
  input: UpdatePromoInput,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<PromoCollection> {
  const raw = await knex('promo_collections').where({ id }).first<Record<string, unknown> | undefined>();
  if (!raw) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Promo collection not found', 404);
  }

  const collection = rowToCollection(raw);
  if (collection.status !== 'draft') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Only draft promo collections can be updated', 400);
  }

  const now = clock.now();
  const nowStr = formatDatetime(now);

  const updateObj: Record<string, unknown> = { updated_at: nowStr };

  if (input.title !== undefined) {
    if (!input.title.trim()) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'title cannot be empty', 400);
    }
    updateObj.title = input.title.trim();
  }

  if (input.theme_date !== undefined) {
    updateObj.theme_date = input.theme_date;
  }

  const newStartsAt = input.starts_at ? new Date(input.starts_at) : new Date(collection.starts_at);
  const newEndsAt = input.ends_at ? new Date(input.ends_at) : new Date(collection.ends_at);

  if (input.starts_at !== undefined) {
    if (isNaN(newStartsAt.getTime())) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'starts_at must be a valid ISO date', 400);
    }
    updateObj.starts_at = formatDatetime(newStartsAt);
  }

  if (input.ends_at !== undefined) {
    if (isNaN(newEndsAt.getTime())) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'ends_at must be a valid ISO date', 400);
    }
    updateObj.ends_at = formatDatetime(newEndsAt);
  }

  if (newEndsAt <= newStartsAt) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'ends_at must be after starts_at', 400);
  }

  let updatedCollection!: PromoCollection;
  await knex.transaction(async (trx) => {
    await trx('promo_collections').where({ id }).update(updateObj);
    const updated = await trx('promo_collections').where({ id }).first<Record<string, unknown>>();
    updatedCollection = rowToCollection(updated);

    await appendAuditEvent({
      actor_id: actor.id,
      actor_role: actor.role,
      action: 'promo.updated',
      entity_type: 'promo_collection',
      entity_id: String(id),
      before_json: { title: collection.title, starts_at: collection.starts_at, ends_at: collection.ends_at, theme_date: collection.theme_date, status: collection.status },
      after_json: { title: updatedCollection.title, starts_at: updatedCollection.starts_at, ends_at: updatedCollection.ends_at, theme_date: updatedCollection.theme_date, status: updatedCollection.status },
      ip: actor.ip,
    }, clock, trx);
  });

  return updatedCollection;
}

// ─── activatePromo ────────────────────────────────────────────────────────────

export async function activatePromo(
  id: number,
  actor: Actor,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<PromoCollection> {
  const raw = await knex('promo_collections').where({ id }).first<Record<string, unknown> | undefined>();
  if (!raw) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Promo collection not found', 404);
  }

  const collection = rowToCollection(raw);
  const check = canTransitionPromo(collection.status, 'scheduled', actor.role);
  if (!check.allowed) {
    throw new AppError(ErrorCodes.ILLEGAL_TRANSITION, check.error ?? 'Transition not allowed', 422);
  }

  const now = clock.now();
  // After activating to 'scheduled', compute the real time-based status immediately
  const activatedCollection = { ...collection, status: 'scheduled' as PromoStatus };
  const computedStatus = computePromoStatus(activatedCollection, now);

  const nowStr = formatDatetime(now);
  let result!: PromoCollection;
  await knex.transaction(async (trx) => {
    await trx('promo_collections').where({ id }).update({
      status: computedStatus,
      updated_at: nowStr,
    });

    const updated = await trx('promo_collections').where({ id }).first<Record<string, unknown>>();
    result = rowToCollection(updated);

    await logEvent({
      user_id: actor.id,
      event_type: 'promo.activated',
      entity_type: 'promo_collection',
      entity_id: id,
      payload: { status: computedStatus },
      clock,
      knex: trx,
    });

    await appendAuditEvent({
      actor_id: actor.id,
      actor_role: actor.role,
      action: 'promo.activated',
      entity_type: 'promo_collection',
      entity_id: String(id),
      before_json: { status: collection.status },
      after_json: { status: computedStatus },
      ip: actor.ip,
    }, clock, trx);
  });

  return result;
}

// ─── cancelPromo ─────────────────────────────────────────────────────────────

export async function cancelPromo(
  id: number,
  actor: Actor,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<PromoCollection> {
  const raw = await knex('promo_collections').where({ id }).first<Record<string, unknown> | undefined>();
  if (!raw) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Promo collection not found', 404);
  }

  const collection = rowToCollection(raw);
  // Need to check current computed status for cancellation
  const now = clock.now();
  const currentStatus = computePromoStatus(collection, now);
  const collectionWithCurrent = { ...collection, status: currentStatus };

  const check = canTransitionPromo(collectionWithCurrent.status, 'cancelled', actor.role);
  if (!check.allowed) {
    throw new AppError(ErrorCodes.ILLEGAL_TRANSITION, check.error ?? 'Transition not allowed', 422);
  }

  const nowStr = formatDatetime(now);
  let result!: PromoCollection;
  await knex.transaction(async (trx) => {
    await trx('promo_collections').where({ id }).update({
      status: 'cancelled',
      updated_at: nowStr,
    });

    const updated = await trx('promo_collections').where({ id }).first<Record<string, unknown>>();
    result = rowToCollection(updated);

    await logEvent({
      user_id: actor.id,
      event_type: 'promo.cancelled',
      entity_type: 'promo_collection',
      entity_id: id,
      payload: { from: collection.status },
      clock,
      knex: trx,
    });

    await appendAuditEvent({
      actor_id: actor.id,
      actor_role: actor.role,
      action: 'promo.cancelled',
      entity_type: 'promo_collection',
      entity_id: String(id),
      before_json: { status: collection.status },
      after_json: { status: 'cancelled' },
      ip: actor.ip,
    }, clock, trx);
  });

  return result;
}

// ─── addSlot ─────────────────────────────────────────────────────────────────

export async function addSlot(
  collectionId: number,
  listingId: number,
  rank: number,
  actor: Actor,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<PromoSlot> {
  if (rank < 1 || rank > 20) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'rank must be between 1 and 20', 400);
  }

  const now = clock.now();

  const collRaw = await knex('promo_collections').where({ id: collectionId }).first<Record<string, unknown> | undefined>();
  if (!collRaw) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Promo collection not found', 404);
  }

  const collection = rowToCollection(collRaw);
  const currentStatus = computePromoStatus(collection, now);

  if (currentStatus === 'ended' || currentStatus === 'cancelled') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, `Cannot add slots to a ${currentStatus} promo collection`, 400);
  }

  // Check slot count
  const countResult = await knex('promo_slots').where({ collection_id: collectionId }).count<{ count: number }[]>('id as count');
  const slotCount = Number(countResult[0]?.count ?? 0);
  if (slotCount >= 20) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Promo collection is full (max 20 slots)', 400);
  }

  // Check listing is published
  const listing = await knex('listings').where({ id: listingId }).whereNull('soft_deleted_at').first<{ status: string } | undefined>();
  if (!listing) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Listing not found', 404);
  }
  if (listing.status !== 'published') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Only published listings can be added to a promo collection', 400);
  }

  // Check unique listing per collection
  const existingListing = await knex('promo_slots').where({ collection_id: collectionId, listing_id: listingId }).first();
  if (existingListing) {
    throw new AppError(ErrorCodes.CONFLICT, 'Listing is already in this promo collection', 409);
  }

  // Check unique rank
  const existingRank = await knex('promo_slots').where({ collection_id: collectionId, rank }).first();
  if (existingRank) {
    throw new AppError(ErrorCodes.CONFLICT, `Rank ${rank} is already taken`, 409);
  }

  const nowStr = formatDatetime(now);
  let slot!: PromoSlot;

  await knex.transaction(async (trx) => {
    const [insertedId] = await trx('promo_slots').insert({
      collection_id: collectionId,
      listing_id: listingId,
      rank,
      added_by: actor.id,
      added_at: nowStr,
    });

    const raw = await trx('promo_slots').where({ id: insertedId }).first<Record<string, unknown>>();
    slot = rowToSlot(raw);

    await logEvent({
      user_id: actor.id,
      event_type: 'promo.slot_added',
      entity_type: 'promo_slot',
      entity_id: Number(insertedId),
      payload: { collection_id: collectionId, listing_id: listingId, rank },
      clock,
      knex: trx,
    });

    await appendAuditEvent({
      actor_id: actor.id,
      actor_role: actor.role,
      action: 'promo.slot_added',
      entity_type: 'promo_slot',
      entity_id: String(slot.id),
      after_json: { collection_id: collectionId, listing_id: listingId, rank },
      ip: actor.ip,
    }, clock, trx);
  });

  return slot;
}

// ─── removeSlot ──────────────────────────────────────────────────────────────

export async function removeSlot(
  collectionId: number,
  slotId: number,
  actor: Actor,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<void> {
  const now = clock.now();

  const collRaw = await knex('promo_collections').where({ id: collectionId }).first<Record<string, unknown> | undefined>();
  if (!collRaw) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Promo collection not found', 404);
  }

  const collection = rowToCollection(collRaw);
  const currentStatus = computePromoStatus(collection, now);

  if (currentStatus === 'ended' || currentStatus === 'cancelled') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, `Cannot remove slots from a ${currentStatus} promo collection`, 400);
  }

  const slot = await knex('promo_slots').where({ id: slotId, collection_id: collectionId }).first();
  if (!slot) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Promo slot not found', 404);
  }

  await knex.transaction(async (trx) => {
    await trx('promo_slots').where({ id: slotId }).delete();

    await logEvent({
      user_id: actor.id,
      event_type: 'promo.slot_removed',
      entity_type: 'promo_slot',
      entity_id: slotId,
      payload: { collection_id: collectionId },
      clock,
      knex: trx,
    });

    await appendAuditEvent({
      actor_id: actor.id,
      actor_role: actor.role,
      action: 'promo.slot_removed',
      entity_type: 'promo_slot',
      entity_id: String(slotId),
      before_json: { collection_id: collectionId, listing_id: slot.listing_id, rank: slot.rank },
      ip: actor.ip,
    }, clock, trx);
  });
}

// ─── reorderSlots ─────────────────────────────────────────────────────────────

export async function reorderSlots(
  collectionId: number,
  slotOrders: Array<{ slotId: number; rank: number }>,
  actor: Actor,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<PromoSlot[]> {
  // Validate ranks
  const ranks = slotOrders.map((s) => s.rank);
  const uniqueRanks = new Set(ranks);
  if (uniqueRanks.size !== ranks.length) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Duplicate ranks in reorder request', 400);
  }
  if (ranks.some((r) => r < 1 || r > 20)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'All ranks must be between 1 and 20', 400);
  }
  if (slotOrders.length > 20) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Cannot have more than 20 slots', 400);
  }

  const now = clock.now();

  // Verify all slotIds belong to this collection
  const existingSlots = await knex('promo_slots')
    .where({ collection_id: collectionId })
    .select<Array<{ id: number }>>('id');

  const existingIds = new Set(existingSlots.map((s) => s.id));
  const requestedIds = slotOrders.map((s) => s.slotId);

  for (const slotId of requestedIds) {
    if (!existingIds.has(slotId)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `Slot ${slotId} does not belong to collection ${collectionId}`, 400);
    }
  }

  await knex.transaction(async (trx) => {
    // Step 1: Set all affected rows to rank + 1000 to vacate positions
    for (const { slotId } of slotOrders) {
      await trx('promo_slots').where({ id: slotId }).update({
        rank: knex.raw('rank + 1000'),
      });
    }
    // Step 2: Set to final ranks
    for (const { slotId, rank } of slotOrders) {
      await trx('promo_slots').where({ id: slotId }).update({ rank });
    }

    await logEvent({
      user_id: actor.id,
      event_type: 'promo.slots_reordered',
      entity_type: 'promo_collection',
      entity_id: collectionId,
      payload: { collection_id: collectionId, count: slotOrders.length },
      clock,
      knex: trx,
    });

    await appendAuditEvent({
      actor_id: actor.id,
      actor_role: actor.role,
      action: 'promo.slots_reordered',
      entity_type: 'promo_collection',
      entity_id: String(collectionId),
      after_json: { count: slotOrders.length, slots: slotOrders },
      ip: actor.ip,
    }, clock, trx);
  });

  const updatedSlots = await knex('promo_slots')
    .where({ collection_id: collectionId })
    .orderBy('rank', 'asc')
    .select<Record<string, unknown>[]>('*');

  return updatedSlots.map(rowToSlot);
}

// ─── syncPromoStatuses ────────────────────────────────────────────────────────

export async function syncPromoStatuses(
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<{ updated: number }> {
  const now = clock.now();
  const nowStr = formatDatetime(now);

  // Load all non-cancelled, non-draft collections
  const rows = await knex('promo_collections')
    .whereNotIn('status', ['cancelled', 'draft'])
    .select<Record<string, unknown>[]>('*');

  let updated = 0;

  for (const row of rows) {
    const collection = rowToCollection(row);
    const computed = computePromoStatus(collection, now);
    if (computed !== collection.status) {
      await knex('promo_collections').where({ id: collection.id }).update({
        status: computed,
        updated_at: nowStr,
      });
      updated++;
    }
  }

  return { updated };
}
