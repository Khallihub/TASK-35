import { cleanseListingInput } from '../../src/services/cleansing';

const DEFAULT_SETTINGS = { pricePerSqftMin: 50, pricePerSqftMax: 5000 };

describe('cleanseListingInput', () => {
  // ── area conversions ─────────────────────────────────────────────────────

  it('converts sqft to sqm: 1000 sqft → 92.90 sqm', () => {
    const result = cleanseListingInput({ area_sqft: 1000 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.area_sqft).toBe(1000);
    expect(result.cleaned.area_sqm).toBe(92.90);
  });

  it('converts sqm to sqft: 100 sqm → 1076.39 sqft', () => {
    const result = cleanseListingInput({ area_sqm: 100 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.area_sqm).toBe(100);
    expect(result.cleaned.area_sqft).toBe(1076.39);
  });

  it('if both sqft and sqm provided, uses sqft as canonical', () => {
    const result = cleanseListingInput({ area_sqft: 500, area_sqm: 999 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.area_sqft).toBe(500);
    // Derived from 500 sqft
    expect(result.cleaned.area_sqm).toBe(46.45);
  });

  // ── state_code ───────────────────────────────────────────────────────────

  it('normalizes valid state: ca → CA', () => {
    const result = cleanseListingInput({ state_code: 'ca' }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.state_code).toBe('CA');
  });

  it('rejects invalid state: XX → error', () => {
    const result = cleanseListingInput({ state_code: 'XX' }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('state_code');
  });

  it('accepts DC as valid state code', () => {
    const result = cleanseListingInput({ state_code: 'dc' }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.state_code).toBe('DC');
  });

  // ── postal_code ──────────────────────────────────────────────────────────

  it('accepts valid 5-digit postal code: 12345', () => {
    const result = cleanseListingInput({ postal_code: '12345' }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.postal_code).toBe('12345');
  });

  it('rejects invalid 4-digit postal code: 1234', () => {
    const result = cleanseListingInput({ postal_code: '1234' }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('postal_code');
  });

  it('accepts valid zip+4 postal code: 12345-6789', () => {
    const result = cleanseListingInput({ postal_code: '12345-6789' }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.postal_code).toBe('12345-6789');
  });

  // ── orientation ──────────────────────────────────────────────────────────

  it('normalizes orientation: ne → NE', () => {
    const result = cleanseListingInput({ orientation: 'ne' }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.orientation).toBe('NE');
  });

  it('rejects invalid orientation: INVALID → error', () => {
    const result = cleanseListingInput({ orientation: 'INVALID' }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('orientation');
    expect(result.errors[0].message).toBe('Invalid orientation');
  });

  // ── beds ─────────────────────────────────────────────────────────────────

  it('accepts valid integer beds: 2', () => {
    const result = cleanseListingInput({ beds: 2 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.beds).toBe(2);
  });

  it('rejects fractional beds: 2.5 → error', () => {
    const result = cleanseListingInput({ beds: 2.5 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('beds');
  });

  it('rejects beds > 50: 51 → error', () => {
    const result = cleanseListingInput({ beds: 51 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('beds');
  });

  it('accepts beds = 0', () => {
    const result = cleanseListingInput({ beds: 0 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.beds).toBe(0);
  });

  // ── baths ─────────────────────────────────────────────────────────────────

  it('accepts baths = 1.5 (stored as 3)', () => {
    const result = cleanseListingInput({ baths: 1.5 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.baths).toBe(1.5);
  });

  it('rejects baths = 1.3 (not a 0.5 increment) → error', () => {
    const result = cleanseListingInput({ baths: 1.3 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('baths');
  });

  it('rejects baths = -1 → error', () => {
    const result = cleanseListingInput({ baths: -1 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('baths');
  });

  it('accepts baths = 0', () => {
    const result = cleanseListingInput({ baths: 0 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.baths).toBe(0);
  });

  it('accepts baths = 2.0', () => {
    const result = cleanseListingInput({ baths: 2.0 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.baths).toBe(2);
  });

  // ── floor_level ───────────────────────────────────────────────────────────

  it('accepts valid floor_level: 5', () => {
    const result = cleanseListingInput({ floor_level: 5 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.floor_level).toBe(5);
  });

  it('rejects floor_level < -5: -6 → error', () => {
    const result = cleanseListingInput({ floor_level: -6 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('floor_level');
  });

  it('rejects floor_level > 200: 201 → error', () => {
    const result = cleanseListingInput({ floor_level: 201 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('floor_level');
  });

  it('rejects fractional floor_level: 1.5 → error', () => {
    const result = cleanseListingInput({ floor_level: 1.5 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('floor_level');
  });

  // ── layout_normalized ─────────────────────────────────────────────────────

  it('generates layout_normalized: beds=3 + baths=2 → "3 bed 2 bath"', () => {
    const result = cleanseListingInput({ beds: 3, baths: 2 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.layout_normalized).toBe('3 bed 2 bath');
  });

  it('generates layout_normalized: beds=2 + baths=1.5 → "2 bed 1.5 bath"', () => {
    const result = cleanseListingInput({ beds: 2, baths: 1.5 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.layout_normalized).toBe('2 bed 1.5 bath');
  });

  it('does not generate layout_normalized if only beds provided', () => {
    const result = cleanseListingInput({ beds: 2 }, DEFAULT_SETTINGS);
    expect(result.errors).toHaveLength(0);
    expect(result.cleaned.layout_normalized).toBeUndefined();
  });

  // ── anomaly flags ─────────────────────────────────────────────────────────

  it('no anomaly flag when price_per_sqft is in range: price=50000 cents, area=1 sqft → 500/sqft', () => {
    const result = cleanseListingInput(
      { price_usd_cents: 50000, area_sqft: 1 },
      { pricePerSqftMin: 50, pricePerSqftMax: 5000 },
    );
    expect(result.errors).toHaveLength(0);
    expect(result.anomalyFlags).not.toContain('price_per_sqft_out_of_range');
  });

  it('sets anomaly flag when price_per_sqft is too low: price=100 cents, area=100 sqft → 0.01/sqft', () => {
    const result = cleanseListingInput(
      { price_usd_cents: 100, area_sqft: 100 },
      { pricePerSqftMin: 50, pricePerSqftMax: 5000 },
    );
    expect(result.errors).toHaveLength(0);
    expect(result.anomalyFlags).toContain('price_per_sqft_out_of_range');
  });

  it('sets anomaly flag when price_per_sqft is too high: price=600000000 cents, area=10 sqft → 600000/sqft', () => {
    const result = cleanseListingInput(
      { price_usd_cents: 600000000, area_sqft: 10 },
      { pricePerSqftMin: 50, pricePerSqftMax: 5000 },
    );
    expect(result.errors).toHaveLength(0);
    expect(result.anomalyFlags).toContain('price_per_sqft_out_of_range');
  });

  // ── string trimming ───────────────────────────────────────────────────────

  it('trims and collapses whitespace in address_line', () => {
    const result = cleanseListingInput({ address_line: '  123   Main  St  ' }, DEFAULT_SETTINGS);
    expect(result.cleaned.address_line).toBe('123 Main St');
  });

  it('trims and collapses whitespace in city', () => {
    const result = cleanseListingInput({ city: '  New   York  ' }, DEFAULT_SETTINGS);
    expect(result.cleaned.city).toBe('New York');
  });
});
