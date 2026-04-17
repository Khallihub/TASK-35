import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

/**
 * Sidebar role-visibility matrix.
 *
 * The sidebar dynamically builds navItems off the authenticated user's role.
 * The visibility contract is the source of truth for what menu items each
 * role sees — the router guard is the back-stop (tested in tests/router).
 */

vi.mock('@/composables/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ isOnline: { value: true } }),
}))

import { config } from '@vue/test-utils'
config.global.stubs = { RouterLink: { props: ['to'], template: '<a :data-to="to"><slot /></a>' } }

import Sidebar from '@/components/layout/Sidebar.vue'

async function withAuth(role: string | null) {
  setActivePinia(createPinia())
  const { useAuthStore } = await import('@/stores/auth')
  const store = useAuthStore()
  if (role) {
    store.accessToken = 'fake'
    store.user = { id: 1, username: 'u', role, officeId: 1 }
  }
}

beforeEach(() => {
  localStorage.clear()
})

function links(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('[data-to]').map((el) => el.attributes('data-to') || '')
}

describe('Sidebar — role navigation matrix', () => {
  it('regular_user sees only the Listings entry', async () => {
    await withAuth('regular_user')
    const wrapper = mount(Sidebar, { props: { collapsed: false } })
    expect(links(wrapper)).toEqual(['/listings'])
  })

  it('merchant sees Listings + Analytics', async () => {
    await withAuth('merchant')
    const wrapper = mount(Sidebar, { props: { collapsed: false } })
    expect(links(wrapper)).toEqual(['/listings', '/analytics'])
  })

  it('operations sees Listings + Analytics + Promotions', async () => {
    await withAuth('operations')
    const wrapper = mount(Sidebar, { props: { collapsed: false } })
    expect(links(wrapper)).toEqual(['/listings', '/analytics', '/promo'])
  })

  it('administrator sees all menu items including Admin', async () => {
    await withAuth('administrator')
    const wrapper = mount(Sidebar, { props: { collapsed: false } })
    expect(links(wrapper)).toEqual(['/listings', '/analytics', '/promo', '/admin'])
  })
})

describe('Sidebar — user footer', () => {
  it('renders the authenticated username + role badge when expanded', async () => {
    await withAuth('merchant')
    const wrapper = mount(Sidebar, { props: { collapsed: false } })
    expect(wrapper.text()).toContain('u')
    expect(wrapper.text()).toMatch(/merchant/i)
  })

  it('hides the user footer in collapsed mode', async () => {
    await withAuth('merchant')
    const wrapper = mount(Sidebar, { props: { collapsed: true } })
    expect(wrapper.find('.sidebar-user').exists()).toBe(false)
  })
})
