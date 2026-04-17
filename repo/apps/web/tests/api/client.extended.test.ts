import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { _resetFingerprintCache } from '@/api/fingerprint'
import { apiClient, extractError } from '@/api/client'
import type { InternalAxiosRequestConfig } from 'axios'
import { AxiosError } from 'axios'

/**
 * Extended apiClient coverage — scenarios the original client.test.ts does
 * not exercise:
 *   - Bearer header is attached when the auth store has a token
 *   - Bearer header is NOT attached when the store is anonymous (login path)
 *   - caller-provided Idempotency-Key is preserved, not overwritten
 *   - extractError unwraps the server's { error: { message } } envelope,
 *     falls back to Error.message, and returns a generic string for the
 *     unknown / undefined case
 */

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  _resetFingerprintCache()
})

async function captureRequestHeaders(
  method: 'get' | 'post',
  url: string,
  data?: unknown,
  requestHeaders?: Record<string, string>,
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
    if (method === 'get') await apiClient.get(url, { headers: requestHeaders })
    else await apiClient.post(url, data, { headers: requestHeaders })
  } catch (e: unknown) {
    if (!(e as Record<string, unknown>).__capture) throw e
  } finally {
    apiClient.defaults.adapter = origAdapter
  }
  return captured
}

describe('apiClient Authorization header', () => {
  it('attaches Bearer header when the auth store is authenticated', async () => {
    const { useAuthStore } = await import('@/stores/auth')
    const store = useAuthStore()
    store.accessToken = 'token-abc'

    const headers = await captureRequestHeaders('get', '/test')
    expect(headers.Authorization).toBe('Bearer token-abc')
  })

  it('does NOT attach Authorization header when the auth store is anonymous', async () => {
    const headers = await captureRequestHeaders('get', '/test')
    expect(headers.Authorization).toBeUndefined()
  })
})

describe('apiClient Idempotency-Key handling', () => {
  it('preserves a caller-provided Idempotency-Key verbatim (no overwrite)', async () => {
    const headers = await captureRequestHeaders(
      'post',
      '/listings',
      { city: 'Boston' },
      { 'Idempotency-Key': 'caller-supplied-key-123' },
    )
    expect(headers['Idempotency-Key']).toBe('caller-supplied-key-123')
  })

  it('generates a fresh UUIDv4 for each mutating request without a caller key', async () => {
    const a = await captureRequestHeaders('post', '/a', {})
    const b = await captureRequestHeaders('post', '/b', {})
    expect(a['Idempotency-Key']).toBeTruthy()
    expect(b['Idempotency-Key']).toBeTruthy()
    // Two calls, two distinct keys.
    expect(a['Idempotency-Key']).not.toBe(b['Idempotency-Key'])
  })
})

describe('extractError', () => {
  it('unwraps the { error: { message } } envelope from an AxiosError', () => {
    const err = new AxiosError('fallthrough')
    err.response = {
      status: 422,
      statusText: '',
      headers: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: {} as any,
      data: { ok: false, error: { code: 'VALIDATION_ERROR', message: 'beds must be non-negative' } },
    }
    expect(extractError(err)).toBe('beds must be non-negative')
  })

  it('falls back to Error.message when no envelope is present', () => {
    expect(extractError(new Error('network down'))).toBe('network down')
  })

  it('returns a generic string for unknown values (null/undefined/primitives)', () => {
    expect(extractError(undefined)).toBe('An unexpected error occurred')
    expect(extractError(null)).toBe('An unexpected error occurred')
    expect(extractError('bare string')).toBe('An unexpected error occurred')
    expect(extractError(42)).toBe('An unexpected error occurred')
  })
})
