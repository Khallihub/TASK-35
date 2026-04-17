import { Knex as KnexType } from 'knex';
import { Listing, CreateListingInput, UpdateListingInput, ListingStatus } from '../types/listing';
import { cleanseListingInput } from './cleansing';
import { canTransition, UserRole } from './listingStateMachine';
import { logEvent } from './eventLog';
import { appendAuditEvent } from '../audit';
import { AppError, ErrorCodes } from '../errors';
import { Clock, systemClock } from '../clock';
import defaultKnex from '../db/knex';
import { config } from '../config';

// ─── helpers ────────────────────────────────────────────────────────────────

function formatDatetime(d: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

function parseDbDate(val: Date | string | number | null | undefined): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number') return new Date(val);
  const str = String(val).replace(' ', 'T');
  const d = new Date(str.includes('Z') || str.includes('+') ? str : str + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

function isSQLite(knex: KnexType): boolean {
  const client = (knex.client as { config?: { client?: string } }).config?.client;
  return client === 'better-sqlite3' || process.env.NODE_ENV === 'test';
}

// Convert a raw DB row to a Listing (baths / 2, parse JSON, parse dates)
function rowToListing(row: Record<string, unknown>): Listing {
  let anomalyFlags: string[] = [];
  if (row.anomaly_flags) {
    if (typeof row.anomaly_flags === 'string') {
      try { anomalyFlags = JSON.parse(row.anomaly_flags as string); } catch { anomalyFlags = []; }
    } else if (Array.isArray(row.anomaly_flags)) {
      anomalyFlags = row.anomaly_flags as string[];
    }
  }

  // baths stored as baths*2 in DB; expose as decimal
  const bathsRaw = row.baths !== null && row.baths !== undefined ? Number(row.baths) : null;
  const baths = bathsRaw !== null ? bathsRaw / 2 : null;

  return {
    id: Number(row.id),
    office_id: Number(row.office_id),
    created_by: Number(row.created_by),
    status: row.status as ListingStatus,
    price_usd_cents: row.price_usd_cents !== null && row.price_usd_cents !== undefined ? Number(row.price_usd_cents) : null,
    area_sqft: row.area_sqft !== null && row.area_sqft !== undefined ? Number(row.area_sqft) : null,
    area_sqm: row.area_sqm !== null && row.area_sqm !== undefined ? Number(row.area_sqm) : null,
    beds: row.beds !== null && row.beds !== undefined ? Number(row.beds) : null,
    baths,
    floor_level: row.floor_level !== null && row.floor_level !== undefined ? Number(row.floor_level) : null,
    orientation: (row.orientation as Listing['orientation']) ?? null,
    latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : null,
    longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : null,
    address_line: (row.address_line as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    state_code: (row.state_code as string | null) ?? null,
    postal_code: (row.postal_code as string | null) ?? null,
    layout_normalized: (row.layout_normalized as string | null) ?? null,
    anomaly_flags: anomalyFlags,
    soft_deleted_at: parseDbDate(row.soft_deleted_at as Date | string | null),
    published_at: parseDbDate(row.published_at as Date | string | null),
    version: Number(row.version),
    created_at: parseDbDate(row.created_at as Date | string) ?? new Date(),
    updated_at: parseDbDate(row.updated_at as Date | string) ?? new Date(),
  };
}

// Convert Listing to DB insert/update object (baths * 2)
function listingToDbRow(listing: Partial<Listing>): Record<string, unknown> {
  const row: Record<string, unknown> = { ...listing };
  if (listing.baths !== undefined && listing.baths !== null) {
    row.baths = listing.baths * 2;
  }
  if (listing.anomaly_flags !== undefined) {
    row.anomaly_flags = JSON.stringify(listing.anomaly_flags);
  }
  return row;
}

// ─── settings ────────────────────────────────────────────────────────────────

export async function getSettings(knex: KnexType = defaultKnex): Promise<{ pricePerSqftMin: number; pricePerSqftMax: number }> {
  try {
    const minRow = await knex('settings').where({ key: 'listing.price_per_sqft_min' }).first<{ value: string } | undefined>();
    const maxRow = await knex('settings').where({ key: 'listing.price_per_sqft_max' }).first<{ value: string } | undefined>();

    return {
      pricePerSqftMin: minRow ? parseFloat(minRow.value) : 50,
      pricePerSqftMax: maxRow ? parseFloat(maxRow.value) : 5000,
    };
  } catch {
    return { pricePerSqftMin: 50, pricePerSqftMax: 5000 };
  }
}

// ─── scope check ─────────────────────────────────────────────────────────────

interface Actor {
  id: number;
  role: UserRole;
  officeId: number | null;
}

/**
 * Mask coordinates for non-privileged users per PRD §11.5:
 * regular_user viewing another agent's published listing sees lat/lon truncated to 2 decimals.
 * Merchant+ of the listing's office and operations/admin see full precision.
 */
function maskCoordinates(listing: Listing, actor: Actor): Listing {
  if (actor.role === 'administrator' || actor.role === 'operations') return listing;
  if (actor.role === 'merchant' && actor.officeId === listing.office_id) return listing;
  // Owner always sees full precision
  if (listing.created_by === actor.id) return listing;
  // Regular user or merchant viewing another office's published listing: mask to 2 decimals
  return {
    ...listing,
    latitude: listing.latitude !== null ? Math.round(listing.latitude * 100) / 100 : null,
    longitude: listing.longitude !== null ? Math.round(listing.longitude * 100) / 100 : null,
  };
}

function canScopeSee(actor: Actor, listing: Listing): boolean {
  if (actor.role === 'administrator' || actor.role === 'operations') {
    return true;
  }
  if (listing.status === 'published') {
    return true;
  }
  if (actor.role === 'merchant') {
    // own_office listings OR published any
    return actor.officeId !== null && actor.officeId === listing.office_id;
  }
  // regular_user: own listings
  return listing.created_by === actor.id;
}

// ─── createListing ────────────────────────────────────────────────────────────

export async function createListing(
  actor: Actor,
  input: CreateListingInput,
  ip: string,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<Listing> {
  const settings = await getSettings(knex);
  const { cleaned, anomalyFlags, errors } = cleanseListingInput(input, settings);

  if (errors.length > 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Validation failed', 400, { errors });
  }

  const now = clock.now();
  const nowStr = formatDatetime(now);

  let listing!: Listing;

  await knex.transaction(async (trx) => {
    const dbRow: Record<string, unknown> = {
      office_id: actor.officeId ?? 0,
      created_by: actor.id,
      status: 'draft',
      version: 1,
      anomaly_flags: JSON.stringify(anomalyFlags),
      created_at: nowStr,
      updated_at: nowStr,
    };

    // Apply cleaned fields
    if (cleaned.price_usd_cents !== undefined) dbRow.price_usd_cents = cleaned.price_usd_cents;
    if (cleaned.area_sqft !== undefined) dbRow.area_sqft = cleaned.area_sqft;
    if (cleaned.area_sqm !== undefined) dbRow.area_sqm = cleaned.area_sqm;
    if (cleaned.beds !== undefined) dbRow.beds = cleaned.beds;
    if (cleaned.baths !== undefined && cleaned.baths !== null) dbRow.baths = cleaned.baths * 2;
    if (cleaned.floor_level !== undefined) dbRow.floor_level = cleaned.floor_level;
    if (cleaned.orientation !== undefined) dbRow.orientation = cleaned.orientation;
    if (cleaned.latitude !== undefined) dbRow.latitude = cleaned.latitude;
    if (cleaned.longitude !== undefined) dbRow.longitude = cleaned.longitude;
    if (cleaned.address_line !== undefined) dbRow.address_line = cleaned.address_line;
    if (cleaned.city !== undefined) dbRow.city = cleaned.city;
    if (cleaned.state_code !== undefined) dbRow.state_code = cleaned.state_code;
    if (cleaned.postal_code !== undefined) dbRow.postal_code = cleaned.postal_code;
    if (cleaned.layout_normalized !== undefined) dbRow.layout_normalized = cleaned.layout_normalized;

    const [insertedId] = await trx('listings').insert(dbRow);
    const listingId = Number(insertedId);

    // Re-fetch from DB
    const rawRow = await trx('listings').where({ id: listingId }).first<Record<string, unknown>>();
    listing = rowToListing(rawRow);

    // Write listing_revisions
    const payloadJson = JSON.stringify({ ...rawRow, baths: listing.baths, anomaly_flags: listing.anomaly_flags });
    await trx('listing_revisions').insert({
      listing_id: listingId,
      version: 1,
      payload_json: payloadJson,
      diff_json: null,
      actor_id: actor.id,
      created_at: nowStr,
    });

    // Write initial listing_status_history entry for KPI funnel tracking
    await trx('listing_status_history').insert({
      listing_id: listingId,
      from_status: null,
      to_status: 'draft',
      actor_id: actor.id,
      reason: null,
      created_at: nowStr,
      ip: ip ?? null,
    });

    // Write event_log
    await logEvent({
      user_id: actor.id,
      event_type: 'listing.created',
      entity_type: 'listing',
      entity_id: listingId,
      office_id: actor.officeId ?? undefined,
      payload: { status: 'draft' },
      ip,
      clock,
      knex: trx,
    });

    // Write audit_log inside the transaction for atomicity
    await appendAuditEvent({
      actor_id: actor.id,
      actor_role: actor.role,
      action: 'listing.create',
      entity_type: 'listing',
      entity_id: String(listing.id),
      after_json: { status: 'draft', office_id: actor.officeId },
      ip,
    }, clock, trx);
  });

  return listing;
}

// ─── getListing ───────────────────────────────────────────────────────────────

export async function getListing(
  id: number,
  actor: Actor,
  knexOrIp?: KnexType | string,
  clockOrKnex?: Clock | KnexType,
  maybeClock?: Clock,
): Promise<Listing> {
  // Overloaded: getListing(id, actor, knex?) or getListing(id, actor, ip, knex?, clock?)
  let ip: string | undefined;
  let knex: KnexType;
  let clock: Clock;
  if (typeof knexOrIp === 'string') {
    ip = knexOrIp;
    knex = (clockOrKnex as KnexType | undefined) ?? defaultKnex;
    clock = maybeClock ?? systemClock;
  } else {
    ip = undefined;
    knex = knexOrIp ?? defaultKnex;
    clock = (clockOrKnex as Clock | undefined) ?? systemClock;
  }
  const rawRow = await knex('listings').where({ id }).whereNull('soft_deleted_at').first<Record<string, unknown> | undefined>();
  if (!rawRow) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Listing not found', 404);
  }

  const listing = rowToListing(rawRow);

  if (!canScopeSee(actor, listing)) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Listing not found', 404);
  }

  // Emit listing.view event for engagement KPI tracking (non-blocking)
  try {
    await logEvent({
      user_id: actor.id,
      event_type: 'listing.view',
      entity_type: 'listing',
      entity_id: id,
      office_id: listing.office_id,
      payload: {},
      ip: ip ?? '',
      clock,
      knex,
    });
  } catch {
    // Non-blocking: view tracking failure should not break the read path
  }

  return maskCoordinates(listing, actor);
}

// ─── listListings ─────────────────────────────────────────────────────────────

export interface ListFilters {
  office_id?: number;
  agent_id?: number;
  status?: string;
  beds_min?: number;
  beds_max?: number;
  price_min?: number;
  price_max?: number;
  area_min?: number;
  area_max?: number;
  city?: string;
  state_code?: string;
  updated_since?: string;
  q?: string;
}

export interface ListPagination {
  cursor?: string;
  limit: number;
}

export async function listListings(
  actor: Actor,
  filters: ListFilters,
  pagination: ListPagination,
  knex: KnexType = defaultKnex,
): Promise<{ items: Listing[]; nextCursor: string | null }> {
  const limit = Math.min(pagination.limit || 25, 100);

  let query = knex('listings').whereNull('soft_deleted_at');

  // Scope enforcement
  if (actor.role === 'regular_user') {
    query = query.where(function () {
      this.where('created_by', actor.id).orWhere('status', 'published');
    });
  } else if (actor.role === 'merchant') {
    query = query.where(function () {
      this.where('office_id', actor.officeId ?? -1).orWhere('status', 'published');
    });
  }
  // operations/administrator: see all

  // Filters
  if (filters.office_id !== undefined) query = query.where('office_id', filters.office_id);
  if (filters.agent_id !== undefined) query = query.where('created_by', filters.agent_id);
  if (filters.status !== undefined) query = query.where('status', filters.status);
  if (filters.beds_min !== undefined) query = query.where('beds', '>=', filters.beds_min);
  if (filters.beds_max !== undefined) query = query.where('beds', '<=', filters.beds_max);
  if (filters.price_min !== undefined) query = query.where('price_usd_cents', '>=', filters.price_min);
  if (filters.price_max !== undefined) query = query.where('price_usd_cents', '<=', filters.price_max);
  if (filters.area_min !== undefined) query = query.where('area_sqft', '>=', filters.area_min);
  if (filters.area_max !== undefined) query = query.where('area_sqft', '<=', filters.area_max);
  if (filters.city !== undefined) query = query.whereRaw('LOWER(city) = ?', [filters.city.toLowerCase()]);
  if (filters.state_code !== undefined) query = query.where('state_code', filters.state_code.toUpperCase());
  if (filters.updated_since !== undefined) query = query.where('updated_at', '>=', filters.updated_since);

  // Full-text search
  if (filters.q) {
    const sqlite = isSQLite(knex);
    if (sqlite) {
      // Fall back to LIKE for SQLite
      const q = `%${filters.q}%`;
      query = query.where(function () {
        this.where('address_line', 'like', q)
          .orWhere('city', 'like', q)
          .orWhere('layout_normalized', 'like', q);
      });
    } else {
      query = query.whereRaw(
        'MATCH(address_line, city, layout_normalized) AGAINST(? IN BOOLEAN MODE)',
        [filters.q],
      );
    }
  }

  // Cursor-based pagination (updated_at DESC)
  if (pagination.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(pagination.cursor, 'base64').toString('utf8')) as { updated_at: string; id: number };
      query = query.where(function () {
        this.where('updated_at', '<', cursor.updated_at)
          .orWhere(function () {
            this.where('updated_at', '=', cursor.updated_at).where('id', '<', cursor.id);
          });
      });
    } catch {
      // Invalid cursor, ignore
    }
  }

  query = query.orderBy('updated_at', 'desc').orderBy('id', 'desc').limit(limit + 1);

  const rows = await query.select<Record<string, unknown>[]>('*');
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    const cursorData = {
      updated_at: last.updated_at instanceof Date
        ? formatDatetime(last.updated_at as Date)
        : String(last.updated_at),
      id: Number(last.id),
    };
    nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64');
  }

  return {
    items: items.map(rowToListing).map((l) => maskCoordinates(l, actor)),
    nextCursor,
  };
}

