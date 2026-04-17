import { Knex as KnexType } from 'knex';
import { v4 as uuid } from 'uuid';
import { Attachment, AttachmentPublic, AttachmentRejection } from '../types/attachment';
import { validateAttachment, RejectionCode } from './attachmentValidator';
import { processImage } from './imageProcessor';
import { sha256Hex } from './sha256';
import { StorageRepository, storageRepository } from '../storage/repository';
import { logEvent } from './eventLog';
import { appendAuditEvent } from '../audit/chain';
import { AppError, ErrorCodes } from '../errors';
import { Clock, systemClock } from '../clock';
import defaultKnex from '../db/knex';
import { logger } from '../logger';

export interface UploadResult {
  attachment: Attachment;
  duplicate: boolean;
  rejected?: false;
}

export interface RejectedResult {
  rejected: true;
  rejectionCode: RejectionCode;
  rejectionDetail?: string;
}

interface Actor {
  id: number;
  role: string;
  officeId: number | null;
}

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

function safeFilename(filename: string): string {
  return filename.replace(/\.\./g, '_').replace(/[/\\]/g, '_');
}

/**
 * Strip internal storage metadata before returning to API clients.
 *
 * The full `Attachment` record carries implementation details the UI does
 * not need — storage_key, sha256, created_by, and current_revision_id.
 * Published listings are readable by broad authenticated users, so these
 * must not travel through attachment list / upload / replace responses.
 * Privileged internal flows (rollback, orphan sweep, admin purge) keep
 * using the full `Attachment` type directly.
 */
export function toPublicAttachment(att: Attachment): AttachmentPublic {
  return {
    id: att.id,
    listing_id: att.listing_id,
    kind: att.kind,
    original_filename: att.original_filename,
    bytes: att.bytes,
    mime: att.mime,
    width: att.width,
    height: att.height,
    duration_seconds: att.duration_seconds,
    created_at: att.created_at,
  };
}

function rowToAttachment(row: Record<string, unknown>): Attachment {
  return {
    id: Number(row.id),
    listing_id: Number(row.listing_id),
    kind: row.kind as 'image' | 'video' | 'pdf',
    original_filename: String(row.original_filename),
    storage_key: String(row.storage_key),
    sha256: String(row.sha256),
    bytes: Number(row.bytes),
    mime: String(row.mime),
    width: row.width !== null && row.width !== undefined ? Number(row.width) : null,
    height: row.height !== null && row.height !== undefined ? Number(row.height) : null,
    duration_seconds:
      row.duration_seconds !== null && row.duration_seconds !== undefined
        ? Number(row.duration_seconds)
        : null,
    created_by: Number(row.created_by),
    created_at: parseDbDate(row.created_at as Date | string) ?? new Date(),
    current_revision_id:
      row.current_revision_id !== null && row.current_revision_id !== undefined
        ? Number(row.current_revision_id)
        : null,
    soft_deleted_at: parseDbDate(row.soft_deleted_at as Date | string | null),
  };
}

async function checkListingAccess(
  listingId: number,
  actor: Actor,
  knex: KnexType,
): Promise<Record<string, unknown>> {
  const listing = await knex('listings')
    .where({ id: listingId })
    .whereNull('soft_deleted_at')
    .first<Record<string, unknown>>();

  if (!listing) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Listing not found', 404);
  }

  return listing;
}

function canWrite(actor: Actor, listing: Record<string, unknown>): boolean {
  // operations role cannot upload or modify attachments per capability matrix
  if (actor.role === 'administrator') return true;
  if (actor.role === 'merchant') {
    return actor.officeId !== null && actor.officeId === Number(listing.office_id);
  }
  // regular_user: own drafts only (PRD §8.15)
  return Number(listing.created_by) === actor.id && String(listing.status) === 'draft';
}

function canRead(actor: Actor, listing: Record<string, unknown>): boolean {
  if (actor.role === 'administrator' || actor.role === 'operations') return true;
  if (String(listing.status) === 'published') return true;
  if (actor.role === 'merchant') {
    return actor.officeId !== null && actor.officeId === Number(listing.office_id);
  }
  return Number(listing.created_by) === actor.id;
}

