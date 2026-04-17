import { canTransition, ListingStatus, UserRole } from '../../src/services/listingStateMachine';

function makeCtx(overrides: {
  actorRole?: UserRole;
  actorId?: number;
  actorOfficeId?: number | null;
  listingStatus?: ListingStatus;
  listingOfficeId?: number;
  listingCreatedBy?: number;
  anomalyFlags?: string[];
  reason?: string;
  overrideReason?: string;
}) {
  return {
    actor: {
      id: overrides.actorId ?? 1,
      role: overrides.actorRole ?? 'regular_user' as UserRole,
      officeId: overrides.actorOfficeId !== undefined ? overrides.actorOfficeId : 10,
    },
    listing: {
      id: 42,
      office_id: overrides.listingOfficeId ?? 10,
      status: overrides.listingStatus ?? 'draft' as ListingStatus,
      anomaly_flags: overrides.anomalyFlags ?? [],
      created_by: overrides.listingCreatedBy ?? 1,
    },
    reason: overrides.reason,
    overrideReason: overrides.overrideReason,
  };
}

describe('canTransition', () => {
  // draft → in_review

  it('draft → in_review: owner (regular_user) allowed', () => {
    const ctx = makeCtx({ actorRole: 'regular_user', actorId: 1, listingCreatedBy: 1 });
    const result = canTransition('draft', 'in_review', ctx);
    expect(result.allowed).toBe(true);
  });

  it('draft → in_review: different office merchant → NOT allowed', () => {
    const ctx = makeCtx({
      actorRole: 'merchant',
      actorOfficeId: 99,
      listingOfficeId: 10,
    });
    const result = canTransition('draft', 'in_review', ctx);
    expect(result.allowed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('draft → in_review: merchant own_office → allowed', () => {
    const ctx = makeCtx({
      actorRole: 'merchant',
      actorOfficeId: 10,
      listingOfficeId: 10,
    });
    const result = canTransition('draft', 'in_review', ctx);
    expect(result.allowed).toBe(true);
  });

  it('draft → in_review: administrator → allowed', () => {
    const ctx = makeCtx({ actorRole: 'administrator' });
    const result = canTransition('draft', 'in_review', ctx);
    expect(result.allowed).toBe(true);
  });

  it('draft → in_review: regular_user who is NOT owner → NOT allowed', () => {
    const ctx = makeCtx({ actorRole: 'regular_user', actorId: 2, listingCreatedBy: 1 });
    const result = canTransition('draft', 'in_review', ctx);
    expect(result.allowed).toBe(false);
  });

  // in_review → approved

  it('in_review → approved: merchant own_office, no flags → allowed', () => {
    const ctx = makeCtx({
      actorRole: 'merchant',
      actorOfficeId: 10,
      listingOfficeId: 10,
      listingStatus: 'in_review',
      anomalyFlags: [],
    });
    const result = canTransition('in_review', 'approved', ctx);
    expect(result.allowed).toBe(true);
  });

  it('in_review → approved: merchant own_office, with flags, no overrideReason → NOT allowed', () => {
    const ctx = makeCtx({
      actorRole: 'merchant',
      actorOfficeId: 10,
      listingOfficeId: 10,
      listingStatus: 'in_review',
      anomalyFlags: ['price_per_sqft_out_of_range'],
    });
    const result = canTransition('in_review', 'approved', ctx);
    expect(result.allowed).toBe(false);
    expect(result.error).toMatch(/overrideReason/);
  });

  it('in_review → approved: merchant own_office, with flags, overrideReason 10 chars → allowed', () => {
    const ctx = makeCtx({
      actorRole: 'merchant',
      actorOfficeId: 10,
      listingOfficeId: 10,
      listingStatus: 'in_review',
      anomalyFlags: ['price_per_sqft_out_of_range'],
      overrideReason: '1234567890',
    });
    const result = canTransition('in_review', 'approved', ctx);
    expect(result.allowed).toBe(true);
  });

  it('in_review → approved: regular_user → NOT allowed', () => {
    const ctx = makeCtx({
      actorRole: 'regular_user',
      listingStatus: 'in_review',
    });
    const result = canTransition('in_review', 'approved', ctx);
    expect(result.allowed).toBe(false);
  });

  it('in_review → approved: different office merchant → NOT allowed', () => {
    const ctx = makeCtx({
      actorRole: 'merchant',
      actorOfficeId: 99,
      listingOfficeId: 10,
      listingStatus: 'in_review',
    });
    const result = canTransition('in_review', 'approved', ctx);
    expect(result.allowed).toBe(false);
  });

  // approved → published

  it('approved → published: merchant own_office → allowed', () => {
    const ctx = makeCtx({
      actorRole: 'merchant',
      actorOfficeId: 10,
      listingOfficeId: 10,
      listingStatus: 'approved',
    });
    const result = canTransition('approved', 'published', ctx);
    expect(result.allowed).toBe(true);
  });

  // draft → published (illegal)

  it('draft → published (illegal): NOT allowed', () => {
    const ctx = makeCtx({ actorRole: 'administrator', listingStatus: 'draft' });
    const result = canTransition('draft', 'published', ctx);
    expect(result.allowed).toBe(false);
  });

  // archived → published (illegal)

  it('archived → published (illegal): NOT allowed', () => {
    const ctx = makeCtx({ actorRole: 'administrator', listingStatus: 'archived' });
    const result = canTransition('archived', 'published', ctx);
    expect(result.allowed).toBe(false);
  });

  // published → in_review (reversal)

  it('published → in_review (reversal): merchant own_office with reason → allowed', () => {
    const ctx = makeCtx({
      actorRole: 'merchant',
      actorOfficeId: 10,
      listingOfficeId: 10,
      listingStatus: 'published',
      reason: 'Reversal needed',
    });
    const result = canTransition('published', 'in_review', ctx);
    expect(result.allowed).toBe(true);
  });

  it('published → in_review: merchant own_office without reason → NOT allowed', () => {
    const ctx = makeCtx({
      actorRole: 'merchant',
      actorOfficeId: 10,
      listingOfficeId: 10,
      listingStatus: 'published',
    });
    const result = canTransition('published', 'in_review', ctx);
    expect(result.allowed).toBe(false);
  });

  // deleted → draft

  it('deleted → draft: merchant own_office → allowed', () => {
    const ctx = makeCtx({
      actorRole: 'merchant',
      actorOfficeId: 10,
      listingOfficeId: 10,
      listingStatus: 'deleted',
    });
    const result = canTransition('deleted', 'draft', ctx);
    expect(result.allowed).toBe(true);
  });

  it('deleted → draft: regular_user → NOT allowed', () => {
    const ctx = makeCtx({
      actorRole: 'regular_user',
      listingStatus: 'deleted',
    });
    const result = canTransition('deleted', 'draft', ctx);
    expect(result.allowed).toBe(false);
  });

  it('deleted → draft: administrator → allowed', () => {
    const ctx = makeCtx({ actorRole: 'administrator', listingStatus: 'deleted' });
    const result = canTransition('deleted', 'draft', ctx);
    expect(result.allowed).toBe(true);
  });

  // any non-deleted → deleted

  it('draft → deleted: owner (regular_user) → allowed', () => {
    const ctx = makeCtx({ actorRole: 'regular_user', actorId: 1, listingCreatedBy: 1, listingStatus: 'draft' });
    const result = canTransition('draft', 'deleted', ctx);
    expect(result.allowed).toBe(true);
  });

  it('in_review → deleted: regular_user non-owner → NOT allowed', () => {
    const ctx = makeCtx({ actorRole: 'regular_user', actorId: 2, listingCreatedBy: 1, listingStatus: 'in_review' });
    const result = canTransition('in_review', 'deleted', ctx);
    expect(result.allowed).toBe(false);
  });
});
