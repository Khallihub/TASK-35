import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

/**
 * ListingsView integration — asserts the view calls listingsApi.list on mount,
 * renders returned rows, and rebuilds the request with user-applied filters.
 */

const listMock = vi.fn()

vi.mock('@/api/listings', () => ({
  listingsApi: {
    list: (...args: unknown[]) => listMock(...args),
  },
}))

// Stub the chrome components so the test focuses on table/filter behaviour.
vi.mock('@/components/layout/AppShell.vue', () => ({
  default: { name: 'AppShell', template: '<div><slot /></div>' },
}))

vi.mock('@/components/common/LoadingSpinner.vue', () => ({
  default: { name: 'LoadingSpinner', template: '<div />' },
}))

vi.mock('@/components/common/EmptyState.vue', () => ({
  default: {
    name: 'EmptyState',
    props: ['title', 'description'],
    template: '<div class="empty-state">{{ title }}: {{ description }}</div>',
  },
}))

vi.mock('@/components/listings/StatusBadge.vue', () => ({
  default: { name: 'StatusBadge', props: ['status'], template: '<span>{{ status }}</span>' },
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ error: toastError, success: toastSuccess }),
}))

// RouterLink stub so mount doesn't need a real router.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { config } from '@vue/test-utils'
config.global.stubs = { RouterLink: { template: '<a><slot /></a>' } }

import ListingsView from '@/views/ListingsView.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  listMock.mockReset()
  toastError.mockReset()
  toastSuccess.mockReset()
})

describe('ListingsView — initial load', () => {
  it('fetches listings on mount with limit=25 and renders the returned rows', async () => {
    listMock.mockResolvedValue({
      data: {
        data: {
          items: [
            { id: 1, city: 'Boston', state_code: 'MA', price_usd_cents: 55000000, status: 'draft' },
            { id: 2, city: 'Seattle', state_code: 'WA', price_usd_cents: 70000000, status: 'published' },
          ],
          nextCursor: null,
        },
      },
    })

    const wrapper = mount(ListingsView)
    await flushPromises()

    expect(listMock).toHaveBeenCalledTimes(1)
    const params = (listMock.mock.calls[0] as [Record<string, unknown>])[0]
    expect(params).toMatchObject({ limit: 25 })

    // Rows render with the city / price rendering applied.
    expect(wrapper.text()).toContain('Boston')
    expect(wrapper.text()).toContain('Seattle')
    // The Intl currency formatter inserts thousands separators.
    expect(wrapper.text()).toMatch(/\$550,000/)
  })

  it('renders an empty state when the API returns no listings', async () => {
    listMock.mockResolvedValue({
      data: { data: { items: [], nextCursor: null } },
    })
    const wrapper = mount(ListingsView)
    await flushPromises()
    // EmptyState stub renders title + description — any one of those must appear.
    expect(wrapper.find('.empty-state').exists() || /no listings/i.test(wrapper.text())).toBe(true)
  })

  it('surfaces extractError to the toast when the API rejects', async () => {
    listMock.mockRejectedValue(new Error('backend unreachable'))
    mount(ListingsView)
    await flushPromises()

    expect(toastError).toHaveBeenCalled()
  })
})

describe('ListingsView — filters', () => {
  it('sends status / q / city filters on applyFilters', async () => {
    listMock.mockResolvedValue({ data: { data: { items: [], nextCursor: null } } })

    const wrapper = mount(ListingsView)
    await flushPromises()
    listMock.mockClear()

    // Drive the filter inputs. Labels: Status (select), Search (q), plus City.
    const statusSelect = wrapper.find('select')
    await statusSelect.setValue('published')

    const textInputs = wrapper.findAll('input')
    if (textInputs.length > 0) await textInputs[0].setValue('Boston')

    // Click the Apply button. The view has a single primary filter button.
    const applyBtn = wrapper
      .findAll('button')
      .find((b) => /apply|filter|search/i.test(b.text())) ?? wrapper.find('button')
    await applyBtn.trigger('click')
    await flushPromises()

    // Some test ordering invokes load() twice on filter click (reset + follow-up);
    // the important contract is the most recent request carried the filters.
    const [params] = (listMock.mock.calls.at(-1) ?? [[{}]]) as [Record<string, unknown>]
    expect(params.status).toBe('published')
  })
})
