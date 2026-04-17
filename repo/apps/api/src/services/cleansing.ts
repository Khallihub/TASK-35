import { CreateListingInput, UpdateListingInput, Listing } from '../types/listing';

export interface CleansingResult {
  cleaned: Partial<Listing>;
  anomalyFlags: string[];
  errors: Array<{ field: string; message: string }>;
}

const VALID_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'AS', 'GU', 'MP', 'PR', 'VI',
]);

const VALID_ORIENTATIONS = new Set(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);

const POSTAL_CODE_REGEX = /^\d{5}(-\d{4})?$/;

const MAX_PRICE = 2147483647;
const MAX_AREA_SQFT = 100000;
const SQFT_TO_SQM = 1 / 10.7639;
const SQM_TO_SQFT = 10.7639;

function trimCollapse(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function cleanseListingInput(
  raw: CreateListingInput | UpdateListingInput,
  settings: { pricePerSqftMin: number; pricePerSqftMax: number },
): CleansingResult {
  const cleaned: Partial<Listing> = {};
  const errors: Array<{ field: string; message: string }> = [];
  const anomalyFlags: string[] = [];

  // ── String fields: trim + collapse ─────────────────────────────────────────

  if (raw.address_line !== undefined) {
    cleaned.address_line = trimCollapse(raw.address_line);
  }

  if (raw.city !== undefined) {
    cleaned.city = trimCollapse(raw.city);
  }

  // ── state_code ─────────────────────────────────────────────────────────────
  if (raw.state_code !== undefined) {
    const sc = trimCollapse(raw.state_code).toUpperCase();
    if (!/^[A-Z]{2}$/.test(sc) || !VALID_STATE_CODES.has(sc)) {
      errors.push({ field: 'state_code', message: 'Invalid US state/territory code' });
    } else {
      cleaned.state_code = sc;
    }
  }

  // ── postal_code ─────────────────────────────────────────────────────────────
  if (raw.postal_code !== undefined) {
    const pc = trimCollapse(raw.postal_code);
    if (!POSTAL_CODE_REGEX.test(pc)) {
      errors.push({ field: 'postal_code', message: 'Invalid postal code, must match 12345 or 12345-6789' });
    } else {
      cleaned.postal_code = pc;
    }
  }

  // ── orientation ─────────────────────────────────────────────────────────────
  if (raw.orientation !== undefined) {
    const ori = trimCollapse(raw.orientation).toUpperCase();
    if (!VALID_ORIENTATIONS.has(ori)) {
      errors.push({ field: 'orientation', message: 'Invalid orientation' });
    } else {
      cleaned.orientation = ori as Listing['orientation'];
    }
  }

  // ── price_usd_cents ─────────────────────────────────────────────────────────
  if (raw.price_usd_cents !== undefined) {
    const price = raw.price_usd_cents;
    if (price < 0 || price > MAX_PRICE) {
      errors.push({ field: 'price_usd_cents', message: `price_usd_cents must be between 0 and ${MAX_PRICE}` });
    } else {
      cleaned.price_usd_cents = Math.round(price);
    }
  }

  // ── area_sqft / area_sqm ────────────────────────────────────────────────────
  const hasSqft = raw.area_sqft !== undefined;
  const hasSqm = raw.area_sqm !== undefined;

  if (hasSqft) {
    const sqft = raw.area_sqft as number;
    if (sqft <= 0 || sqft > MAX_AREA_SQFT) {
      errors.push({ field: 'area_sqft', message: `area_sqft must be > 0 and <= ${MAX_AREA_SQFT}` });
    } else {
      cleaned.area_sqft = roundTo(sqft, 2);
      cleaned.area_sqm = roundTo(sqft * SQFT_TO_SQM, 2);
    }
  } else if (hasSqm) {
    const sqm = raw.area_sqm as number;
    if (sqm <= 0 || sqm * SQM_TO_SQFT > MAX_AREA_SQFT) {
      errors.push({ field: 'area_sqm', message: 'area_sqm is out of valid range' });
    } else {
      cleaned.area_sqm = roundTo(sqm, 2);
      cleaned.area_sqft = roundTo(sqm * SQM_TO_SQFT, 2);
    }
  }

  // ── beds ─────────────────────────────────────────────────────────────────────
  if (raw.beds !== undefined) {
    const beds = raw.beds;
    if (!Number.isInteger(beds) || beds < 0 || beds > 50) {
      if (!Number.isInteger(beds)) {
        errors.push({ field: 'beds', message: 'beds must be a whole number' });
      } else {
        errors.push({ field: 'beds', message: 'beds must be between 0 and 50' });
      }
    } else {
      cleaned.beds = beds;
    }
  }

  // ── baths ─────────────────────────────────────────────────────────────────────
  if (raw.baths !== undefined) {
    const baths = raw.baths;
    const bathsX2 = baths * 2;
    if (!Number.isInteger(bathsX2) || bathsX2 < 0 || bathsX2 > 100) {
      if (!Number.isInteger(bathsX2)) {
        errors.push({ field: 'baths', message: 'baths must be in 0.5 increments' });
      } else {
        errors.push({ field: 'baths', message: 'baths must be between 0 and 50' });
      }
    } else {
      cleaned.baths = baths;
    }
  }

  // ── floor_level ────────────────────────────────────────────────────────────
  if (raw.floor_level !== undefined) {
    const fl = raw.floor_level;
    if (!Number.isInteger(fl)) {
      errors.push({ field: 'floor_level', message: 'floor_level must be an integer' });
    } else if (fl < -5 || fl > 200) {
      errors.push({ field: 'floor_level', message: 'floor_level must be between -5 and 200' });
    } else {
      cleaned.floor_level = fl;
    }
  }

  // ── latitude / longitude ──────────────────────────────────────────────────
  if (raw.latitude !== undefined) {
    const lat = raw.latitude;
    if (lat < -90 || lat > 90) {
      errors.push({ field: 'latitude', message: 'latitude must be between -90 and 90' });
    } else {
      cleaned.latitude = roundTo(lat, 6);
    }
  }

  if (raw.longitude !== undefined) {
    const lon = raw.longitude;
    if (lon < -180 || lon > 180) {
      errors.push({ field: 'longitude', message: 'longitude must be between -180 and 180' });
    } else {
      cleaned.longitude = roundTo(lon, 6);
    }
  }

  // ── layout_normalized ────────────────────────────────────────────────────
  const cleanedBeds = cleaned.beds;
  const cleanedBaths = cleaned.baths;
  if (cleanedBeds !== undefined && cleanedBeds !== null && cleanedBaths !== undefined && cleanedBaths !== null) {
    const bathsDisplay = Number.isInteger(cleanedBaths) ? String(cleanedBaths) : String(cleanedBaths);
    cleaned.layout_normalized = `${cleanedBeds} bed ${bathsDisplay} bath`;
  }

  // ── anomaly flags ─────────────────────────────────────────────────────────
  const finalPrice = cleaned.price_usd_cents;
  const finalSqft = cleaned.area_sqft;
  if (finalPrice !== undefined && finalPrice !== null && finalSqft !== undefined && finalSqft !== null && finalSqft > 0) {
    const pricePerSqft = (finalPrice / 100) / finalSqft;
    if (pricePerSqft < settings.pricePerSqftMin || pricePerSqft > settings.pricePerSqftMax) {
      anomalyFlags.push('price_per_sqft_out_of_range');
    }
  }

  return { cleaned, anomalyFlags, errors };
}
