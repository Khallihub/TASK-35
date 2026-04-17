import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/api/client'
import { attachmentsApi } from '@/api/attachments'
import type { InternalAxiosRequestConfig } from 'axios'

/**
 * Wrapper contract for the attachments API.
 *
 * - upload/replace send multipart/form-data with a `file` field
 * - rollback targets the listingId-scoped rollback path and carries revisionNo
 * - delete hits DELETE /listings/:listingId/attachments/:id
 *
 * onUploadProgress wiring is verified by invoking the axios progress callback
 * directly on the captured config.
 */

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

interface Captured {
  method: string
  url: string
  data?: unknown
  headers: Record<string, string>
  onUploadProgress?: (e: { loaded: number; total?: number }) => void
}

function captureAdapter(): { getCall(): Captured; restore(): void } {
  let captured: Captured | null = null
  const orig = apiClient.defaults.adapter
  apiClient.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    captured = {
      method: config.method ?? '',
      url: config.url ?? '',
      data: config.data,
      headers: Object.fromEntries(
        Object.entries(config.headers).filter(([, v]) => typeof v === 'string'),
      ) as Record<string, string>,
      onUploadProgress: config.onUploadProgress as Captured['onUploadProgress'],
    }
    return Promise.reject({ __capture: true })
  }
  return {
    getCall: () => captured!,
    restore: () => {
      apiClient.defaults.adapter = orig
    },
  }
}

async function swallow<T>(fn: () => Promise<T>): Promise<void> {
  try {
    await fn()
  } catch (e: unknown) {
    if (!(e as Record<string, unknown>).__capture) throw e
  }
}

describe('attachmentsApi upload + replace wire contract', () => {
  it('upload posts multipart/form-data to /listings/:id/attachments', async () => {
    const cap = captureAdapter()
    try {
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'x.jpg', { type: 'image/jpeg' })
      await swallow(() => attachmentsApi.upload(17, file))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('post')
    expect(call.url).toBe('/listings/17/attachments')
    // The request body is a FormData — verify the file field is present.
    expect(call.data).toBeInstanceOf(FormData)
    expect((call.data as FormData).has('file')).toBe(true)
    // Content-Type is set by the caller; axios fills in the boundary from FormData.
    expect(call.headers['Content-Type']).toBe('multipart/form-data')
  })

  it('upload invokes onProgress with a percentage when progress fires', async () => {
    const cap = captureAdapter()
    try {
      const file = new File([new Uint8Array([0xff, 0xd8])], 'x.jpg', { type: 'image/jpeg' })
      const progressCalls: number[] = []
      await swallow(() => attachmentsApi.upload(1, file, (pct) => progressCalls.push(pct)))
      const call = cap.getCall()
      // Simulate axios firing its progress event at 25%
      call.onUploadProgress?.({ loaded: 25, total: 100 })
      expect(progressCalls).toContain(25)
    } finally {
      cap.restore()
    }
  })

  it('replace PUTs multipart to /listings/:listingId/attachments/:id', async () => {
    const cap = captureAdapter()
    try {
      const file = new File([new Uint8Array([0xff, 0xd8])], 'x.jpg', { type: 'image/jpeg' })
      await swallow(() => attachmentsApi.replace(9, 42, file))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('put')
    expect(call.url).toBe('/listings/9/attachments/42')
    expect(call.data).toBeInstanceOf(FormData)
  })
})

describe('attachmentsApi rollback + delete + revisions', () => {
  it('rollback posts revisionNo in the body to the rollback endpoint', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => attachmentsApi.rollback(9, 42, 3))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('post')
    expect(call.url).toBe('/listings/9/attachments/42/rollback')
    const body = typeof call.data === 'string' ? JSON.parse(call.data) : call.data
    expect(body).toMatchObject({ revisionNo: 3 })
  })

  it('delete hits DELETE /listings/:listingId/attachments/:id', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => attachmentsApi.delete(9, 42))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('delete')
    expect(call.url).toBe('/listings/9/attachments/42')
  })

  it('getRevisions hits GET /listings/:listingId/attachments/:id/revisions', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => attachmentsApi.getRevisions(9, 42))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('get')
    expect(call.url).toBe('/listings/9/attachments/42/revisions')
  })
})
