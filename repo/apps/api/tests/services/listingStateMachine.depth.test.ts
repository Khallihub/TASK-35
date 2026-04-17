import {
  canTransition,
  ListingStatus,
  UserRole,
} from '../../src/services/listingStateMachine';

function ctx(
  actor: { role: UserRole; officeId?: number | null; id?: number },
  listing: { status: ListingStatus; office_id?: number; anomaly_flags?: string[]; created_by?: number },
  reason?: string,
  overrideReason?: string,
): Parameters<typeof canTransition>[2] {
  return {
    actor: { id: actor.id ?? 1, role: actor.role, officeId: actor.officeId ?? 1 },
    listing: {
      id: 99,
      office_id: listing.office_id ?? 1,
      status: listing.status,
      anomaly_flags: listing.anomaly_flags ?? [],
      created_by: listing.created_by,
    },
    reason,
    overrideReason,
  };
}

describe('canTransition — in_review (submit)', () => {
  it('draft → in_review allowed for administrator', () => {
    expect(canTransition('draft', 'in_review', ctx({ role: 'administrator' }, { status: 'draft' })).allowed).toBe(true);
  });

  it('draft → in_review allowed for same-office merchant', () => {
    expect(canTransition('draft', 'in_review', ctx({ role: 'merchant', officeId: 1 }, { status: 'draft', office_id: 1 })).allowed).toBe(true);
  });

  it('draft → in_review forbidden for merchant of different office', () => {
    expect(canTransition('draft', 'in_review', ctx({ role: 'merchant', officeId: 2 }, { status: 'draft', office_id: 1 })).allowed).toBe(false);
  });

  it('draft → in_review allowed for regular_user who owns the listing', () => {
    expect(canTransition('draft', 'in_review', ctx({ role: 'regular_user', id: 7 }, { status: 'draft', created_by: 7 })).allowed).toBe(true);
  });

  it('draft → in_review forbidden for regular_user who does not own', () => {
    expect(canTransition('draft', 'in_review', ctx({ role: 'regular_user', id: 7 }, { status: 'draft', created_by: 8 })).allowed).toBe(false);
  });

  it('published → in_review (reversal) allowed for administrator with reason', () => {
    expect(canTransition('published', 'in_review', ctx({ role: 'administrator' }, { status: 'published' }, 'verified issue')).allowed).toBe(true);
  });

  it('published → in_review reversal requires reason', () => {
    const r = canTransition('published', 'in_review', ctx({ role: 'administrator' }, { status: 'published' }));
    expect(r.allowed).toBe(false);
    expect(r.error).toMatch(/reason/);
  });

  it('published → in_review reversal allowed for same-office merchant', () => {
    expect(canTransition('published', 'in_review', ctx({ role: 'merchant', officeId: 1 }, { status: 'published', office_id: 1 }, 'needs update')).allowed).toBe(true);
  });

  it('published → in_review reversal denied for merchant of other office', () => {
    expect(canTransition('published', 'in_review', ctx({ role: 'merchant', officeId: 2 }, { status: 'published', office_id: 1 }, 'needs')).allowed).toBe(false);
  });

  it('approved → in_review is not a valid transition', () => {
    expect(canTransition('approved', 'in_review', ctx({ role: 'administrator' }, { status: 'approved' })).allowed).toBe(false);
  });
});

