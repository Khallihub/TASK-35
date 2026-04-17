import { computePromoStatus } from '../../src/services/promoStatus';
import { PromoStatus } from '../../src/types/promo';

function makeCollection(overrides: {
  starts_at?: string;
  ends_at?: string;
  status?: PromoStatus;
}) {
  return {
    starts_at: overrides.starts_at ?? '2025-06-01T12:00:00.000Z',
    ends_at: overrides.ends_at ?? '2025-06-30T12:00:00.000Z',
    status: overrides.status ?? 'draft' as PromoStatus,
  };
}

describe('computePromoStatus', () => {
  it('draft collection → always draft regardless of time (past)', () => {
    const col = makeCollection({
      status: 'draft',
      starts_at: '2020-01-01T00:00:00.000Z',
      ends_at: '2020-12-31T00:00:00.000Z',
    });
    const result = computePromoStatus(col, new Date('2024-06-01T00:00:00.000Z'));
    expect(result).toBe('draft');
  });

  it('draft collection → always draft regardless of time (future)', () => {
    const col = makeCollection({
      status: 'draft',
      starts_at: '2030-01-01T00:00:00.000Z',
      ends_at: '2030-12-31T00:00:00.000Z',
    });
    const result = computePromoStatus(col, new Date('2024-06-01T00:00:00.000Z'));
    expect(result).toBe('draft');
  });

  it('activated collection, now before starts_at → scheduled', () => {
    const col = makeCollection({
      status: 'scheduled',
      starts_at: '2025-06-01T12:00:00.000Z',
      ends_at: '2025-06-30T12:00:00.000Z',
    });
    const now = new Date('2025-05-01T00:00:00.000Z');
    expect(computePromoStatus(col, now)).toBe('scheduled');
  });

  it('activated collection, now between starts_at and ends_at → live', () => {
    const col = makeCollection({
      status: 'scheduled',
      starts_at: '2025-06-01T12:00:00.000Z',
      ends_at: '2025-06-30T12:00:00.000Z',
    });
    const now = new Date('2025-06-15T00:00:00.000Z');
    expect(computePromoStatus(col, now)).toBe('live');
  });

  it('activated collection (live), now after ends_at → ended', () => {
    const col = makeCollection({
      status: 'live',
      starts_at: '2025-06-01T12:00:00.000Z',
      ends_at: '2025-06-30T12:00:00.000Z',
    });
    const now = new Date('2025-07-01T00:00:00.000Z');
    expect(computePromoStatus(col, now)).toBe('ended');
  });

  it('cancelled collection → always cancelled regardless of time', () => {
    const col = makeCollection({
      status: 'cancelled',
      starts_at: '2025-06-01T12:00:00.000Z',
      ends_at: '2025-06-30T12:00:00.000Z',
    });
    // Even if "now" is between starts and ends, cancelled stays cancelled
    const now = new Date('2025-06-15T00:00:00.000Z');
    expect(computePromoStatus(col, now)).toBe('cancelled');
  });

  it('boundary: now === starts_at exactly → live', () => {
    const starts = '2025-06-01T12:00:00.000Z';
    const col = makeCollection({
      status: 'scheduled',
      starts_at: starts,
      ends_at: '2025-06-30T12:00:00.000Z',
    });
    const now = new Date(starts);
    expect(computePromoStatus(col, now)).toBe('live');
  });

  it('boundary: now === ends_at exactly → ended', () => {
    const ends = '2025-06-30T12:00:00.000Z';
    const col = makeCollection({
      status: 'live',
      starts_at: '2025-06-01T12:00:00.000Z',
      ends_at: ends,
    });
    const now = new Date(ends);
    expect(computePromoStatus(col, now)).toBe('ended');
  });

  it('ended status collection → ended regardless of time', () => {
    const col = makeCollection({
      status: 'ended',
      starts_at: '2020-01-01T00:00:00.000Z',
      ends_at: '2020-12-31T00:00:00.000Z',
    });
    // Even now is far in future — ended stays ended
    const result = computePromoStatus(col, new Date('2030-01-01T00:00:00.000Z'));
    expect(result).toBe('ended');
  });
});