// ─── updateListing ────────────────────────────────────────────────────────────

export async function updateListing(
  id: number,
  actor: Actor,
  input: UpdateListingInput,
  ifMatchVersion: number,
  ip: string,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<Listing> {
  const settings = await getSettings(knex);

  let listing!: Listing;

  await knex.transaction(async (trx) => {
    const rawRow = await trx('listings').where({ id }).whereNull('soft_deleted_at').first<Record<string, unknown> | undefined>();
    if (!rawRow) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Listing not found', 404);
    }

    const existingListing = rowToListing(rawRow);

    if (!canScopeSee(actor, existingListing)) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Listing not found', 404);
    }

    // Operations role cannot edit listings per capability matrix
    if (actor.role === 'operations') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Operations role cannot edit listings', 403);
    }

    // Status check: only draft editable by regular_user/merchant; admin can edit any non-deleted
    if (actor.role === 'regular_user' || actor.role === 'merchant') {
      if (existingListing.status !== 'draft') {
        throw new AppError(ErrorCodes.FORBIDDEN, 'Only draft listings can be edited', 403);
      }
    }

    // Optimistic lock
    if (existingListing.version !== ifMatchVersion) {
      throw new AppError(ErrorCodes.VERSION_CONFLICT, 'Version conflict: listing has been modified', 409);
    }

    const { cleaned, anomalyFlags, errors } = cleanseListingInput(input, settings);
    if (errors.length > 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Validation failed', 400, { errors });
    }

    // Compute diff
    const diff: Record<string, { from: unknown; to: unknown }> = {};

    const applyField = (field: keyof Listing, newVal: unknown): void => {
      const oldVal = existingListing[field];
      if (newVal !== undefined && newVal !== oldVal) {
        diff[field] = { from: oldVal, to: newVal };
      }
    };

    if (cleaned.price_usd_cents !== undefined) applyField('price_usd_cents', cleaned.price_usd_cents);
    if (cleaned.area_sqft !== undefined) applyField('area_sqft', cleaned.area_sqft);
    if (cleaned.area_sqm !== undefined) applyField('area_sqm', cleaned.area_sqm);
    if (cleaned.beds !== undefined) applyField('beds', cleaned.beds);
    if (cleaned.baths !== undefined) applyField('baths', cleaned.baths);
    if (cleaned.floor_level !== undefined) applyField('floor_level', cleaned.floor_level);
    if (cleaned.orientation !== undefined) applyField('orientation', cleaned.orientation);
    if (cleaned.latitude !== undefined) applyField('latitude', cleaned.latitude);
    if (cleaned.longitude !== undefined) applyField('longitude', cleaned.longitude);
    if (cleaned.address_line !== undefined) applyField('address_line', cleaned.address_line);
    if (cleaned.city !== undefined) applyField('city', cleaned.city);
    if (cleaned.state_code !== undefined) applyField('state_code', cleaned.state_code);
    if (cleaned.postal_code !== undefined) applyField('postal_code', cleaned.postal_code);
    if (cleaned.layout_normalized !== undefined) applyField('layout_normalized', cleaned.layout_normalized);

    const now = clock.now();
    const nowStr = formatDatetime(now);
    const newVersion = existingListing.version + 1;

    const updateObj: Record<string, unknown> = {
      version: newVersion,
      updated_at: nowStr,
      anomaly_flags: JSON.stringify(anomalyFlags),
    };

    if (cleaned.price_usd_cents !== undefined) updateObj.price_usd_cents = cleaned.price_usd_cents;
    if (cleaned.area_sqft !== undefined) updateObj.area_sqft = cleaned.area_sqft;
    if (cleaned.area_sqm !== undefined) updateObj.area_sqm = cleaned.area_sqm;
    if (cleaned.beds !== undefined) updateObj.beds = cleaned.beds;
    if (cleaned.baths !== undefined && cleaned.baths !== null) updateObj.baths = cleaned.baths * 2;
    if (cleaned.floor_level !== undefined) updateObj.floor_level = cleaned.floor_level;
    if (cleaned.orientation !== undefined) updateObj.orientation = cleaned.orientation;
    if (cleaned.latitude !== undefined) updateObj.latitude = cleaned.latitude;
    if (cleaned.longitude !== undefined) updateObj.longitude = cleaned.longitude;
    if (cleaned.address_line !== undefined) updateObj.address_line = cleaned.address_line;
    if (cleaned.city !== undefined) updateObj.city = cleaned.city;
    if (cleaned.state_code !== undefined) updateObj.state_code = cleaned.state_code;
    if (cleaned.postal_code !== undefined) updateObj.postal_code = cleaned.postal_code;
    if (cleaned.layout_normalized !== undefined) updateObj.layout_normalized = cleaned.layout_normalized;

    await trx('listings').where({ id }).update(updateObj);

    const updatedRaw = await trx('listings').where({ id }).first<Record<string, unknown>>();
    listing = rowToListing(updatedRaw);

    // Write revision
    await trx('listing_revisions').insert({
      listing_id: id,
      version: newVersion,
      payload_json: JSON.stringify({ ...updatedRaw, baths: listing.baths, anomaly_flags: listing.anomaly_flags }),
      diff_json: JSON.stringify(diff),
      actor_id: actor.id,
      created_at: nowStr,
    });

    // Write event_log
    await logEvent({
      user_id: actor.id,
      event_type: 'listing.updated',
      entity_type: 'listing',
      entity_id: id,
      office_id: existingListing.office_id,
      payload: { version: newVersion },
      ip,
      clock,
      knex: trx,
    });

    // Write audit_log inside the transaction for atomicity
    await appendAuditEvent({
      actor_id: actor.id,
      actor_role: actor.role,
      action: 'listing.update',
      entity_type: 'listing',
      entity_id: String(id),
      before_json: { version: listing.version - 1 },
      after_json: { version: listing.version },
      ip,
    }, clock, trx);
  });

  return listing;
}