export async function uploadAttachment(
  params: {
    listingId: number;
    actor: Actor;
    file: { buffer: Buffer; originalname: string; size: number };
    ip: string;
  },
  storage: StorageRepository = storageRepository,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<UploadResult | RejectedResult> {
  const { listingId, actor, file, ip } = params;
  const now = clock.now();
  const nowStr = formatDatetime(now);

  // Step 1: Load listing + check access
  const listing = await checkListingAccess(listingId, actor, knex);
  if (!canWrite(actor, listing)) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied to listing', 403);
  }

  // Step 2: Count existing non-deleted attachments
  const countResult = await knex('attachments')
    .where({ listing_id: listingId })
    .whereNull('soft_deleted_at')
    .count<[{ count: string | number }]>('* as count')
    .first();
  const existingCount = Number(countResult?.count ?? 0);

  // Step 3: Validate
  const validationResult = await validateAttachment(file.buffer, file.originalname, existingCount);

  if (!validationResult.valid) {
    // Insert rejection record
    await knex('attachment_rejections').insert({
      listing_id: listingId,
      filename: file.originalname,
      reason_code: validationResult.rejectionCode,
      reason_detail: validationResult.rejectionDetail ?? null,
      actor_id: actor.id,
      created_at: nowStr,
    });

    return {
      rejected: true,
      rejectionCode: validationResult.rejectionCode!,
      rejectionDetail: validationResult.rejectionDetail,
    };
  }

  const kind = validationResult.kind!;

  // Step 4: Process image if kind='image'
  // Preserve original binary for revision 1 (PRD requirement: "Preserve original in revision 1")
  const originalBuffer = file.buffer;
  const originalBytes = file.size;
  const originalHash = sha256Hex(originalBuffer);

  let processedBuffer = file.buffer;
  let width: number | null = null;
  let height: number | null = null;
  let mime = '';
  let bytes = file.size;

  if (kind === 'image') {
    const processed = await processImage(file.buffer, mime || 'image/jpeg');
    processedBuffer = processed.buffer;
    width = processed.width;
    height = processed.height;
    mime = processed.mime;
    bytes = processed.bytes;
  } else if (kind === 'video') {
    mime = 'video/mp4';
  } else if (kind === 'pdf') {
    mime = 'application/pdf';
  }

  // Step 5: Compute sha256 — use original hash for dedup (same original = same upload)
  const hash = originalHash;

  // Step 6: Check dedup
  const existing = await knex('attachments')
    .where({ listing_id: listingId, sha256: hash })
    .whereNull('soft_deleted_at')
    .first<Record<string, unknown>>();

  if (existing) {
    // Record duplicate in attachment_rejections for audit trail
    await knex('attachment_rejections').insert({
      listing_id: listingId,
      filename: file.originalname,
      reason_code: 'duplicate',
      reason_detail: `Duplicate of attachment #${existing.id} (sha256: ${hash})`,
      actor_id: actor.id,
      created_at: nowStr,
    });

    return { attachment: rowToAttachment(existing), duplicate: true };
  }

  // Step 7: Generate temporary storage keys
  const tmpId = uuid();
  const tmpKey = `listings/${listingId}/attachments/tmp_${tmpId}/${safeFilename(file.originalname)}`;

  // Step 8: Write processed buffer to storage (for serving as current content)
  await storage.write(tmpKey, processedBuffer);

  // Step 9: DB transaction
  let attachment!: Attachment;

  await knex.transaction(async (trx) => {
    // a. INSERT attachments row — sha256 uses original hash for consistent dedup
    const [attachmentId] = await trx('attachments').insert({
      listing_id: listingId,
      kind,
      original_filename: file.originalname,
      storage_key: tmpKey,
      sha256: hash,
      bytes,
      mime,
      width,
      height,
      duration_seconds: null,
      created_by: actor.id,
      created_at: nowStr,
      current_revision_id: null,
      soft_deleted_at: null,
    });

    const attId = Number(attachmentId);

    // b. INSERT attachment_revisions row (revision_no=1) — stores ORIGINAL binary (PRD requirement)
    const origKey = `listings/${listingId}/attachments/${attId}/rev_1/original_${safeFilename(file.originalname)}`;
    await storage.write(origKey, originalBuffer);

    const [revisionId] = await trx('attachment_revisions').insert({
      attachment_id: attId,
      revision_no: 1,
      storage_key: origKey,
      sha256: originalHash,
      bytes: originalBytes,
      pruned: 0,
      created_by: actor.id,
      created_at: nowStr,
    });

    // c. UPDATE attachments with real key + current_revision_id
    const realKey = `listings/${listingId}/attachments/${attId}/rev_1/${safeFilename(file.originalname)}`;
    await trx('attachments').where({ id: attId }).update({
      current_revision_id: Number(revisionId),
      storage_key: realKey,
    });

    // Move processed blob to real key, delete tmp
    await storage.write(realKey, processedBuffer);
    await storage.delete(tmpKey);

    // Revision 1 retains its original-binary storage key (origKey) — do NOT override it.

    // d. Write event_log (inside transaction so it rolls back on failure)
    await logEvent({
      user_id: actor.id,
      event_type: 'attachment.uploaded',
      entity_type: 'attachment',
      entity_id: attId,
      office_id: actor.officeId ?? undefined,
      payload: { listing_id: listingId, kind, filename: file.originalname },
      ip,
      clock,
      knex: trx,
    });

    const rawRow = await trx('attachments').where({ id: attId }).first<Record<string, unknown>>();
    attachment = rowToAttachment(rawRow);

    // Write audit_log inside the transaction for atomicity
    await appendAuditEvent(
      {
        actor_id: actor.id,
        actor_role: actor.role,
        action: 'attachment.upload',
        entity_type: 'attachment',
        entity_id: String(attId),
        after_json: { listing_id: listingId, kind, sha256: hash },
        ip,
      },
      clock,
      trx,
    );
  });

  return { attachment, duplicate: false };
}