describe('canTransition — approved/rejected', () => {
  it('approved requires in_review as source', () => {
    expect(canTransition('draft', 'approved', ctx({ role: 'administrator' }, { status: 'draft' })).allowed).toBe(false);
  });

  it('approved blocked for regular_user role', () => {
    expect(canTransition('in_review', 'approved', ctx({ role: 'regular_user' }, { status: 'in_review' })).allowed).toBe(false);
  });

  it('approved requires overrideReason ≥10 chars when anomaly flags present', () => {
    const denied = canTransition('in_review', 'approved', ctx({ role: 'administrator' }, { status: 'in_review', anomaly_flags: ['price_per_sqft_low'] }));
    expect(denied.allowed).toBe(false);
    const shortReason = canTransition('in_review', 'approved', ctx({ role: 'administrator' }, { status: 'in_review', anomaly_flags: ['x'] }, undefined, 'short'));
    expect(shortReason.allowed).toBe(false);
    const ok = canTransition('in_review', 'approved', ctx({ role: 'administrator' }, { status: 'in_review', anomaly_flags: ['x'] }, undefined, 'well-documented manager override'));
    expect(ok.allowed).toBe(true);
  });

  it('rejected requires in_review source + reason ≥10 chars', () => {
    expect(canTransition('draft', 'rejected', ctx({ role: 'administrator' }, { status: 'draft' }, 'r')).allowed).toBe(false);
    expect(canTransition('in_review', 'rejected', ctx({ role: 'administrator' }, { status: 'in_review' }, 'short')).allowed).toBe(false);
    expect(canTransition('in_review', 'rejected', ctx({ role: 'administrator' }, { status: 'in_review' }, 'Insufficient photos for listing')).allowed).toBe(true);
  });

  it('rejected blocked for regular_user', () => {
    expect(canTransition('in_review', 'rejected', ctx({ role: 'regular_user' }, { status: 'in_review' }, 'long enough reason string')).allowed).toBe(false);
  });
});

describe('canTransition — published/archived', () => {
  it('published requires approved source', () => {
    expect(canTransition('draft', 'published', ctx({ role: 'administrator' }, { status: 'draft' })).allowed).toBe(false);
    expect(canTransition('approved', 'published', ctx({ role: 'administrator' }, { status: 'approved' })).allowed).toBe(true);
  });

  it('published blocked for regular_user', () => {
    expect(canTransition('approved', 'published', ctx({ role: 'regular_user' }, { status: 'approved' })).allowed).toBe(false);
  });

  it('archived requires published + reason', () => {
    expect(canTransition('approved', 'archived', ctx({ role: 'administrator' }, { status: 'approved' }, 'x')).allowed).toBe(false);
    expect(canTransition('published', 'archived', ctx({ role: 'administrator' }, { status: 'published' })).allowed).toBe(false);
    expect(canTransition('published', 'archived', ctx({ role: 'administrator' }, { status: 'published' }, 'listing withdrawn')).allowed).toBe(true);
  });

  it('archived blocked for regular_user', () => {
    expect(canTransition('published', 'archived', ctx({ role: 'regular_user' }, { status: 'published' }, 'listing withdrawn')).allowed).toBe(false);
  });
});

describe('canTransition — deleted/restore/unknown', () => {
  it('already-deleted → deleted is rejected', () => {
    expect(canTransition('deleted', 'deleted', ctx({ role: 'administrator' }, { status: 'deleted' })).allowed).toBe(false);
  });

  it('regular_user can only delete own draft', () => {
    expect(canTransition('draft', 'deleted', ctx({ role: 'regular_user', id: 7 }, { status: 'draft', created_by: 7 })).allowed).toBe(true);
    expect(canTransition('draft', 'deleted', ctx({ role: 'regular_user', id: 7 }, { status: 'draft', created_by: 8 })).allowed).toBe(false);
    expect(canTransition('published', 'deleted', ctx({ role: 'regular_user', id: 7 }, { status: 'published', created_by: 7 })).allowed).toBe(false);
  });

  it('merchant can delete own-office listing at any non-deleted status', () => {
    expect(canTransition('published', 'deleted', ctx({ role: 'merchant', officeId: 1 }, { status: 'published', office_id: 1 })).allowed).toBe(true);
  });

  it('restore (deleted → draft) allowed for admin + same-office merchant', () => {
    expect(canTransition('deleted', 'draft', ctx({ role: 'administrator' }, { status: 'deleted' })).allowed).toBe(true);
    expect(canTransition('deleted', 'draft', ctx({ role: 'merchant', officeId: 1 }, { status: 'deleted', office_id: 1 })).allowed).toBe(true);
    expect(canTransition('deleted', 'draft', ctx({ role: 'regular_user' }, { status: 'deleted' })).allowed).toBe(false);
  });

  it('deleted → draft rejected if listing is not deleted', () => {
    expect(canTransition('draft', 'draft', ctx({ role: 'administrator' }, { status: 'draft' })).allowed).toBe(false);
  });

  it('unknown target status falls through', () => {
    const r = canTransition('draft', 'bogus' as ListingStatus, ctx({ role: 'administrator' }, { status: 'draft' }));
    expect(r.allowed).toBe(false);
    expect(r.error).toMatch(/Unknown target status/);
  });
});
