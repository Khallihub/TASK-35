import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Mock idb — we test store logic, not IndexedDB itself
vi.mock('idb', () => {
  const store = new Map<string, unknown>()
  return {
    openDB: vi.fn().mockResolvedValue({
      getAll: vi.fn().mockImplementation(() => Promise.resolve([...store.values()])),
      put: vi.fn().mockImplementation((_name: string, value: { id: string }) => {
        store.set(value.id, value)
        return Promise.resolve()
      }),
      delete: vi.fn().mockImplementation((_name: string, key: string) => {
        store.delete(key)
        return Promise.resolve()
      }),
    }),
  }
})

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useOfflineStore', () => {
  it('enqueues items with correct default fields', async () => {
    const { useOfflineStore } = await import('@/stores/offline')
    const store = useOfflineStore()

    await store.enqueue({
      endpoint: '/api/v1/listings',
      method: 'POST',
      headers: { 'Idempotency-Key': 'test-key-123' },
      body: { title: 'Test Listing' },
      createdAt: Date.now(),
    })

    expect(store.items).toHaveLength(1)
    const item = store.items[0]
    expect(item.endpoint).toBe('/api/v1/listings')
    expect(item.method).toBe('POST')
    expect(item.attemptCount).toBe(0)
    expect(item.status).toBe('pending')
    expect(item.id).toBeTruthy()
  })

  it('dismisses items by id', async () => {
    const { useOfflineStore } = await import('@/stores/offline')
    const store = useOfflineStore()

    await store.enqueue({
      endpoint: '/test',
      method: 'POST',
      headers: {},
      body: null,
      createdAt: Date.now(),
    })

    const id = store.items[0].id
    await store.dismiss(id)

    expect(store.items).toHaveLength(0)
  })

  it('marks items as failed with error message', async () => {
    const { useOfflineStore } = await import('@/stores/offline')
    const store = useOfflineStore()

    await store.enqueue({
      endpoint: '/test',
      method: 'POST',
      headers: {},
      body: null,
      createdAt: Date.now(),
    })

    const id = store.items[0].id
    await store.markFailed(id, 'HTTP 400')

    expect(store.items[0].status).toBe('failed')
    expect(store.items[0].lastError).toBe('HTTP 400')
  })

  it('schedules retry with updated attempt count and delay', async () => {
    const { useOfflineStore } = await import('@/stores/offline')
    const store = useOfflineStore()

    await store.enqueue({
      endpoint: '/test',
      method: 'POST',
      headers: {},
      body: null,
      createdAt: Date.now(),
    })

    const id = store.items[0].id
    const before = Date.now()
    await store.scheduleRetry(id, 1, 5000)

    expect(store.items[0].attemptCount).toBe(1)
    expect(store.items[0].nextAttemptAt).toBeGreaterThanOrEqual(before + 5000)
  })

  it('tracks pending count correctly', async () => {
    const { useOfflineStore } = await import('@/stores/offline')
    const store = useOfflineStore()

    expect(store.pendingCount).toBe(0)

    await store.enqueue({
      endpoint: '/test',
      method: 'POST',
      headers: {},
      body: null,
      createdAt: Date.now(),
    })

    expect(store.pendingCount).toBe(1)

    await store.markFailed(store.items[0].id, 'error')

    expect(store.pendingCount).toBe(0)
  })
})