export async function getAttachments(
  listingId: number,
  actor: Actor,
  knex: KnexType = defaultKnex,
): Promise<Attachment[]> {
  const listing = await checkListingAccess(listingId, actor, knex);
  if (!canRead(actor, listing)) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
  }

  const rows = await knex('attachments')
    .where({ listing_id: listingId })
    .whereNull('soft_deleted_at')
    .orderBy('id', 'asc')
    .select<Record<string, unknown>[]>();

  return rows.map(rowToAttachment);
}

/**
 * Public view of an attachment revision returned to clients. Internal storage
 * metadata (storage_key, sha256, bytes, creator id) is intentionally omitted —
 * those are only used by the rollback path and should not leak through the
 * revisions endpoint, which is scoped to rollback-capable roles only.
 */
export interface AttachmentRevisionView {
  id: number;
  attachment_id: number;
  revision_no: number;
  pruned: boolean;
  created_at: Date;
}

function rowToRevisionView(row: Record<string, unknown>): AttachmentRevisionView {
  return {
    id: Number(row.id),
    attachment_id: Number(row.attachment_id),
    revision_no: Number(row.revision_no),
    pruned: Boolean(row.pruned),
    created_at: parseDbDate(row.created_at as Date | string) ?? new Date(),
  };
}

/**
 * Authorization for the revisions endpoint matches the rollback capability
 * boundary in PRD §10: only merchant (own_office) and administrator may see
 * the revision history. Operations and regular users — even on published
 * listings — are denied to avoid leaking internal revision metadata.
 */
function canViewRevisions(actor: Actor, listing: Record<string, unknown>): boolean {
  if (actor.role === 'administrator') return true;
  if (actor.role === 'merchant') {
    return actor.officeId !== null && actor.officeId === Number(listing.office_id);
  }
  return false;
}

export async function getRevisions(
  attachmentId: number,
  actor: Actor,
  knex: KnexType = defaultKnex,
): Promise<AttachmentRevisionView[]> {
  const attachment = await knex('attachments')
    .where({ id: attachmentId })
    .first<Record<string, unknown>>();

  if (!attachment) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found', 404);
  }

  const listing = await checkListingAccess(Number(attachment.listing_id), actor, knex);
  if (!canViewRevisions(actor, listing)) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
  }

  const rows = await knex('attachment_revisions')
    .where({ attachment_id: attachmentId, pruned: 0 })
    .orderBy('revision_no', 'desc')
    .limit(5)
    .select<Record<string, unknown>[]>();

  return rows.map(rowToRevisionView);
}

