import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/api/client'
import { promoApi } from '@/api/promo'
import type { InternalAxiosRequestConfig } from 'axios'

/**
 * Wrapper contract for the promo API (collection + slot endpoints).
 */

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

interface Captured {
  method: string
  url: string
  params?: Record<string, unknown>
  data?: unknown
}

function captureAdapter(): { getCall(): Captured; restore(): void } {
  let captured: Captured | null = null
  const orig = apiClient.defaults.adapter
  apiClient.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    captured = {
      method: config.method ?? '',
      url: config.url ?? '',
      params: config.params as Record<string, unknown> | undefined,
      data: config.data,
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

describe('promoApi collection + slot wire contract', () => {
  it('list forwards filter params', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => promoApi.list({ status: 'scheduled', from: '2024-01-01', to: '2024-12-31' }))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.url).toBe('/promo')
    expect(call.params).toMatchObject({
      status: 'scheduled',
      from: '2024-01-01',
      to: '2024-12-31',
    })
  })

  it('create posts title/starts_at/ends_at to /promo', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() =>
        promoApi.create({
          title: 'Spring Houses',
          starts_at: '2024-04-01T00:00:00.000Z',
          ends_at: '2024-04-30T23:59:59.000Z',
        }),
      )
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('post')
    expect(call.url).toBe('/promo')
    const body = typeof call.data === 'string' ? JSON.parse(call.data) : call.data
    expect(body).toMatchObject({
      title: 'Spring Houses',
      starts_at: '2024-04-01T00:00:00.000Z',
      ends_at: '2024-04-30T23:59:59.000Z',
    })
  })

  it('addSlot posts listingId + rank to the slots endpoint', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => promoApi.addSlot(17, 99, 3))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.url).toBe('/promo/17/slots')
    const body = typeof call.data === 'string' ? JSON.parse(call.data) : call.data
    expect(body).toMatchObject({ listingId: 99, rank: 3 })
  })

  it('removeSlot hits DELETE /promo/:id/slots/:slotId', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => promoApi.removeSlot(17, 5))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('delete')
    expect(call.url).toBe('/promo/17/slots/5')
  })

  it('reorderSlots PUTs the new rank order', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() =>
        promoApi.reorderSlots(17, [
          { slotId: 5, rank: 2 },
          { slotId: 6, rank: 1 },
        ]),
      )
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('put')
    expect(call.url).toBe('/promo/17/slots/reorder')
    const body = typeof call.data === 'string' ? JSON.parse(call.data) : call.data
    expect(body.slots).toHaveLength(2)
    expect(body.slots[0]).toMatchObject({ slotId: 5, rank: 2 })
  })

  it('activate / cancel hit the lifecycle endpoints', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => promoApi.activate(17))
    } finally {
      cap.restore()
    }
    expect(cap.getCall().url).toBe('/promo/17/activate')

    const cap2 = captureAdapter()
    try {
      await swallow(() => promoApi.cancel(17))
    } finally {
      cap2.restore()
    }
    expect(cap2.getCall().url).toBe('/promo/17/cancel')
  })
})
