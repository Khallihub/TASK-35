import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { _resetFingerprintCache } from '@/api/fingerprint'
import { apiClient } from '@/api/client'
import type { InternalAxiosRequestConfig } from 'axios'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  _resetFingerprintCache()
})

/**
 * Helper: capture the headers that apiClient would send by using a custom adapter
 * that records the fully-intercepted config and rejects.
 */
async function captureRequestHeaders(
  method: 'get' | 'post',
  url: string,
  data?: unknown,
): Promise<Record<string, string>> {
  let captured: Record<string, string> = {}
  const origAdapter = apiClient.defaults.adapter

  apiClient.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    captured = Object.fromEntries(
      Object.entries(config.headers).filter(([, v]) => typeof v === 'string'),
    ) as Record<string, string>
    return Promise.reject({ __capture: true })
  }

  try {
    if (method === 'get') await apiClient.get(url)
    else await apiClient.post(url, data)
  } catch (e: unknown) {
    if (!(e as Record<string, unknown>).__capture) throw e
  } finally {
    apiClient.defaults.adapter = origAdapter
  }
  return captured
}

describe('apiClient request interceptor', () => {
  it('attaches X-Device-Fingerprint header to GET requests', async () => {
    const headers = await captureRequestHeaders('get', '/test')
    expect(headers['X-Device-Fingerprint']).toBeTruthy()
    expect(headers['X-Device-Fingerprint']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('attaches X-Device-Fingerprint header to POST requests', async () => {
    const headers = await captureRequestHeaders('post', '/test', { data: 'value' })
    expect(headers['X-Device-Fingerprint']).toBeTruthy()
  })

  it('attaches Idempotency-Key header to mutating requests', async () => {
    const headers = await captureRequestHeaders('post', '/test', { data: 'value' })
    expect(headers['Idempotency-Key']).toBeTruthy()
    expect(headers['Idempotency-Key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('does not attach Idempotency-Key to GET requests', async () => {
    const headers = await captureRequestHeaders('get', '/test')
    expect(headers['Idempotency-Key']).toBeUndefined()
  })

  it('uses stable fingerprint across multiple requests', async () => {
    const headers1 = await captureRequestHeaders('get', '/test1')
    const headers2 = await captureRequestHeaders('get', '/test2')
    expect(headers1['X-Device-Fingerprint']).toBe(headers2['X-Device-Fingerprint'])
  })
})