export async function rollbackAttachment(
  attachmentId: number,
  revisionNo: number,
  actor: Actor,
  ip: string,
  knex: KnexType = defaultKnex,
  storage: StorageRepository = storageRepository,
  clock: Clock = systemClock,
): Promise<Attachment> {
  const now = clock.now();
  const nowStr = formatDatetime(now);

  const attachment = await knex('attachments')
    .where({ id: attachmentId })
    .first<Record<string, unknown>>();

  if (!attachment) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found', 404);
  }

  const listingId = Number(attachment.listing_id);
  const listing = await checkListingAccess(listingId, actor, knex);

  // Scope check: administrator, or merchant scoped to the listing's office.
  // Operations is explicitly denied here — it used to be silently allowed
  // at the service layer while the route blocked it, which meant any future
  // internal caller bypassing the route check would accidentally grant
  // operations a merchant/admin-only capability. Defense-in-depth: the
  // policy is enforced at BOTH the route and the service.
  if (actor.role === 'administrator') {
    // allowed
  } else if (actor.role === 'merchant' && actor.officeId === Number(listing.office_id)) {
    // allowed (own office)
  } else {
    throw new AppError(
      ErrorCodes.FORBIDDEN,
      'Only merchant (own office) or administrator can rollback attachments',
      403,
    );
  }

  // Load target revision (which preserves the ORIGINAL binary per upload contract)
  const targetRevision = await knex('attachment_revisions')
    .where({ attachment_id: attachmentId, revision_no: revisionNo, pruned: 0 })
    .first<Record<string, unknown>>();

  if (!targetRevision) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Revision not found or pruned', 404);
  }

  // ── PRD-mandated rollback contract ───────────────────────────────────────
  // The target revision stores the *original* binary. To produce a valid
  // current asset we must re-run the image pipeline (2048px max long edge,
  // 85% re-encode, EXIF strip) so the live attachment stays consistent
  // with the upload contract — including width/height/mime metadata.
  // ─────────────────────────────────────────────────────────────────────────
  const kind = String(attachment.kind) as 'image' | 'video' | 'pdf';
  const originalFilename = String(attachment.original_filename);
  const originalKey = String(targetRevision.storage_key);
  const originalSha256 = String(targetRevision.sha256);
  const originalBytes = Number(targetRevision.bytes);

  // Read the preserved original from storage
  const originalBuffer = await storage.read(originalKey);

  // Reprocess for images, otherwise use original as-is
  let processedBuffer: Buffer = originalBuffer;
  let newMime: string = String(attachment.mime);
  let newWidth: number | null = attachment.width !== null && attachment.width !== undefined
    ? Number(attachment.width) : null;
  let newHeight: number | null = attachment.height !== null && attachment.height !== undefined
    ? Number(attachment.height) : null;
  let newProcessedBytes: number = originalBytes;

  if (kind === 'image') {
    // Best-effort original mime detection from filename (drives webp vs jpeg output)
    const lower = originalFilename.toLowerCase();
    const inputMime = lower.endsWith('.webp')
      ? 'image/webp'
      : lower.endsWith('.png')
        ? 'image/png'
        : 'image/jpeg';
    const processed = await processImage(originalBuffer, inputMime);
    processedBuffer = processed.buffer;
    newMime = processed.mime;
    newWidth = processed.width;
    newHeight = processed.height;
    newProcessedBytes = processed.bytes;
  }

  let updatedAttachment!: Attachment;

  await knex.transaction(async (trx) => {
    // Get max revision_no
    const maxResult = await trx('attachment_revisions')
      .where({ attachment_id: attachmentId })
      .max<[{ maxRev: number | null }]>('revision_no as maxRev')
      .first();
    const newRevisionNo = (maxResult?.maxRev ?? 0) + 1;

    // Persist a fresh copy of the original under the new revision folder so the
    // revision row continues to satisfy the "preserve original" contract even
    // when the older revision row is later pruned.
    const safeName = safeFilename(originalFilename);
    const newOriginalKey = `listings/${listingId}/attachments/${attachmentId}/rev_${newRevisionNo}/original_${safeName}`;
    const newProcessedKey = `listings/${listingId}/attachments/${attachmentId}/rev_${newRevisionNo}/${safeName}`;

    await storage.write(newOriginalKey, originalBuffer);
    await storage.write(newProcessedKey, processedBuffer);

    // New revision row: stores the preserved original (sha256 + bytes of the original)
    const [newRevisionId] = await trx('attachment_revisions').insert({
      attachment_id: attachmentId,
      revision_no: newRevisionNo,
      storage_key: newOriginalKey,
      sha256: originalSha256,
      bytes: originalBytes,
      pruned: 0,
      created_by: actor.id,
      created_at: nowStr,
    });

    // Update attachment to point at the freshly processed blob with consistent metadata
    await trx('attachments').where({ id: attachmentId }).update({
      current_revision_id: Number(newRevisionId),
      storage_key: newProcessedKey,
      sha256: originalSha256, // dedup hash matches the original (consistent with upload path)
      bytes: newProcessedBytes,
      mime: newMime,
      width: newWidth,
      height: newHeight,
      original_filename: originalFilename,
    });

    // Prune revisions beyond last 5 (set pruned=true on oldest beyond position 5)
    const allRevisions = await trx('attachment_revisions')
      .where({ attachment_id: attachmentId })
      .orderBy('revision_no', 'desc')
      .select<Record<string, unknown>[]>(['id', 'revision_no', 'pruned']);

    if (allRevisions.length > 5) {
      const toProneIds = allRevisions.slice(5).map((r) => Number(r.id));
      await trx('attachment_revisions').whereIn('id', toProneIds).update({ pruned: 1 });
    }

    // Event log inside transaction
    await logEvent({
      user_id: actor.id,
      event_type: 'attachment.rollback',
      entity_type: 'attachment',
      entity_id: attachmentId,
      office_id: actor.officeId ?? undefined,
      payload: { listing_id: listingId, target_revision_no: revisionNo, new_revision_no: newRevisionNo },
      ip,
      clock,
      knex: trx,
    });

    const rawRow = await trx('attachments')
      .where({ id: attachmentId })
      .first<Record<string, unknown>>();
    updatedAttachment = rowToAttachment(rawRow);

    // Write audit_log inside the transaction for atomicity
    await appendAuditEvent(
      {
        actor_id: actor.id,
        actor_role: actor.role,
        action: 'attachment.rollback',
        entity_type: 'attachment',
        entity_id: String(attachmentId),
        after_json: { revision_no: updatedAttachment.current_revision_id, target_revision_no: revisionNo },
        ip,
      },
      clock,
      trx,
    );
  });

  return updatedAttachment;
}

