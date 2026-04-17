import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/api/client'
import { listingsApi } from '@/api/listings'
import type { InternalAxiosRequestConfig } from 'axios'

/**
 * Coverage for the listings API wrapper. Asserts that:
 *   - filters flow into query params (list)
 *   - update sends If-Match with the caller's version (optimistic concurrency)
 *   - approve / publish send X-Nonce (state-transition replay protection)
 *
 * The adapter is swapped to capture the outbound config instead of hitting
 * the network, so these are true unit tests for the wrapper contract.
 */

interface CapturedCall {
  method: string
  url: string
  params?: Record<string, unknown>
  data?: unknown
  headers: Record<string, string>
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

function captureAdapter(): { getCalls(): CapturedCall[]; restore(): void } {
  const calls: CapturedCall[] = []
  const orig = apiClient.defaults.adapter
  apiClient.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    calls.push({
      method: config.method ?? '',
      url: config.url ?? '',
      params: config.params as Record<string, unknown> | undefined,
      data: config.data,
      headers: Object.fromEntries(
        Object.entries(config.headers).filter(([, v]) => typeof v === 'string'),
      ) as Record<string, string>,
    })
    return Promise.reject({ __capture: true })
  }
  return {
    getCalls: () => calls,
    restore: () => {
      apiClient.defaults.adapter = orig
    },
  }
}

async function swallowCapture<T>(fn: () => Promise<T>): Promise<void> {
  try {
    await fn()
  } catch (e: unknown) {
    if (!(e as Record<string, unknown>).__capture) throw e
  }
}

describe('listingsApi.list — filters flow into query params', () => {
  it('passes through status, office, price, and pagination filters', async () => {
    const cap = captureAdapter()
    try {
      await swallowCapture(() =>
        listingsApi.list({
          status: 'published',
          office_id: 2,
          price_min: 10000,
          price_max: 99999,
          city: 'Boston',
          state_code: 'MA',
          cursor: 'abc',
          limit: 25,
        }),
      )
    } finally {
      cap.restore()
    }
    const [call] = cap.getCalls()
    expect(call.method).toBe('get')
    expect(call.url).toBe('/listings')
    expect(call.params).toMatchObject({
      status: 'published',
      office_id: 2,
      price_min: 10000,
      price_max: 99999,
      city: 'Boston',
      state_code: 'MA',
      cursor: 'abc',
      limit: 25,
    })
  })

  it('sends an empty params object when no filters are provided', async () => {
    const cap = captureAdapter()
    try {
      await swallowCapture(() => listingsApi.list())
    } finally {
      cap.restore()
    }
    const [call] = cap.getCalls()
    expect(call.method).toBe('get')
    expect(call.params).toEqual({})
  })
})

describe('listingsApi.update — optimistic concurrency', () => {
  it('sends the current version as If-Match on PATCH', async () => {
    const cap = captureAdapter()
    try {
      await swallowCapture(() => listingsApi.update(42, { city: 'Seattle' }, 7))
    } finally {
      cap.restore()
    }
    const [call] = cap.getCalls()
    expect(call.method).toBe('patch')
    expect(call.url).toBe('/listings/42')
    expect(call.headers['If-Match']).toBe('7')
  })
})

describe('listingsApi state transitions carry single-use nonces', () => {
  it('approve sends X-Nonce', async () => {
    const cap = captureAdapter()
    try {
      await swallowCapture(() => listingsApi.approve(7, 'approve-nonce-1'))
    } finally {
      cap.restore()
    }
    const [call] = cap.getCalls()
    expect(call.url).toBe('/listings/7/approve')
    expect(call.headers['X-Nonce']).toBe('approve-nonce-1')
  })

  it('publish sends X-Nonce', async () => {
    const cap = captureAdapter()
    try {
      await swallowCapture(() => listingsApi.publish(7, 'publish-nonce-1'))
    } finally {
      cap.restore()
    }
    const [call] = cap.getCalls()
    expect(call.url).toBe('/listings/7/publish')
    expect(call.headers['X-Nonce']).toBe('publish-nonce-1')
  })

  it('approve forwards overrideReason in the request body for anomaly-flagged listings', async () => {
    const cap = captureAdapter()
    try {
      await swallowCapture(() =>
        listingsApi.approve(7, 'nonce', 'Manager validated price discrepancy'),
      )
    } finally {
      cap.restore()
    }
    const [call] = cap.getCalls()
    const body = typeof call.data === 'string' ? JSON.parse(call.data) : call.data
    expect(body).toMatchObject({ overrideReason: 'Manager validated price discrepancy' })
  })
})

describe('listingsApi.delete / restore / favorite', () => {
  it('delete hits DELETE /listings/:id', async () => {
    const cap = captureAdapter()
    try {
      await swallowCapture(() => listingsApi.delete(88))
    } finally {
      cap.restore()
    }
    const [call] = cap.getCalls()
    expect(call.method).toBe('delete')
    expect(call.url).toBe('/listings/88')
  })

  it('favorite hits POST /listings/:id/favorite', async () => {
    const cap = captureAdapter()
    try {
      await swallowCapture(() => listingsApi.favorite(88))
    } finally {
      cap.restore()
    }
    const [call] = cap.getCalls()
    expect(call.method).toBe('post')
    expect(call.url).toBe('/listings/88/favorite')
  })
})
