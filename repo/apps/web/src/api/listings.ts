import { apiClient } from './client'

export interface ListingData {
  id: number; office_id: number; created_by: number; status: string;
  price_usd_cents: number | null; area_sqft: number | null; area_sqm: number | null;
  beds: number | null; baths: number | null; floor_level: number | null;
  orientation: string | null; latitude: number | null; longitude: number | null;
  address_line: string | null; city: string | null; state_code: string | null;
  postal_code: string | null; layout_normalized: string | null;
  anomaly_flags: string[]; version: number; published_at: string | null;
  created_at: string; updated_at: string;
}

export interface ListingFilters {
  status?: string; office_id?: number; agent_id?: number;
  beds_min?: number; beds_max?: number; price_min?: number; price_max?: number;
  city?: string; state_code?: string; q?: string; cursor?: string; limit?: number;
}

export const listingsApi = {
  list: (filters: ListingFilters = {}) =>
    apiClient.get<{ ok: boolean; data: { items: ListingData[]; nextCursor: string | null } }>('/listings', { params: filters }),

  get: (id: number) =>
    apiClient.get<{ ok: boolean; data: ListingData }>(`/listings/${id}`),

  create: (data: Partial<ListingData>) =>
    apiClient.post<{ ok: boolean; data: ListingData }>('/listings', data),

  update: (id: number, data: Partial<ListingData>, version: number) =>
    apiClient.patch<{ ok: boolean; data: ListingData }>(`/listings/${id}`, data, {
      headers: { 'If-Match': String(version) },
    }),

  submit: (id: number) =>
    apiClient.post<{ ok: boolean; data: ListingData }>(`/listings/${id}/submit`),

  approve: (id: number, nonce: string, overrideReason?: string) =>
    apiClient.post<{ ok: boolean; data: ListingData }>(`/listings/${id}/approve`, { overrideReason }, {
      headers: { 'X-Nonce': nonce },
    }),

  reject: (id: number, reason: string) =>
    apiClient.post<{ ok: boolean; data: ListingData }>(`/listings/${id}/reject`, { reason }),

  publish: (id: number, nonce: string) =>
    apiClient.post<{ ok: boolean; data: ListingData }>(`/listings/${id}/publish`, {}, {
      headers: { 'X-Nonce': nonce },
    }),

  archive: (id: number, reason: string) =>
    apiClient.post<{ ok: boolean; data: ListingData }>(`/listings/${id}/archive`, { reason }),

  reverse: (id: number, reason: string) =>
    apiClient.post<{ ok: boolean; data: ListingData }>(`/listings/${id}/reverse`, { reason }),

  delete: (id: number) =>
    apiClient.delete(`/listings/${id}`),

  restore: (id: number) =>
    apiClient.post<{ ok: boolean; data: ListingData }>(`/listings/${id}/restore`),

  getRevisions: (id: number) =>
    apiClient.get<{ ok: boolean; data: any[] }>(`/listings/${id}/revisions`),

  favorite: (id: number) =>
    apiClient.post<{ ok: boolean }>(`/listings/${id}/favorite`),

  share: (id: number) =>
    apiClient.post<{ ok: boolean }>(`/listings/${id}/share`),
}