export async function softDeleteAttachment(
  attachmentId: number,
  actor: Actor,
  ip: string,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<void> {
  const now = clock.now();
  const nowStr = formatDatetime(now);

  const attachment = await knex('attachments')
    .where({ id: attachmentId })
    .whereNull('soft_deleted_at')
    .first<Record<string, unknown>>();

  if (!attachment) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found', 404);
  }

  const listingId = Number(attachment.listing_id);
  const listing = await checkListingAccess(listingId, actor, knex);

  if (!canWrite(actor, listing)) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
  }

  await knex.transaction(async (trx) => {
    await trx('attachments').where({ id: attachmentId }).update({ soft_deleted_at: nowStr });

    await logEvent({
      user_id: actor.id,
      event_type: 'attachment.deleted',
      entity_type: 'attachment',
      entity_id: attachmentId,
      office_id: actor.officeId ?? undefined,
      payload: { listing_id: listingId },
      ip,
      clock,
      knex: trx,
    });

    await appendAuditEvent(
      {
        actor_id: actor.id,
        actor_role: actor.role,
        action: 'attachment.delete',
        entity_type: 'attachment',
        entity_id: String(attachmentId),
        before_json: {
          listing_id: listingId,
          kind: String(attachment.kind),
          original_filename: String(attachment.original_filename),
          sha256: String(attachment.sha256),
          bytes: Number(attachment.bytes),
        },
        after_json: { soft_deleted: true },
        ip,
      },
      clock,
      trx,
    );
  });
}

/**
 * Replace an existing attachment's content, creating a new revision.
 * The old content is retained as a prior revision (up to 5 total).
 */
