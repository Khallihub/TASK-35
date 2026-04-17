import { computed, watch, onUnmounted } from 'vue'
import { useOfflineStore } from '@/stores/offline'
import { apiClient } from '@/api/client'

/**
 * Backoff schedule per PRD §11.7: 5s, 30s, 2m, 10m, 30m; cap 6 attempts.
 */
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000]
const MAX_ATTEMPTS = 6

/** HTTP status codes that are non-retryable (4xx except 408, 409, 425, 429). */
function isNonRetryable(status: number): boolean {
  if (status >= 400 && status < 500) {
    return ![408, 409, 425, 429].includes(status)
  }
  return false
}

export function useOfflineQueue() {
  const store = useOfflineStore()

  let flushTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Process all pending items whose nextAttemptAt has passed.
   */
  async function flush() {
    if (!store.isOnline) return

    const now = Date.now()
    const pending = store.items.filter(
      (i) => i.status === 'pending' && i.nextAttemptAt <= now,
    )

    for (const item of pending) {
      try {
        await apiClient.request({
          url: item.endpoint,
          method: item.method,
          headers: {
            ...item.headers,
            // Re-use the original idempotency key for replay safety
            'Idempotency-Key': item.headers['Idempotency-Key'] ?? item.id,
          },
          data: item.body,
        })
        // Success — remove from outbox
        await store.dismiss(item.id)
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status ?? 0
        const newAttemptCount = item.attemptCount + 1

        if (isNonRetryable(status) || newAttemptCount >= MAX_ATTEMPTS) {
          // Terminal failure — mark as failed for user review
          await store.markFailed(
            item.id,
            `HTTP ${status || 'network error'}`,
          )
        } else {
          // Schedule retry with backoff
          const backoffIdx = Math.min(newAttemptCount - 1, BACKOFF_MS.length - 1)
          const delay = BACKOFF_MS[backoffIdx]
          await store.scheduleRetry(item.id, newAttemptCount, delay)
        }
      }
    }
  }

  // Flush on reconnect
  watch(
    () => store.isOnline,
    (online) => {
      if (online) flush()
    },
  )

  // Periodic runner (every 10s checks for items ready to retry)
  function start() {
    if (flushTimer) return
    store.load()
    flushTimer = setInterval(flush, 10_000)
    // Initial flush
    flush()
  }

  function stop() {
    if (flushTimer) {
      clearInterval(flushTimer)
      flushTimer = null
    }
  }

  onUnmounted(stop)

  return {
    isOnline: computed(() => store.isOnline),
    pendingCount: computed(() => store.pendingCount),
    items: computed(() => store.items),
    flush,
    start,
    stop,
  }
}
