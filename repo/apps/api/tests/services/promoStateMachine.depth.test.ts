import { canTransitionPromo } from '../../src/services/promoStateMachine';
import { PromoStatus } from '../../src/types/promo';

describe('canTransitionPromo', () => {
  it('rejects any transition from terminal ended state', () => {
    const result = canTransitionPromo('ended', 'cancelled', 'administrator');
    expect(result.allowed).toBe(false);
    expect(result.error).toMatch(/ended/);
  });

  it('rejects any transition from terminal cancelled state', () => {
    expect(canTransitionPromo('cancelled', 'scheduled', 'administrator').allowed).toBe(false);
    expect(canTransitionPromo('cancelled', 'live', 'administrator').allowed).toBe(false);
  });

  it('draft → scheduled allowed for operations and administrator only', () => {
    expect(canTransitionPromo('draft', 'scheduled', 'operations').allowed).toBe(true);
    expect(canTransitionPromo('draft', 'scheduled', 'administrator').allowed).toBe(true);
    expect(canTransitionPromo('draft', 'scheduled', 'merchant').allowed).toBe(false);
    expect(canTransitionPromo('draft', 'scheduled', 'regular_user').allowed).toBe(false);
  });

  it('draft → cancelled allowed for ops/admin only', () => {
    expect(canTransitionPromo('draft', 'cancelled', 'operations').allowed).toBe(true);
    expect(canTransitionPromo('draft', 'cancelled', 'merchant').allowed).toBe(false);
  });

  it('rejects unknown draft → live transition', () => {
    const result = canTransitionPromo('draft', 'live', 'administrator');
    expect(result.allowed).toBe(false);
    expect(result.error).toMatch(/from draft to live/);
  });

  it('scheduled → live allowed for system or administrator', () => {
    expect(canTransitionPromo('scheduled', 'live', 'system').allowed).toBe(true);
    expect(canTransitionPromo('scheduled', 'live', 'administrator').allowed).toBe(true);
    expect(canTransitionPromo('scheduled', 'live', 'operations').allowed).toBe(false);
  });

  it('scheduled → cancelled allowed for ops/admin', () => {
    expect(canTransitionPromo('scheduled', 'cancelled', 'operations').allowed).toBe(true);
    expect(canTransitionPromo('scheduled', 'cancelled', 'administrator').allowed).toBe(true);
    expect(canTransitionPromo('scheduled', 'cancelled', 'merchant').allowed).toBe(false);
  });

  it('scheduled → draft is rejected', () => {
    const result = canTransitionPromo('scheduled', 'draft', 'administrator');
    expect(result.allowed).toBe(false);
    expect(result.error).toMatch(/from scheduled to draft/);
  });

  it('live → ended allowed for system/administrator only', () => {
    expect(canTransitionPromo('live', 'ended', 'system').allowed).toBe(true);
    expect(canTransitionPromo('live', 'ended', 'administrator').allowed).toBe(true);
    expect(canTransitionPromo('live', 'ended', 'operations').allowed).toBe(false);
  });

  it('live → cancelled allowed for ops/admin', () => {
    expect(canTransitionPromo('live', 'cancelled', 'operations').allowed).toBe(true);
    expect(canTransitionPromo('live', 'cancelled', 'merchant').allowed).toBe(false);
  });

  it('rejects live → scheduled transition', () => {
    const result = canTransitionPromo('live', 'scheduled', 'administrator');
    expect(result.allowed).toBe(false);
    expect(result.error).toMatch(/from live/);
  });

  it('returns error for unknown from status', () => {
    const result = canTransitionPromo('bogus' as PromoStatus, 'scheduled', 'administrator');
    expect(result.allowed).toBe(false);
    expect(result.error).toMatch(/Unknown from status/);
  });
});