// ─── transitionStatus ─────────────────────────────────────────────────────────

export async function transitionStatus(
  id: number,
  actor: Actor,
  to: string,
  reason: string | undefined,
  overrideReason: string | undefined,
  ip: string,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<Listing> {
  let listing!: Listing;
  let fromStatus!: ListingStatus;

  await knex.transaction(async (trx) => {
    // A3: SELECT FOR UPDATE on MySQL to prevent concurrent modifications
    let rawRow: Record<string, unknown> | undefined;
    if (isSQLite(knex)) {
      rawRow = await trx('listings').where({ id }).whereNull('soft_deleted_at').first<Record<string, unknown> | undefined>();
    } else {
      const result = await trx.raw(
        'SELECT * FROM listings WHERE id = ? AND soft_deleted_at IS NULL LIMIT 1 FOR UPDATE',
        [id],
      ) as [Array<Record<string, unknown>>, unknown];
      rawRow = result[0]?.[0];
    }

    if (!rawRow) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Listing not found', 404);
    }

    const existingListing = rowToListing(rawRow);

    if (!canScopeSee(actor, existingListing)) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Listing not found', 404);
    }

    // A3: Re-read current status inside transaction (the FOR UPDATE guarantees freshness)
    fromStatus = existingListing.status;

    const result = canTransition(fromStatus, to as ListingStatus, {
      actor: { id: actor.id, role: actor.role, officeId: actor.officeId },
      listing: {
        id: existingListing.id,
        office_id: existingListing.office_id,
        status: fromStatus,
        anomaly_flags: existingListing.anomaly_flags,
        created_by: existingListing.created_by,
      },
      reason,
      overrideReason,
    });

    if (!result.allowed) {
      throw new AppError(ErrorCodes.ILLEGAL_TRANSITION, result.error ?? 'Transition not allowed', 422);
    }

    // A2: Publish gate — verify required fields when transitioning to 'published'
    if (to === 'published') {
      const requiredFields: Array<keyof Listing> = [
        'price_usd_cents',
        'area_sqft',
        'beds',
        'baths',
        'address_line',
        'state_code',
        'postal_code',
      ];
      const missingFields = requiredFields.filter((f) => {
        const val = existingListing[f];
        return val === null || val === undefined;
      });
      if (missingFields.length > 0) {
        throw new AppError(
          ErrorCodes.VALIDATION_ERROR,
          'Listing is missing required fields for publishing',
          400,
          { fields: missingFields },
        );
      }
    }

    // Determine actual DB status: 'rejected' maps to 'draft'
    const dbStatus: ListingStatus = to === 'rejected' ? 'draft' : to as ListingStatus;

    const now = clock.now();
    const nowStr = formatDatetime(now);

    const updateObj: Record<string, unknown> = {
      status: dbStatus,
      updated_at: nowStr,
    };

    if (dbStatus === 'published') {
      updateObj.published_at = nowStr;
    }

    await trx('listings').where({ id }).update(updateObj);

    const updatedRaw = await trx('listings').where({ id }).first<Record<string, unknown>>();
    listing = rowToListing(updatedRaw);

    // Write listing_status_history
    await trx('listing_status_history').insert({
      listing_id: id,
      from_status: fromStatus,
      to_status: to,
      actor_id: actor.id,
      reason: reason ?? null,
      created_at: nowStr,
      ip: ip ?? null,
    });

    // Write event_log
    const eventType = `listing.${to === 'rejected' ? 'rejected' : dbStatus}`;
    await logEvent({
      user_id: actor.id,
      event_type: eventType,
      entity_type: 'listing',
      entity_id: id,
      office_id: existingListing.office_id,
      payload: { from: fromStatus, to },
      ip,
      clock,
      knex: trx,
    });

    // Write audit_log inside the transaction for atomicity
    await appendAuditEvent({
      actor_id: actor.id,
      actor_role: actor.role,
      action: 'listing.status_transition',
      entity_type: 'listing',
      entity_id: String(id),
      before_json: { status: fromStatus },
      after_json: { status: to, reason: reason ?? null, overrideReason: overrideReason ?? null },
      ip,
    }, clock, trx);
  });

  return listing;
}

