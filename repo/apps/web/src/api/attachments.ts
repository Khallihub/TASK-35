import { apiClient } from './client'

/**
 * Public attachment projection returned by the API.
 *
 * Internal storage metadata (storage_key, sha256, created_by,
 * current_revision_id) is intentionally omitted server-side — see
 * apps/api/src/services/attachment.ts#toPublicAttachment. The UI does not
 * need those fields and they must not leak to broadly-authenticated clients
 * that can read published listings.
 */
export interface AttachmentData {
  id: number; listing_id: number; kind: 'image' | 'video' | 'pdf';
  original_filename: string;
  bytes: number; mime: string; width?: number; height?: number;
  duration_seconds?: number; created_at: string;
}

export const attachmentsApi = {
  list: (listingId: number) =>
    apiClient.get<{ ok: boolean; data: AttachmentData[] }>(`/listings/${listingId}/attachments`),

  upload: (listingId: number, file: File, onProgress?: (pct: number) => void) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient.post<{ ok: boolean; data: { attachment: AttachmentData; duplicate: boolean } }>(
      `/listings/${listingId}/attachments`,
      form,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => { if (onProgress && e.total) onProgress(Math.round(e.loaded * 100 / e.total)) },
      }
    )
  },

  replace: (listingId: number, id: number, file: File, onProgress?: (pct: number) => void) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient.put<{ ok: boolean; data: { attachment: AttachmentData } }>(
      `/listings/${listingId}/attachments/${id}`,
      form,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => { if (onProgress && e.total) onProgress(Math.round(e.loaded * 100 / e.total)) },
      }
    )
  },

  delete: (listingId: number, id: number) =>
    apiClient.delete(`/listings/${listingId}/attachments/${id}`),

  getRevisions: (listingId: number, id: number) =>
    apiClient.get<{ ok: boolean; data: any[] }>(`/listings/${listingId}/attachments/${id}/revisions`),

  rollback: (listingId: number, id: number, revisionNo: number) =>
    apiClient.post(`/listings/${listingId}/attachments/${id}/rollback`, { revisionNo }),

  getRejections: (listingId: number) =>
    apiClient.get<{ ok: boolean; data: any[] }>(`/listings/${listingId}/attachments/rejections`),
}
