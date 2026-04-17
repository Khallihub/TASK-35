export type ListingStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'archived' | 'deleted';
export type UserRole = 'regular_user' | 'merchant' | 'operations' | 'administrator';

interface TransitionContext {
  actor: { id: number; role: UserRole; officeId: number | null };
  listing: { id: number; office_id: number; status: ListingStatus; anomaly_flags: string[]; created_by?: number };
  reason?: string;
  overrideReason?: string;
}

// Logical "rejected" status maps to 'draft' in DB
// We treat in_review -> rejected as in_review -> draft
type LogicalStatus = ListingStatus | 'rejected';

interface TransitionResult {
  allowed: boolean;
  error?: string;
}

function isOwnOffice(actor: TransitionContext['actor'], listing: TransitionContext['listing']): boolean {
  return actor.officeId !== null && actor.officeId === listing.office_id;
}

function isOwner(actor: TransitionContext['actor'], listing: TransitionContext['listing']): boolean {
  return listing.created_by !== undefined && listing.created_by === actor.id;
}

export function canTransition(
  from: ListingStatus,
  to: ListingStatus | 'rejected',
  ctx: TransitionContext,
): TransitionResult {
  const { actor, listing, reason, overrideReason } = ctx;

  // Map 'rejected' back to 'draft' for checking current status
  const logicalTo: LogicalStatus = to;

  switch (logicalTo) {
    // draft → in_review
    case 'in_review': {
      if (from === 'draft') {
        if (actor.role === 'administrator') return { allowed: true };
        if (actor.role === 'merchant' && isOwnOffice(actor, listing)) return { allowed: true };
        if (actor.role === 'regular_user' && isOwner(actor, listing)) return { allowed: true };
        return { allowed: false, error: 'Not authorized to submit this listing for review' };
      }
      if (from === 'published') {
        // Reversal: published → in_review
        if (actor.role === 'administrator') {
          if (!reason || reason.length === 0) return { allowed: false, error: 'reason required for reversal' };
          return { allowed: true };
        }
        if (actor.role === 'merchant' && isOwnOffice(actor, listing)) {
          if (!reason || reason.length === 0) return { allowed: false, error: 'reason required for reversal' };
          return { allowed: true };
        }
        return { allowed: false, error: 'Not authorized for this transition' };
      }
      return { allowed: false, error: `Cannot transition from ${from} to in_review` };
    }

    // in_review → approved
    case 'approved': {
      if (from !== 'in_review') {
        return { allowed: false, error: `Cannot transition from ${from} to approved` };
      }
      if (actor.role !== 'administrator' && !(actor.role === 'merchant' && isOwnOffice(actor, listing))) {
        return { allowed: false, error: 'Not authorized to approve listings' };
      }
      if (listing.anomaly_flags && listing.anomaly_flags.length > 0) {
        if (!overrideReason || overrideReason.length < 10) {
          return { allowed: false, error: 'overrideReason (min 10 chars) required when anomaly flags are present' };
        }
      }
      return { allowed: true };
    }

    // in_review → rejected (maps to draft)
    case 'rejected': {
      if (from !== 'in_review') {
        return { allowed: false, error: `Cannot reject from ${from}` };
      }
      if (actor.role !== 'administrator' && !(actor.role === 'merchant' && isOwnOffice(actor, listing))) {
        return { allowed: false, error: 'Not authorized to reject listings' };
      }
      if (!reason || reason.length < 10) {
        return { allowed: false, error: 'reason (min 10 chars) required to reject a listing' };
      }
      return { allowed: true };
    }

    // approved → published
    case 'published': {
      if (from !== 'approved') {
        return { allowed: false, error: `Cannot transition from ${from} to published` };
      }
      if (actor.role !== 'administrator' && !(actor.role === 'merchant' && isOwnOffice(actor, listing))) {
        return { allowed: false, error: 'Not authorized to publish listings' };
      }
      return { allowed: true };
    }

    // published → archived (PRD §9.1: archive is from published only)
    case 'archived': {
      if (from !== 'published') {
        return { allowed: false, error: `Cannot archive from ${from}` };
      }
      if (actor.role !== 'administrator' && !(actor.role === 'merchant' && isOwnOffice(actor, listing))) {
        return { allowed: false, error: 'Not authorized to archive listings' };
      }
      if (!reason || reason.length === 0) {
        return { allowed: false, error: 'reason required to archive a listing' };
      }
      return { allowed: true };
    }

    // any non-deleted → deleted
    case 'deleted': {
      if (from === 'deleted') {
        return { allowed: false, error: 'Listing is already deleted' };
      }
      if (actor.role === 'administrator') return { allowed: true };
      if (actor.role === 'merchant' && isOwnOffice(actor, listing)) return { allowed: true };
      // Owner (regular_user) can only delete draft
      if (actor.role === 'regular_user' && from === 'draft' && isOwner(actor, listing)) {
        return { allowed: true };
      }
      return { allowed: false, error: 'Not authorized to delete this listing' };
    }

    // deleted → draft (restore)
    case 'draft': {
      if (from === 'deleted') {
        if (actor.role === 'administrator') return { allowed: true };
        if (actor.role === 'merchant' && isOwnOffice(actor, listing)) return { allowed: true };
        return { allowed: false, error: 'Not authorized to restore this listing' };
      }
      return { allowed: false, error: `Cannot transition from ${from} to draft` };
    }

    default:
      return { allowed: false, error: `Unknown target status: ${String(logicalTo)}` };
  }
}
