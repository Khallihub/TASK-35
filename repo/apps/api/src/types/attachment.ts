export type AttachmentKind = 'image' | 'video' | 'pdf';

export interface Attachment {
  id: number;
  listing_id: number;
  kind: AttachmentKind;
  original_filename: string;
  storage_key: string;
  sha256: string;
  bytes: number;
  mime: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  created_by: number;
  created_at: Date;
  current_revision_id: number | null;
  soft_deleted_at: Date | null;
}

export interface AttachmentRevision {
  id: number;
  attachment_id: number;
  revision_no: number;
  storage_key: string;
  sha256: string;
  bytes: number;
  pruned: boolean;
  created_by: number;
  created_at: Date;
}

export interface AttachmentRejection {
  id: number;
  listing_id: number;
  filename: string;
  reason_code: string;
  reason_detail: string | null;
  actor_id: number | null;
  created_at: Date;
}

/**
 * Public (client-facing) view of an attachment. Internal storage metadata
 * (storage_key, sha256, created_by, current_revision_id) is intentionally
 * omitted so published listings do not leak the storage-layer contract
 * through the attachments list/upload APIs. Privileged callers that need
 * the full record (e.g., rollback, admin purge) stay on the internal
 * `Attachment` type.
 */
export interface AttachmentPublic {
  id: number;
  listing_id: number;
  kind: AttachmentKind;
  original_filename: string;
  bytes: number;
  mime: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  created_at: Date;
}