// ─── softDeleteListing ────────────────────────────────────────────────────────

export async function softDeleteListing(
  id: number,
  actor: Actor,
  ip: string,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<void> {
  // Capture pre-delete state outside the transaction for the audit log
  let preDeleteStatus = '';
  let preDeleteOfficeId: number | null = null;

  await knex.transaction(async (trx) => {
    const rawRow = await trx('listings').where({ id }).whereNull('soft_deleted_at').first<Record<string, unknown> | undefined>();
    if (!rawRow) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Listing not found', 404);
    }

    const existingListing = rowToListing(rawRow);
    preDeleteStatus = existingListing.status;
    preDeleteOfficeId = existingListing.office_id;

    if (!canScopeSee(actor, existingListing)) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Listing not found', 404);
    }

    const result = canTransition(existingListing.status, 'deleted', {
      actor: { id: actor.id, role: actor.role, officeId: actor.officeId },
      listing: {
        id: existingListing.id,
        office_id: existingListing.office_id,
        status: existingListing.status,
        anomaly_flags: existingListing.anomaly_flags,
        created_by: existingListing.created_by,
      },
    });

    if (!result.allowed) {
      throw new AppError(ErrorCodes.ILLEGAL_TRANSITION, result.error ?? 'Cannot delete listing', 422);
    }

    const now = clock.now();
    const nowStr = formatDatetime(now);

    await trx('listings').where({ id }).update({
      status: 'deleted',
      soft_deleted_at: nowStr,
      updated_at: nowStr,
    });

    // Write status history
    await trx('listing_status_history').insert({
      listing_id: id,
      from_status: existingListing.status,
      to_status: 'deleted',
      actor_id: actor.id,
      reason: null,
      created_at: nowStr,
      ip: ip ?? null,
    });

    // Event
    await logEvent({
      user_id: actor.id,
      event_type: 'listing.deleted',
      entity_type: 'listing',
      entity_id: id,
      office_id: existingListing.office_id,
      payload: { from: existingListing.status },
      ip,
      clock,
      knex: trx,
    });

    // Write audit_log inside the transaction for atomicity
    await appendAuditEvent({
      actor_id: actor.id,
      actor_role: actor.role,
      action: 'listing.delete',
      entity_type: 'listing',
      entity_id: String(id),
      before_json: { status: preDeleteStatus, office_id: preDeleteOfficeId },
      after_json: { status: 'deleted', soft_deleted: true },
      ip,
    }, clock, trx);
  });
}

