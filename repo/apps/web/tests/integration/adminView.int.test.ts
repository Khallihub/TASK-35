import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/api/client'
import type { InternalAxiosRequestConfig, AxiosResponse } from 'axios'

/**
 * AdminView integration test — NO MODULE MOCKS.
 *
 * Instead of stubbing @/api/admin, this test swaps axios' adapter so the
 * real apiClient + real adminApi wrapper fire HTTP requests that are
 * intercepted at the transport layer and served with realistic response
 * bodies. That keeps the contract surface (apiClient → wrapper → view)
 * real; only the remote endpoint is simulated. It catches the failure
 * modes pure module mocks can't: wrong path, wrong body shape, wrong
 * method, wrong header handling.
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

function err(status: number, message: string, config: InternalAxiosRequestConfig): AxiosResponse {
  return {
    data: { ok: false, error: { code: 'TEST', message } },
    status,
    statusText: '',
    headers: {},
    config,
  }
}

// Stubs for layout only — AppShell depends on the router + offline store
// and pulls in the full sidebar chrome. We want the AdminView logic, not
// the shell markup.
vi.mock('@/components/layout/AppShell.vue', () => ({
  default: { name: 'AppShell', template: '<div><slot /></div>' },
}))
vi.mock('@/components/common/LoadingSpinner.vue', () => ({
  default: { name: 'LoadingSpinner', template: '<div class="spinner" />' },
}))
vi.mock('@/components/common/ConfirmDialog.vue', () => ({
  default: {
    name: 'ConfirmDialog',
    props: ['show', 'title', 'message'],
    emits: ['confirm', 'cancel'],
    template: '<div v-if="show" class="confirm-stub">{{ title }}</div>',
  },
}))
vi.mock('@/components/common/BaseModal.vue', () => ({
  default: {
    name: 'BaseModal',
    props: ['show', 'title'],
    template: '<div v-if="show" class="modal-stub"><slot /></div>',
  },
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ error: toastError, success: toastSuccess, warning: vi.fn(), info: vi.fn() }),
}))

import AdminView from '@/views/AdminView.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  toastError.mockReset()
  toastSuccess.mockReset()
  // Seed an administrator in the auth store so the view renders without
  // being kicked out by internal role gates.
  localStorage.setItem('hs_access_token', 'token')
  localStorage.setItem(
    'hs_user',
    JSON.stringify({ id: 1, username: 'admin', role: 'administrator', officeId: 1 }),
  )
})

afterEach(() => {
  localStorage.clear()
})

describe('AdminView integration (real axios → stubbed HTTP)', () => {
  it('initial mount calls GET /users and renders user rows', async () => {
    const calls: Array<{ method: string; url: string }> = []
    const restore = installHandler((config) => {
      calls.push({ method: config.method ?? '', url: config.url ?? '' })
      if (config.url === '/users') {
        return Promise.resolve(
          ok(
            {
              items: [
                { id: 1, username: 'admin', role: 'administrator', status: 'active' },
                { id: 2, username: 'ops_user', role: 'operations', status: 'active' },
              ],
              nextCursor: null,
            },
            config,
          ),
        )
      }
      return Promise.resolve(ok([], config))
    })

    try {
      const wrapper = mount(AdminView)
      await flushPromises()
      // Visit the Users tab (it's the default but we also hit the fetch).
      await flushPromises()

      // The real wrapper calls GET /users (not /admin/users).
      expect(calls.some((c) => c.method === 'get' && c.url === '/users')).toBe(true)
      // Rendered rows must include both seeded usernames.
      expect(wrapper.text()).toContain('admin')
      expect(wrapper.text()).toContain('ops_user')
    } finally {
      restore()
    }
  })

  it('surfaces server 500 on users list via the toast', async () => {
    const restore = installHandler((config) => {
      if (config.url === '/users') {
        return Promise.reject({
          isAxiosError: true,
          response: err(500, 'db down', config),
          config,
          message: 'db down',
          name: 'AxiosError',
          toJSON: () => ({}),
        })
      }
      return Promise.resolve(ok([], config))
    })

    try {
      mount(AdminView)
      await flushPromises()
      await flushPromises()
      expect(toastError).toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('switching to Audit Chain tab fires POST-less GET /admin/audit-chain on verify click', async () => {
    const calls: string[] = []
    const restore = installHandler((config) => {
      calls.push(`${config.method}:${config.url}`)
      if (config.url === '/admin/audit-chain') {
        return Promise.resolve(ok({ valid: true }, config))
      }
      if (config.url === '/users') {
        return Promise.resolve(ok({ items: [], nextCursor: null }, config))
      }
      return Promise.resolve(ok([], config))
    })

    try {
      const wrapper = mount(AdminView)
      await flushPromises()

      // Switch to the Audit Chain tab via the real button.
      const auditTabBtn = wrapper.findAll('button').find((b) => /audit chain/i.test(b.text()))
      expect(auditTabBtn).toBeTruthy()
      await auditTabBtn!.trigger('click')
      await flushPromises()

      // Now click the Verify button.
      const verifyBtn = wrapper.findAll('button').find((b) => /verify/i.test(b.text()))
      expect(verifyBtn).toBeTruthy()
      await verifyBtn!.trigger('click')
      await flushPromises()

      expect(calls).toContain('get:/admin/audit-chain')
      expect(toastSuccess).toHaveBeenCalled()
    } finally {
      restore()
    }
  })
})