export async function replaceAttachment(
  params: {
    attachmentId: number;
    actor: Actor;
    file: { buffer: Buffer; originalname: string; size: number };
    ip: string;
  },
  storage: StorageRepository = storageRepository,
  knex: KnexType = defaultKnex,
  clock: Clock = systemClock,
): Promise<UploadResult | RejectedResult> {
  const { attachmentId, actor, file, ip } = params;
  const now = clock.now();
  const nowStr = formatDatetime(now);

  // Load existing attachment
  const existing = await knex('attachments')
    .where({ id: attachmentId })
    .whereNull('soft_deleted_at')
    .first<Record<string, unknown>>();

  if (!existing) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found', 404);
  }

  const listingId = Number(existing.listing_id);
  const listing = await checkListingAccess(listingId, actor, knex);
  if (!canWrite(actor, listing)) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied to listing', 403);
  }

  // Validate new file (use 0 for existing count since we're replacing, not adding)
  const validation = await validateAttachment(file.buffer, file.originalname, 0);
  if (!validation.valid) {
    // Record rejection
    await knex('attachment_rejections').insert({
      listing_id: listingId,
      filename: file.originalname,
      reason_code: validation.rejectionCode,
      reason_detail: validation.rejectionDetail ?? null,
      actor_id: actor.id,
      created_at: nowStr,
    });
    return {
      rejected: true,
      rejectionCode: validation.rejectionCode!,
      rejectionDetail: validation.rejectionDetail,
    };
  }

  const kind = validation.kind!;

  // Process file (image compression, etc.)
  // Preserve original for revision storage (PRD: "Preserve original in revision 1")
  const originalBuffer = file.buffer;
  const originalBytes = file.size;
  const originalHash = sha256Hex(originalBuffer);

  // PRD §11 / Phase 3 checkpoint: per-listing SHA-256 dedup must apply on the
  // replace path too — not just upload. The dedup hash is the *original*
  // upload hash (matching uploadAttachment's contract). If another active
  // attachment on the same listing already holds this content, surface the
  // existing attachment as a duplicate instead of writing a redundant copy.
  const duplicate = await knex('attachments')
    .where({ listing_id: listingId, sha256: originalHash })
    .whereNull('soft_deleted_at')
    .whereNot({ id: attachmentId })
    .first<Record<string, unknown>>();

  if (duplicate) {
    await knex('attachment_rejections').insert({
      listing_id: listingId,
      filename: file.originalname,
      reason_code: 'duplicate',
      reason_detail: `Duplicate of attachment #${duplicate.id} (sha256: ${originalHash})`,
      actor_id: actor.id,
      created_at: nowStr,
    });
    return { attachment: rowToAttachment(duplicate), duplicate: true };
  }

  let processedBuffer = file.buffer;
  let bytes = file.size;
  let width: number | null = null;
  let height: number | null = null;
  let mime = '';

  if (kind === 'image') {
    const processed = await processImage(file.buffer, mime || 'image/jpeg');
    processedBuffer = processed.buffer;
    bytes = processed.bytes;
    width = processed.width;
    height = processed.height;
    mime = processed.mime;
  } else if (kind === 'video') {
    mime = 'video/mp4';
  } else if (kind === 'pdf') {
    mime = 'application/pdf';
  }

  // The attachment row's sha256 column tracks the original upload hash for a
  // consistent dedup contract across upload + replace + rollback.
  const hash = originalHash;

  let updatedAttachment!: Attachment;

  await knex.transaction(async (trx) => {
    // Get max revision number
    const maxResult = await trx('attachment_revisions')
      .where({ attachment_id: attachmentId })
      .max<[{ maxRev: number | null }]>('revision_no as maxRev')
      .first();
    const newRevisionNo = (maxResult?.maxRev ?? 0) + 1;

    // Write processed file to storage (for serving)
    const storageKey = `listings/${listingId}/attachments/${attachmentId}/rev_${newRevisionNo}/${safeFilename(file.originalname)}`;
    await storage.write(storageKey, processedBuffer);

    // Write original binary to a separate key for the revision record
    const origKey = `listings/${listingId}/attachments/${attachmentId}/rev_${newRevisionNo}/original_${safeFilename(file.originalname)}`;
    await storage.write(origKey, originalBuffer);

    // Create new revision — points to original binary
    const [newRevisionId] = await trx('attachment_revisions').insert({
      attachment_id: attachmentId,
      revision_no: newRevisionNo,
      storage_key: origKey,
      sha256: originalHash,
      bytes: originalBytes,
      pruned: 0,
      created_by: actor.id,
      created_at: nowStr,
    });

    // Update attachment to point to new revision
    await trx('attachments').where({ id: attachmentId }).update({
      current_revision_id: Number(newRevisionId),
      storage_key: storageKey,
      sha256: hash,
      bytes,
      mime,
      width,
      height,
      original_filename: file.originalname,
    });

    // Prune revisions beyond last 5
    const allRevisions = await trx('attachment_revisions')
      .where({ attachment_id: attachmentId })
      .orderBy('revision_no', 'desc')
      .select<Record<string, unknown>[]>(['id', 'revision_no', 'pruned']);

    if (allRevisions.length > 5) {
      const toPruneIds = allRevisions.slice(5).map((r) => Number(r.id));
      await trx('attachment_revisions').whereIn('id', toPruneIds).update({ pruned: 1 });
    }

    await logEvent({
      user_id: actor.id,
      event_type: 'attachment.replaced',
      entity_type: 'attachment',
      entity_id: attachmentId,
      office_id: actor.officeId ?? undefined,
      payload: { listing_id: listingId, kind, filename: file.originalname, revision_no: newRevisionNo },
      ip,
      clock,
      knex: trx,
    });

    const rawRow = await trx('attachments').where({ id: attachmentId }).first<Record<string, unknown>>();
    updatedAttachment = rowToAttachment(rawRow);

    // Write audit_log inside the transaction for atomicity
    await appendAuditEvent(
      {
        actor_id: actor.id,
        actor_role: actor.role,
        action: 'attachment.replaced',
        entity_type: 'attachment',
        entity_id: String(attachmentId),
        before_json: { sha256: String(existing.sha256), filename: String(existing.original_filename) },
        after_json: { sha256: hash, filename: file.originalname, kind },
        ip,
      },
      clock,
      trx,
    );
  });

  return { attachment: updatedAttachment, duplicate: false };
}

