import { PromoStatus } from '../types/promo';

/**
 * Compute the effective promo status given stored collection data and the current time.
 *
 * Rules:
 * - status='cancelled'  → always 'cancelled' (terminal)
 * - status='draft'      → always 'draft' (not yet activated)
 * - status='scheduled'|'live'|'ended' (activated):
 *     if now < starts_at  → 'scheduled'
 *     if starts_at <= now < ends_at → 'live'
 *     if now >= ends_at   → 'ended'
 */
export function computePromoStatus(
  collection: { starts_at: string; ends_at: string; status: PromoStatus },
  now: Date,
): PromoStatus {
  if (collection.status === 'cancelled') {
    return 'cancelled';
  }

  if (collection.status === 'draft') {
    return 'draft';
  }

  // Activated statuses: 'scheduled', 'live', 'ended'
  const startsAt = new Date(collection.starts_at);
  const endsAt = new Date(collection.ends_at);

  if (now < startsAt) {
    return 'scheduled';
  }

  if (now >= startsAt && now < endsAt) {
    return 'live';
  }

  return 'ended';
}