// ─── restoreListing ───────────────────────────────────────────────────────────

export async function restoreListing(
  id: number,
  actor: Actor,
  ip: string,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<Listing> {
  let listing!: Listing;

  await knex.transaction(async (trx) => {
    // Include soft-deleted
    const rawRow = await trx('listings').where({ id }).first<Record<string, unknown> | undefined>();
    if (!rawRow) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Listing not found', 404);
    }

    const existingListing = rowToListing(rawRow);

    if (existingListing.status !== 'deleted' || !existingListing.soft_deleted_at) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Listing is not deleted', 400);
    }

    // Check within 90 days
    const now = clock.now();
    const deletedAt = existingListing.soft_deleted_at;
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    if (now.getTime() - deletedAt.getTime() > ninetyDaysMs) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Listing cannot be restored after 90 days', 400);
    }

    const result = canTransition('deleted', 'draft', {
      actor: { id: actor.id, role: actor.role, officeId: actor.officeId },
      listing: {
        id: existingListing.id,
        office_id: existingListing.office_id,
        status: 'deleted',
        anomaly_flags: existingListing.anomaly_flags,
        created_by: existingListing.created_by,
      },
    });

    if (!result.allowed) {
      throw new AppError(ErrorCodes.FORBIDDEN, result.error ?? 'Cannot restore listing', 403);
    }

    const nowStr = formatDatetime(now);

    await trx('listings').where({ id }).update({
      status: 'draft',
      soft_deleted_at: null,
      updated_at: nowStr,
    });

    const updatedRaw = await trx('listings').where({ id }).first<Record<string, unknown>>();
    listing = rowToListing(updatedRaw);

    // Write status history
    await trx('listing_status_history').insert({
      listing_id: id,
      from_status: 'deleted',
      to_status: 'draft',
      actor_id: actor.id,
      reason: 'restored',
      created_at: nowStr,
      ip: ip ?? null,
    });

    // Event
    await logEvent({
      user_id: actor.id,
      event_type: 'listing.restored',
      entity_type: 'listing',
      entity_id: id,
      office_id: existingListing.office_id,
      payload: {},
      ip,
      clock,
      knex: trx,
    });

    // Write audit_log inside the transaction for atomicity
    await appendAuditEvent({
      actor_id: actor.id,
      actor_role: actor.role,
      action: 'listing.restore',
      entity_type: 'listing',
      entity_id: String(id),
      before_json: { status: 'deleted' },
      after_json: { status: 'draft' },
      ip,
    }, clock, trx);
  });

  return listing;
}

