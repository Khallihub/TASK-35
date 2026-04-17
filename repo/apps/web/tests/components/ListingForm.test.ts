import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ListingForm from '@/components/listings/ListingForm.vue'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('ListingForm', () => {
  it('renders create mode when no listing prop is given', () => {
    const wrapper = mount(ListingForm)
    expect(wrapper.text()).toContain('Create Listing')
  })

  it('renders save mode when listing prop is given', () => {
    const wrapper = mount(ListingForm, {
      props: {
        listing: {
          id: 1,
          price_usd_cents: 50000000,
          beds: 3,
          baths: 2,
          area_sqft: 1500,
          area_sqm: null,
          floor_level: null,
          orientation: null,
          latitude: null,
          longitude: null,
          address_line: '123 Main',
          city: 'Boston',
          state_code: 'MA',
          postal_code: '02101',
          anomaly_flags: [],
        },
      },
    })
    expect(wrapper.text()).toContain('Save Changes')
  })

  it('shows validation error for invalid latitude', async () => {
    const wrapper = mount(ListingForm)
    const latInput = wrapper.find('input[type="number"][step="0.000001"]')
    await latInput.setValue('100')
    await latInput.trigger('blur')
    expect(wrapper.text()).toContain('Must be between -90 and 90')
  })

  it('shows validation error for invalid longitude', async () => {
    const wrapper = mount(ListingForm)
    const inputs = wrapper.findAll('input[type="number"][step="0.000001"]')
    // longitude is the second coordinate input
    const lonInput = inputs[1]
    await lonInput.setValue('200')
    await lonInput.trigger('blur')
    expect(wrapper.text()).toContain('Must be between -180 and 180')
  })

  it('shows validation error for non-numeric price', async () => {
    const wrapper = mount(ListingForm)
    const priceInput = wrapper.find('input[placeholder="500000"]')
    // type="number" inputs in happy-dom ignore non-numeric strings.
    // Test the validateField logic by setting the internal ref directly.
    const vm = wrapper.vm as unknown as { priceDollars: string; validateField: (f: string, v: string) => void }
    vm.priceDollars = 'abc'
    vm.validateField('priceDollars', 'abc')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Must be a valid number')
  })

  it('shows validation error for negative beds', async () => {
    const wrapper = mount(ListingForm)
    const bedsInput = wrapper.findAll('input[type="number"][step="1"][min="0"]')[0]
    await bedsInput.setValue('-1')
    await bedsInput.trigger('blur')
    expect(wrapper.text()).toContain('Must be a non-negative integer')
  })

  it('emits submit with correct data structure', async () => {
    const wrapper = mount(ListingForm)
    // Call handleSubmit directly — happy-dom button.trigger('click')
    // does not reliably dispatch Vue @click handlers.
    const vm = wrapper.vm as unknown as { handleSubmit: () => void }
    vm.handleSubmit()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('submit')).toBeTruthy()
    expect(wrapper.emitted('submit')![0]).toHaveLength(1)
    expect(typeof wrapper.emitted('submit')![0][0]).toBe('object')
  })

  it('converts price dollars to cents on submit', async () => {
    const wrapper = mount(ListingForm)
    const vm = wrapper.vm as unknown as { priceDollars: string; handleSubmit: () => void }
    vm.priceDollars = '1000'
    await wrapper.vm.$nextTick()
    vm.handleSubmit()
    await wrapper.vm.$nextTick()
    const emitted = wrapper.emitted('submit')![0][0] as Record<string, unknown>
    expect(emitted.price_usd_cents).toBe(100000)
  })

  it('displays anomaly flag banner when flags are present', () => {
    const wrapper = mount(ListingForm, {
      props: {
        listing: {
          id: 1,
          price_usd_cents: 100,
          beds: null,
          baths: null,
          area_sqft: null,
          area_sqm: null,
          floor_level: null,
          orientation: null,
          latitude: null,
          longitude: null,
          address_line: null,
          city: null,
          state_code: null,
          postal_code: null,
          anomaly_flags: ['price_per_sqft_low'],
        },
        role: 'merchant',
      },
    })
    expect(wrapper.findComponent({ name: 'AnomalyFlagBanner' }).exists()).toBe(true)
  })
})
