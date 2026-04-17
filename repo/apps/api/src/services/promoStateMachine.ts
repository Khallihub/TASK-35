import { PromoStatus } from '../types/promo';

/**
 * Allowed transitions:
 * draft      → scheduled   (operations, administrator)
 * draft      → cancelled   (operations, administrator)
 * scheduled  → live        (system/scheduler — also allowed for administrator via API)
 * scheduled  → cancelled   (operations, administrator)
 * live       → ended       (system only — time-based; also administrator for force)
 * live       → cancelled   (operations, administrator — early termination)
 * ended      → (terminal)
 * cancelled  → (terminal)
 */
export function canTransitionPromo(
  from: PromoStatus,
  to: PromoStatus,
  role: string,
): { allowed: boolean; error?: string } {
  // Terminal states
  if (from === 'ended') {
    return { allowed: false, error: 'Promo has ended and cannot be transitioned' };
  }
  if (from === 'cancelled') {
    return { allowed: false, error: 'Promo is cancelled and cannot be transitioned' };
  }

  const isOpsOrAdmin = role === 'operations' || role === 'administrator';

  switch (from) {
    case 'draft': {
      if (to === 'scheduled') {
        if (!isOpsOrAdmin) {
          return { allowed: false, error: 'Only operations or administrator can activate a promo collection' };
        }
        return { allowed: true };
      }
      if (to === 'cancelled') {
        if (!isOpsOrAdmin) {
          return { allowed: false, error: 'Only operations or administrator can cancel a promo collection' };
        }
        return { allowed: true };
      }
      return { allowed: false, error: `Cannot transition promo from draft to ${to}` };
    }

    case 'scheduled': {
      if (to === 'live') {
        // Allowed for system (administrator) or automatic
        if (role === 'system' || role === 'administrator') {
          return { allowed: true };
        }
        return { allowed: false, error: 'Only the system or administrator can force a promo to live' };
      }
      if (to === 'cancelled') {
        if (!isOpsOrAdmin) {
          return { allowed: false, error: 'Only operations or administrator can cancel a promo collection' };
        }
        return { allowed: true };
      }
      return { allowed: false, error: `Cannot transition promo from scheduled to ${to}` };
    }

    case 'live': {
      if (to === 'ended') {
        if (role === 'system' || role === 'administrator') {
          return { allowed: true };
        }
        return { allowed: false, error: 'Only the system or administrator can end a live promo' };
      }
      if (to === 'cancelled') {
        if (!isOpsOrAdmin) {
          return { allowed: false, error: 'Only operations or administrator can cancel a live promo collection' };
        }
        return { allowed: true };
      }
      return { allowed: false, error: `Cannot transition promo from live to ${to}` };
    }

    default:
      return { allowed: false, error: `Unknown from status: ${from}` };
  }
}