// ─── getRevisions ─────────────────────────────────────────────────────────────

export async function getRevisions(
  id: number,
  actor: Actor,
  knex: KnexType = defaultKnex,
): Promise<Array<{ id: number; revision_no: number; action: string; actor_id: number; created_at: Date; diff_json: unknown }>> {
  // Load listing (include soft deleted for revision access)
  const rawRow = await knex('listings').where({ id }).first<Record<string, unknown> | undefined>();
  if (!rawRow) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Listing not found', 404);
  }

  const listing = rowToListing(rawRow);

  // Access: merchant own_office, admin, or owner
  if (actor.role !== 'administrator' && actor.role !== 'operations') {
    if (actor.role === 'merchant') {
      if (actor.officeId === null || actor.officeId !== listing.office_id) {
        throw new AppError(ErrorCodes.FORBIDDEN, 'Not authorized to view revisions', 403);
      }
    } else {
      // regular_user: must be owner
      if (listing.created_by !== actor.id) {
        throw new AppError(ErrorCodes.FORBIDDEN, 'Not authorized to view revisions', 403);
      }
    }
  }

  // Fetch data revisions
  const revisions = await knex('listing_revisions')
    .where({ listing_id: id })
    .orderBy('version', 'asc')
    .select<Array<{ id: number; version: number; actor_id: number; created_at: string | Date; diff_json: string | null }>>([
      'id', 'version', 'actor_id', 'created_at', 'diff_json',
    ]);

  // Fetch status transitions
  const statusHistory = await knex('listing_status_history')
    .where({ listing_id: id })
    .orderBy('created_at', 'asc')
    .select<Array<{ id: number; from_status: string | null; to_status: string; actor_id: number; created_at: string | Date; reason: string | null }>>([
      'id', 'from_status', 'to_status', 'actor_id', 'created_at', 'reason',
    ]);

  // Build unified timeline
  type TimelineEntry = {
    source: 'revision' | 'status';
    created_at: Date;
    id: number;
    actor_id: number;
    action: string;
    diff_json: unknown;
  };

  const timeline: TimelineEntry[] = [];

  for (const r of revisions) {
    const action = Number(r.version) === 1 ? 'created' : 'updated';
    timeline.push({
      source: 'revision',
      created_at: parseDbDate(r.created_at) ?? new Date(),
      id: Number(r.id),
      actor_id: Number(r.actor_id),
      action,
      diff_json: r.diff_json ? (typeof r.diff_json === 'string' ? JSON.parse(r.diff_json) : r.diff_json) : null,
    });
  }

  for (const sh of statusHistory) {
    // Skip the initial draft entry — already covered by revision v1 "created"
    if (sh.from_status === null && sh.to_status === 'draft') continue;

    const action = sh.to_status === 'rejected'
      ? 'rejected'
      : sh.to_status;
    timeline.push({
      source: 'status',
      created_at: parseDbDate(sh.created_at) ?? new Date(),
      id: Number(sh.id),
      actor_id: Number(sh.actor_id),
      action,
      diff_json: sh.reason ? { reason: sh.reason } : null,
    });
  }

  // Sort by created_at ascending
  timeline.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

  return timeline.map((entry, idx) => ({
    id: entry.id,
    revision_no: idx + 1,
    action: entry.action,
    actor_id: entry.actor_id,
    created_at: entry.created_at,
    diff_json: entry.diff_json,
  }));
}
