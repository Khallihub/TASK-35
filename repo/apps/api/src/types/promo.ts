export type PromoStatus = 'draft' | 'scheduled' | 'live' | 'ended' | 'cancelled';

export interface PromoCollection {
  id: number;
  title: string;
  theme_date: string | null;   // ISO date string 'YYYY-MM-DD'
  starts_at: string;           // ISO datetime UTC
  ends_at: string;             // ISO datetime UTC
  status: PromoStatus;
  created_by: number;
  created_at: string;
  updated_at: string;
  slots?: PromoSlot[];
}

export interface PromoSlot {
  id: number;
  collection_id: number;
  listing_id: number;
  rank: number;
  added_by: number;
  added_at: string;
}

export interface CreatePromoInput {
  title: string;
  theme_date?: string;    // 'YYYY-MM-DD'
  starts_at: string;      // ISO datetime
  ends_at: string;        // ISO datetime
}

export interface UpdatePromoInput {
  title?: string;
  theme_date?: string;
  starts_at?: string;
  ends_at?: string;
}
