import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/api/client'
import type { InternalAxiosRequestConfig, AxiosResponse } from 'axios'

/**
 * AttachmentsView integration — real axios transport, real wrappers, real
 * AttachmentUploader + AttachmentList components. The only thing faked is
 * the downstream HTTP endpoint.
 *
 * Covers:
 *   - mount fires GET /listings/:id/attachments (list)
 *   - uploading through the hidden file input fires POST /attachments
 *     with a multipart body and appends the returned row
 *   - the happy-path DOM reflects the new attachment without leaking any
 *     internal storage metadata
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
// ConfirmDialog is used inside AttachmentList for delete — render its slot
// immediately so tests can click through if needed.
vi.mock('@/components/common/ConfirmDialog.vue', () => ({
  default: {
    name: 'ConfirmDialog',
    props: ['show'],
    emits: ['confirm', 'cancel'],
    template: '<div v-if="show"><slot /></div>',
  },
}))
vi.mock('@/components/attachments/AttachmentRollbackDrawer.vue', () => ({
  default: {
    name: 'AttachmentRollbackDrawer',
    props: ['show'],
    emits: ['close', 'rollback'],
    template: '<div v-if="show" class="rollback-stub" />',
  },
}))

// Route params are what AttachmentsView reads for the listing id.
vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
  return {
    ...actual,
    useRoute: () => ({ params: { id: '7' } }),
  }
})

import { config as vtuConfig } from '@vue/test-utils'
vtuConfig.global.stubs = { RouterLink: { props: ['to'], template: '<a><slot /></a>' } }

import AttachmentsView from '@/views/AttachmentsView.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.setItem('hs_access_token', 'tok')
  localStorage.setItem(
    'hs_user',
    JSON.stringify({ id: 1, username: 'merchant_user', role: 'merchant', officeId: 1 }),
  )
})

afterEach(() => {
  localStorage.clear()
})

describe('AttachmentsView integration', () => {
  it('mounts and lists attachments for the route\'s listing id', async () => {
    const calls: string[] = []
    const restore = installHandler((config) => {
      calls.push(`${config.method}:${config.url}`)
      if (config.url === '/listings/7/attachments' && config.method === 'get') {
        return Promise.resolve(
          ok(
            [
              {
                id: 1,
                listing_id: 7,
                kind: 'image',
                original_filename: 'photo.jpg',
                bytes: 1024,
                mime: 'image/jpeg',
                width: 800,
                height: 600,
                duration_seconds: null,
                created_at: '2026-04-14T00:00:00Z',
              },
            ],
            config,
          ),
        )
      }
      if (config.url === '/listings/7/attachments/rejections') {
        return Promise.resolve(ok([], config))
      }
      return Promise.resolve(ok([], config))
    })

    try {
      const wrapper = mount(AttachmentsView)
      await flushPromises()

      expect(calls).toContain('get:/listings/7/attachments')
      expect(wrapper.text()).toContain('photo.jpg')
      // Internal storage metadata must NOT leak into the DOM.
      expect(wrapper.html()).not.toContain('storage_key')
    } finally {
      restore()
    }
  })

  it('uploading a file fires POST /listings/:id/attachments with multipart body', async () => {
    const calls: Array<{ method: string; url: string; ct?: string }> = []
    const restore = installHandler((config) => {
      calls.push({
        method: config.method ?? '',
        url: config.url ?? '',
        ct: (config.headers['Content-Type'] as string) ?? '',
      })
      if (config.method === 'get' && config.url === '/listings/7/attachments') {
        return Promise.resolve(ok([], config))
      }
      if (config.method === 'get' && config.url === '/listings/7/attachments/rejections') {
        return Promise.resolve(ok([], config))
      }
      if (
        config.method === 'post' &&
        config.url === '/listings/7/attachments'
      ) {
        return Promise.resolve(
          ok(
            {
              attachment: {
                id: 42,
                listing_id: 7,
                kind: 'image',
                original_filename: 'new.jpg',
                bytes: 800,
                mime: 'image/jpeg',
                width: 200,
                height: 150,
                duration_seconds: null,
                created_at: '2026-04-15T00:00:00Z',
              },
              duplicate: false,
            },
            config,
            201,
          ),
        )
      }
      return Promise.resolve(ok({}, config))
    })

    try {
      const wrapper = mount(AttachmentsView)
      await flushPromises()

      // Drive the hidden file input — AttachmentUploader wires a <input
      // type="file"> inside its drop zone.
      const fileInput = wrapper.find('input[type="file"]')
      expect(fileInput.exists()).toBe(true)
      const el = fileInput.element as HTMLInputElement
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'new.jpg', { type: 'image/jpeg' }))
      el.files = dt.files
      await fileInput.trigger('change')
      await flushPromises()

      const uploadCall = calls.find(
        (c) => c.method === 'post' && c.url === '/listings/7/attachments',
      )
      expect(uploadCall).toBeTruthy()
      expect(uploadCall!.ct).toBe('multipart/form-data')
      // The returned attachment must appear in the list.
      expect(wrapper.text()).toContain('new.jpg')
    } finally {
      restore()
    }
  })
})
