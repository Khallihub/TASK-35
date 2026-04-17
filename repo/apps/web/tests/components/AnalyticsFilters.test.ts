import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import KpiCard from '@/components/analytics/KpiCard.vue'
import StatusBadge from '@/components/listings/StatusBadge.vue'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('KpiCard', () => {
  it('renders label and formatted value', () => {
    const wrapper = mount(KpiCard, {
      props: { label: 'Published Listings', value: 1234 },
    })
    expect(wrapper.text()).toContain('Published Listings')
    expect(wrapper.text()).toContain('1,234')
  })

  it('renders suffix when provided', () => {
    const wrapper = mount(KpiCard, {
      props: { label: 'Approval Rate', value: 85, suffix: '%' },
    })
    expect(wrapper.text()).toContain('85')
    expect(wrapper.text()).toContain('%')
  })

  it('renders zero value correctly', () => {
    const wrapper = mount(KpiCard, {
      props: { label: 'New Users', value: 0 },
    })
    expect(wrapper.text()).toContain('0')
  })
})

describe('StatusBadge', () => {
  const statuses = [
    { status: 'draft', expected: 'draft' },
    { status: 'in_review', expected: 'in review' },
    { status: 'approved', expected: 'approved' },
    { status: 'published', expected: 'published' },
    { status: 'archived', expected: 'archived' },
  ]

  statuses.forEach(({ status, expected }) => {
    it(`renders "${expected}" for status "${status}"`, () => {
      const wrapper = mount(StatusBadge, {
        props: { status },
      })
      expect(wrapper.text()).toBe(expected)
    })
  })

  it('applies correct badge variant class for published', () => {
    const wrapper = mount(StatusBadge, {
      props: { status: 'published' },
    })
    const badge = wrapper.find('.badge')
    expect(badge.classes()).toContain('badge-green')
  })

  it('applies correct badge variant class for draft', () => {
    const wrapper = mount(StatusBadge, {
      props: { status: 'draft' },
    })
    const badge = wrapper.find('.badge')
    expect(badge.classes()).toContain('badge-gray')
  })

  it('applies correct badge variant class for in_review', () => {
    const wrapper = mount(StatusBadge, {
      props: { status: 'in_review' },
    })
    const badge = wrapper.find('.badge')
    expect(badge.classes()).toContain('badge-blue')
  })
})
