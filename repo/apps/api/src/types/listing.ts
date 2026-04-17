export type ListingStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'archived' | 'deleted';
export type Orientation = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface Listing {
  id: number;
  office_id: number;
  created_by: number;
  status: ListingStatus;
  price_usd_cents: number | null;
  area_sqft: number | null;
  area_sqm: number | null;
  beds: number | null;
  baths: number | null;       // exposed as decimal (e.g. 1.5); DB stores baths * 2
  floor_level: number | null;
  orientation: Orientation | null;
  latitude: number | null;
  longitude: number | null;
  address_line: string | null;
  city: string | null;
  state_code: string | null;
  postal_code: string | null;
  layout_normalized: string | null;
  anomaly_flags: string[];
  soft_deleted_at: Date | null;
  published_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateListingInput {
  price_usd_cents?: number;
  area_sqft?: number;
  area_sqm?: number;
  beds?: number;
  baths?: number;          // client sends decimal (1.5), service stores *2
  floor_level?: number;
  orientation?: string;
  latitude?: number;
  longitude?: number;
  address_line?: string;
  city?: string;
  state_code?: string;
  postal_code?: string;
}

export type UpdateListingInput = Partial<CreateListingInput>;
