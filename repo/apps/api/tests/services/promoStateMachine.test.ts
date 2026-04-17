import { canTransitionPromo } from '../../src/services/promoStateMachine';
import { PromoStatus } from '../../src/types/promo';

describe('canTransitionPromo', () => {
  it('draft → scheduled: operations allowed', () => {
    const result = canTransitionPromo('draft', 'scheduled', 'operations');
    expect(result.allowed).toBe(true);
  });

  it('draft → scheduled: administrator allowed', () => {
    const result = canTransitionPromo('draft', 'scheduled', 'administrator');
    expect(result.allowed).toBe(true);
  });

  it('draft → scheduled: regular_user NOT allowed', () => {
    const result = canTransitionPromo('draft', 'scheduled', 'regular_user');
    expect(result.allowed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('draft → scheduled: merchant NOT allowed', () => {
    const result = canTransitionPromo('draft', 'scheduled', 'merchant');
    expect(result.allowed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('draft → cancelled: operations allowed', () => {
    const result = canTransitionPromo('draft', 'cancelled', 'operations');
    expect(result.allowed).toBe(true);
  });

  it('draft → cancelled: administrator allowed', () => {
    const result = canTransitionPromo('draft', 'cancelled', 'administrator');
    expect(result.allowed).toBe(true);
  });

  it('scheduled → cancelled: operations allowed', () => {
    const result = canTransitionPromo('scheduled', 'cancelled', 'operations');
    expect(result.allowed).toBe(true);
  });

  it('scheduled → cancelled: administrator allowed', () => {
    const result = canTransitionPromo('scheduled', 'cancelled', 'administrator');
    expect(result.allowed).toBe(true);
  });

  it('scheduled → live: administrator allowed (force)', () => {
    const result = canTransitionPromo('scheduled', 'live', 'administrator');
    expect(result.allowed).toBe(true);
  });

  it('scheduled → live: operations NOT allowed (system only)', () => {
    const result = canTransitionPromo('scheduled', 'live', 'operations');
    expect(result.allowed).toBe(false);
  });

  it('live → cancelled: operations allowed (early termination)', () => {
    const result = canTransitionPromo('live', 'cancelled', 'operations');
    expect(result.allowed).toBe(true);
  });

  it('ended → cancelled: NOT allowed (terminal)', () => {
    const result = canTransitionPromo('ended', 'cancelled', 'operations');
    expect(result.allowed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('ended → scheduled: NOT allowed (terminal)', () => {
    const result = canTransitionPromo('ended', 'scheduled', 'administrator');
    expect(result.allowed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('cancelled → scheduled: NOT allowed (terminal)', () => {
    const result = canTransitionPromo('cancelled', 'scheduled', 'administrator');
    expect(result.allowed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('cancelled → draft: NOT allowed (terminal)', () => {
    const result = canTransitionPromo('cancelled' as PromoStatus, 'draft' as PromoStatus, 'administrator');
    expect(result.allowed).toBe(false);
  });

  it('draft → live: NOT allowed (must go through scheduled)', () => {
    const result = canTransitionPromo('draft', 'live', 'administrator');
    expect(result.allowed).toBe(false);
  });
});
