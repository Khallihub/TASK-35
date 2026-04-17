import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

describe('PromoStatusPill', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders Cancelled status', async () => {
    const { default: PromoStatusPill } = await import('@/components/promo/PromoStatusPill.vue')
    const wrapper = mount(PromoStatusPill, {
      props: {
        status: 'cancelled',
        startsAt: '2025-01-01T00:00:00Z',
        endsAt: '2025-12-31T23:59:59Z',
      },
    })
    expect(wrapper.text()).toBe('Cancelled')
  })

  it('renders Draft status', async () => {
    const { default: PromoStatusPill } = await import('@/components/promo/PromoStatusPill.vue')
    const wrapper = mount(PromoStatusPill, {
      props: {
        status: 'draft',
        startsAt: '2025-01-01T00:00:00Z',
        endsAt: '2025-12-31T23:59:59Z',
      },
    })
    expect(wrapper.text()).toBe('Draft')
  })

  it('renders Scheduled when current time is before start', async () => {
    vi.setSystemTime(new Date('2025-06-01T00:00:00Z'))
    const { default: PromoStatusPill } = await import('@/components/promo/PromoStatusPill.vue')
    const wrapper = mount(PromoStatusPill, {
      props: {
        status: 'active',
        startsAt: '2025-07-01T00:00:00Z',
        endsAt: '2025-08-01T00:00:00Z',
      },
    })
    expect(wrapper.text()).toBe('Scheduled')
  })

  it('renders Live when current time is within range', async () => {
    vi.setSystemTime(new Date('2025-07-15T00:00:00Z'))
    const { default: PromoStatusPill } = await import('@/components/promo/PromoStatusPill.vue')
    const wrapper = mount(PromoStatusPill, {
      props: {
        status: 'active',
        startsAt: '2025-07-01T00:00:00Z',
        endsAt: '2025-08-01T00:00:00Z',
      },
    })
    expect(wrapper.text()).toBe('Live')
  })

  it('renders Ended when current time is past end', async () => {
    vi.setSystemTime(new Date('2025-09-01T00:00:00Z'))
    const { default: PromoStatusPill } = await import('@/components/promo/PromoStatusPill.vue')
    const wrapper = mount(PromoStatusPill, {
      props: {
        status: 'active',
        startsAt: '2025-07-01T00:00:00Z',
        endsAt: '2025-08-01T00:00:00Z',
      },
    })
    expect(wrapper.text()).toBe('Ended')
  })
})
