import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { openDB, type IDBPDatabase } from 'idb'

interface OutboxItem {
  id: string; endpoint: string; method: string;
  headers: Record<string, string>; body: unknown;
  createdAt: number; attemptCount: number; nextAttemptAt: number;
  lastError?: string; status: 'pending' | 'failed';
}

let db: IDBPDatabase | null = null

async function getDB() {
  if (!db) {
    db = await openDB('harborstone_offline', 1, {
      upgrade(d) { d.createObjectStore('outbox', { keyPath: 'id' }) },
    })
  }
  return db
}

export const useOfflineStore = defineStore('offline', () => {
  const items = ref<OutboxItem[]>([])
  const isOnline = ref(navigator.onLine)
  const pendingCount = computed(() => items.value.filter(i => i.status === 'pending').length)

  window.addEventListener('online', () => { isOnline.value = true })
  window.addEventListener('offline', () => { isOnline.value = false })

  async function load() {
    const d = await getDB()
    items.value = await d.getAll('outbox')
  }

  async function enqueue(item: Omit<OutboxItem, 'id' | 'attemptCount' | 'nextAttemptAt' | 'status'>) {
    const full: OutboxItem = { ...item, id: crypto.randomUUID(), attemptCount: 0, nextAttemptAt: Date.now(), status: 'pending' }
    const d = await getDB()
    await d.put('outbox', full)
    items.value.push(full)
  }

  async function dismiss(id: string) {
    const d = await getDB()
    await d.delete('outbox', id)
    items.value = items.value.filter(i => i.id !== id)
  }

  async function markFailed(id: string, error: string) {
    const d = await getDB()
    const item = items.value.find(i => i.id === id)
    if (item) {
      item.status = 'failed'
      item.lastError = error
      await d.put('outbox', { ...item })
    }
  }

  async function scheduleRetry(id: string, newAttemptCount: number, delayMs: number) {
    const d = await getDB()
    const item = items.value.find(i => i.id === id)
    if (item) {
      item.attemptCount = newAttemptCount
      item.nextAttemptAt = Date.now() + delayMs
      await d.put('outbox', { ...item })
    }
  }

  return { items, isOnline, pendingCount, load, enqueue, dismiss, markFailed, scheduleRetry }
})