export async function getRejections(
  listingId: number,
  actor: Actor,
  knex: KnexType = defaultKnex,
): Promise<AttachmentRejection[]> {
  // Merchant or admin scope
  if (actor.role !== 'administrator' && actor.role !== 'operations' && actor.role !== 'merchant') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
  }

  const listing = await checkListingAccess(listingId, actor, knex);
  if (!canRead(actor, listing)) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
  }

  const rows = await knex('attachment_rejections')
    .where({ listing_id: listingId })
    .orderBy('id', 'desc')
    .select<Record<string, unknown>[]>();

  return rows.map((row) => ({
    id: Number(row.id),
    listing_id: Number(row.listing_id),
    filename: String(row.filename),
    reason_code: String(row.reason_code),
    reason_detail: row.reason_detail ? String(row.reason_detail) : null,
    actor_id: row.actor_id !== null && row.actor_id !== undefined ? Number(row.actor_id) : null,
    created_at: parseDbDate(row.created_at as Date | string) ?? new Date(),
  }));
}

export async function sweepOrphanBlobs(
  storage: StorageRepository = storageRepository,
  knex: KnexType = defaultKnex,
  _clock: Clock = systemClock,
): Promise<{ deleted: number }> {
  // List storage keys only from non-pruned revisions; pruned blobs should be swept
  const revisionKeys = await knex('attachment_revisions')
    .where({ pruned: 0 })
    .pluck<string[]>('storage_key');

  const attachmentKeys = await knex('attachments')
    .pluck<string[]>('storage_key');

  const validKeys = new Set([...revisionKeys, ...attachmentKeys]);

  // List all blobs in storage
  const allBlobs = await storage.list('listings/');
  let deleted = 0;

  for (const blobKey of allBlobs) {
    if (!validKeys.has(blobKey)) {
      try {
        await storage.delete(blobKey);
        deleted++;
      } catch (err) {
        logger.warn({ key: blobKey, err }, 'Failed to delete orphan blob');
      }
    }
  }

  return { deleted };
}
