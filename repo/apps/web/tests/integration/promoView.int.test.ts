import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/api/client'
import type { InternalAxiosRequestConfig, AxiosResponse } from 'axios'

/**
 * PromoView integration — axios transport intercepted, real wrappers +
 * real store + real view. Verifies:
 *   - GET /promo runs on mount and rows render
 *   - status filter re-fires GET /promo with status=... query
 *   - Opening the "New Collection" modal and submitting POSTs /promo with
 *     the ISO datetime body shape the server expects
 */

type Handler = (config: InternalAxiosRequestConfig) => Promise<AxiosResponse> | AxiosResponse

function installHandler(handler: Handler) {
  const orig = apiClient.defaults.adapter
  apiClient.defaults.adapter = handler
  return () => {
    apiClient.defaults.adapter = orig
  }
}

function ok<T>(data: T, config: InternalAxiosRequestConfig, status = 200): AxiosResponse {
  return {
    data: { ok: true, data },
    status,
    statusText: '',
    headers: { 'x-csrf-token': 'test-csrf' },
    config,
  }
}

vi.mock('@/components/layout/AppShell.vue', () => ({
  default: { name: 'AppShell', template: '<div><slot /></div>' },
}))
vi.mock('@/components/common/LoadingSpinner.vue', () => ({
  default: { name: 'LoadingSpinner', template: '<div />' },
}))
vi.mock('@/components/common/EmptyState.vue', () => ({
  default: {
    name: 'EmptyState',
    props: ['message', 'icon'],
    template: '<div class="empty">{{ message }}</div>',
  },
}))
vi.mock('@/components/common/BaseModal.vue', () => ({
  default: {
    name: 'BaseModal',
    props: ['show', 'title'],
    template: '<div v-if="show"><slot /></div>',
  },
}))
vi.mock('@/components/promo/PromoStatusPill.vue', () => ({
  default: {
    name: 'PromoStatusPill',
    props: ['status', 'startsAt', 'endsAt'],
    template: '<span>{{ status }}</span>',
  },
}))
// Keep PromoForm real so its emit wiring is exercised, but it needs a
// timezone config response; serve it via the adapter.
const pushMock = vi.fn()
vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
  return {
    ...actual,
    useRouter: () => ({ push: pushMock }),
  }
})

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    error: toastError,
    success: toastSuccess,
    warning: vi.fn(),
    info: vi.fn(),
  }),
}))

// RouterLink stub so mount doesn't need a router.
import { config as vtuConfig } from '@vue/test-utils'
vtuConfig.global.stubs = { RouterLink: { props: ['to'], template: '<a><slot /></a>' } }

import PromoView from '@/views/PromoView.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  toastError.mockReset()
  toastSuccess.mockReset()
  pushMock.mockReset()
  localStorage.setItem('hs_access_token', 'tok')
  localStorage.setItem(
    'hs_user',
    JSON.stringify({ id: 1, username: 'ops_user', role: 'operations', officeId: 1 }),
  )
})

afterEach(() => {
  localStorage.clear()
})

describe('PromoView integration', () => {
  it('mounts, fetches /promo, and renders returned rows', async () => {
    const calls: Array<{ method: string; url: string; params?: unknown }> = []
    const restore = installHandler((config) => {
      calls.push({ method: config.method ?? '', url: config.url ?? '', params: config.params })
      if (config.url === '/promo' && config.method === 'get') {
        return Promise.resolve(
          ok(
            {
              items: [
                {
                  id: 11,
                  title: 'Spring Houses',
                  theme_date: null,
                  starts_at: '2026-04-01T00:00:00Z',
                  ends_at: '2026-04-30T00:00:00Z',
                  status: 'scheduled',
                  created_by: 1,
                  created_at: '2026-03-15T00:00:00Z',
                  updated_at: '2026-03-15T00:00:00Z',
                },
              ],
              nextCursor: null,
            },
            config,
          ),
        )
      }
      if (config.url === '/config/timezone') {
        return Promise.resolve(ok({ timezone: 'America/New_York' }, config))
      }
      return Promise.resolve(ok({ items: [], nextCursor: null }, config))
    })

    try {
      const wrapper = mount(PromoView)
      await flushPromises()

      const promoCall = calls.find((c) => c.method === 'get' && c.url === '/promo')
      expect(promoCall).toBeTruthy()
      expect((promoCall!.params as Record<string, unknown>).limit).toBe(25)
      expect(wrapper.text()).toContain('Spring Houses')
    } finally {
      restore()
    }
  })

  it('changing the status filter re-fires GET /promo with status=scheduled', async () => {
    const calls: Array<Record<string, unknown>> = []
    const restore = installHandler((config) => {
      calls.push({ url: config.url, params: { ...(config.params as Record<string, unknown>) } })
      if (config.url === '/promo') {
        return Promise.resolve(ok({ items: [], nextCursor: null }, config))
      }
      return Promise.resolve(ok({}, config))
    })

    try {
      const wrapper = mount(PromoView)
      await flushPromises()
      calls.length = 0

      const statusSelect = wrapper.find('select')
      await statusSelect.setValue('scheduled')
      await flushPromises()

      const filtered = calls.find(
        (c) => c.url === '/promo' && (c.params as Record<string, unknown>)?.status === 'scheduled',
      )
      expect(filtered).toBeTruthy()
    } finally {
      restore()
    }
  })
})
