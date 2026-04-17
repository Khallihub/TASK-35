import axios, { type AxiosInstance, type InternalAxiosRequestConfig, AxiosError } from 'axios'
import { useAuthStore } from '@/stores/auth'
import { useOfflineStore } from '@/stores/offline'
import { getDeviceFingerprint } from './fingerprint'

let csrfToken = ''
let csrfFetchPromise: Promise<void> | null = null
let isRefreshing = false
let refreshQueue: Array<(token: string) => void> = []

export const apiClient: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
})

/**
 * Fetch a CSRF token by making a lightweight GET request.
 * Called lazily before the first mutating request when no token is cached.
 */
async function ensureCsrfToken(): Promise<void> {
  if (csrfToken) return
  if (csrfFetchPromise) return csrfFetchPromise
  // Use /auth/nonce/publish — it requires auth but NOT consent, so it works
  // even before the user has accepted the consent modal. /auth/me requires
  // consent and would fail with 403 for new users.
  csrfFetchPromise = apiClient.get('/auth/nonce/publish').then((res) => {
    const token = res.headers['x-csrf-token']
    if (token) csrfToken = token
  }).finally(() => {
    csrfFetchPromise = null
  })
  return csrfFetchPromise
}

// Request interceptor: attach Bearer token, CSRF token, Idempotency-Key, Device Fingerprint
apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const auth = useAuthStore()
  if (auth.accessToken) {
    config.headers.Authorization = `Bearer ${auth.accessToken}`
  }
  // Device fingerprint for refresh-token binding and multi-device risk scoring (PRD §8.1)
  config.headers['X-Device-Fingerprint'] = getDeviceFingerprint()
  const mutating = ['post', 'put', 'patch', 'delete'].includes(config.method ?? '')
  if (mutating && !csrfToken && auth.accessToken) {
    await ensureCsrfToken()
  }
  if (csrfToken && mutating) {
    config.headers['X-CSRF-Token'] = csrfToken
  }
  if (mutating && !config.headers['Idempotency-Key']) {
    config.headers['Idempotency-Key'] = crypto.randomUUID()
  }
  return config
})

const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete'])

/**
 * Check if a failed request should be enqueued to the offline outbox.
 * Conditions: network error (no response), mutating method, JSON body (not multipart uploads).
 */
function shouldEnqueueOffline(error: AxiosError): boolean {
  // Must be a network error (no HTTP response received)
  if (error.response) return false
  // Must be a mutating request
  const method = error.config?.method?.toLowerCase() ?? ''
  if (!MUTATING_METHODS.has(method)) return false
  // Don't enqueue file uploads (multipart) — they can't be serialized to IndexedDB
  const contentType = (error.config?.headers?.['Content-Type'] as string) ?? ''
  if (contentType.includes('multipart/form-data')) return false
  // Don't enqueue auth endpoints (login/refresh have their own nonce/rotation semantics)
  const url = error.config?.url ?? ''
  if (url.includes('/auth/login') || url.includes('/auth/refresh')) return false
  return true
}

// Response interceptor: capture CSRF token, handle 401 with refresh, enqueue offline writes
apiClient.interceptors.response.use(
  (response) => {
    const csrf = response.headers['x-csrf-token']
    if (csrf) csrfToken = csrf
    return response
  },
  async (error: AxiosError) => {
    const auth = useAuthStore()

    // ── Offline outbox enqueue for network failures on mutating requests ──
    if (shouldEnqueueOffline(error) && error.config) {
      try {
        const offlineStore = useOfflineStore()
        const config = error.config
        const headers: Record<string, string> = {}
        // Preserve idempotency key and auth headers for replay
        if (config.headers['Idempotency-Key']) {
          headers['Idempotency-Key'] = String(config.headers['Idempotency-Key'])
        }
        if (config.headers['X-Nonce']) {
          // Nonces are single-use; can't replay — skip enqueue for nonce-bearing requests
          return Promise.reject(error)
        }
        if (config.headers['If-Match']) {
          headers['If-Match'] = String(config.headers['If-Match'])
        }

        await offlineStore.enqueue({
          endpoint: config.url ?? '',
          method: config.method?.toUpperCase() ?? 'POST',
          headers,
          body: config.data,
          createdAt: Date.now(),
        })
        // Return a synthetic response so the caller knows it was queued, not lost
        return Promise.reject(
          Object.assign(new Error('Request queued for offline retry'), { offline: true }),
        )
      } catch {
        // If enqueue fails, fall through to normal error handling
      }
    }

    // ── Token refresh on 401 ──
    // Only attempt token refresh if the failing request itself carried a Bearer token
    // (i.e. it was an authenticated call, not a login/refresh attempt).
    const hadBearer = !!(error.config?.headers?.Authorization as string | undefined)?.startsWith('Bearer ')
    if (error.response?.status === 401 && !isRefreshing && hadBearer) {
      isRefreshing = true
      try {
        await auth.refresh()
        const newToken = auth.accessToken!
        refreshQueue.forEach(fn => fn(newToken))
        refreshQueue = []
        // retry original
        if (error.config) {
          error.config.headers.Authorization = `Bearer ${newToken}`
          return apiClient(error.config)
        }
      } catch {
        auth.logout()
        window.location.href = '/login'
      } finally {
        isRefreshing = false
      }
    }
    return Promise.reject(error)
  }
)

export function extractError(error: unknown): string {
  if (error instanceof AxiosError && error.response?.data?.error) {
    const err = error.response.data.error as {
      message?: string
      details?: { errors?: Array<string | { field?: string; message?: string }> }
    }
    const message = err.message ?? 'Request failed'
    const details = err.details?.errors
    if (details && details.length > 0) {
      const msgs = details.map((e) =>
        typeof e === 'string' ? e : `${e.field}: ${e.message}`,
      )
      return `${message}: ${msgs.join('; ')}`
    }
    return message
  }
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred'
}
