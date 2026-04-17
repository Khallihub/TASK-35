import { apiClient } from './client'

export interface PromoData {
  id: number; title: string; theme_date: string | null;
  starts_at: string; ends_at: string; status: string;
  created_by: number; created_at: string; updated_at: string;
  slots?: PromoSlotData[];
}

export interface PromoSlotData {
  id: number; collection_id: number; listing_id: number;
  rank: number; added_by: number; added_at: string;
}

export const promoApi = {
  list: (params?: { status?: string; from?: string; to?: string; cursor?: string; limit?: number }) =>
    apiClient.get<{ ok: boolean; data: { items: PromoData[]; nextCursor: string | null } }>('/promo', { params }),

  get: (id: number) =>
    apiClient.get<{ ok: boolean; data: PromoData }>(`/promo/${id}`),

  create: (data: { title: string; theme_date?: string; starts_at: string; ends_at: string }) =>
    apiClient.post<{ ok: boolean; data: PromoData }>('/promo', data),

  update: (id: number, data: Partial<{ title: string; theme_date: string; starts_at: string; ends_at: string }>) =>
    apiClient.patch<{ ok: boolean; data: PromoData }>(`/promo/${id}`, data),

  activate: (id: number) =>
    apiClient.post<{ ok: boolean; data: PromoData }>(`/promo/${id}/activate`),

  cancel: (id: number) =>
    apiClient.post<{ ok: boolean; data: PromoData }>(`/promo/${id}/cancel`),

  addSlot: (id: number, listingId: number, rank: number) =>
    apiClient.post<{ ok: boolean; data: PromoSlotData }>(`/promo/${id}/slots`, { listingId, rank }),

  removeSlot: (id: number, slotId: number) =>
    apiClient.delete(`/promo/${id}/slots/${slotId}`),

  reorderSlots: (id: number, slots: Array<{ slotId: number; rank: number }>) =>
    apiClient.put<{ ok: boolean; data: PromoSlotData[] }>(`/promo/${id}/slots/reorder`, { slots }),

  click: (id: number, listingId?: number) =>
    apiClient.post<{ ok: boolean }>(`/promo/${id}/click`, listingId ? { listingId } : {}),
}
