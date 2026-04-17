import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useToast } from '@/composables/useToast'

/**
 * Toast composable coverage.
 *
 * The toast queue:
 *   - adds a new entry with the given type + message and a unique id
 *   - caps the queue at 5 entries (FIFO drop)
 *   - auto-removes after 4000ms
 */

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Fresh toasts across tests — the module holds a shared ref, so drain
    // it explicitly at the top of each test.
    const { toasts } = useToast()
    toasts.value = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('success/error/warning/info push entries with the right type', () => {
    const t = useToast()
    t.success('ok')
    t.error('boom')
    t.warning('careful')
    t.info('fyi')
    const types = t.toasts.value.map((x) => x.type)
    expect(types).toEqual(['success', 'error', 'warning', 'info'])
    expect(t.toasts.value.map((x) => x.message)).toEqual(['ok', 'boom', 'careful', 'fyi'])
  })

  it('caps the queue at 5 entries (FIFO drop of the oldest)', () => {
    const t = useToast()
    for (let i = 0; i < 7; i++) t.info(`m${i}`)
    expect(t.toasts.value).toHaveLength(5)
    // Oldest two dropped — m0, m1 gone.
    expect(t.toasts.value[0].message).toBe('m2')
    expect(t.toasts.value[4].message).toBe('m6')
  })

  it('auto-removes a toast after ~4s', () => {
    const t = useToast()
    t.success('disappearing')
    expect(t.toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(4000)
    expect(t.toasts.value).toHaveLength(0)
  })

  it('gives each toast a unique id', () => {
    const t = useToast()
    t.info('a')
    t.info('b')
    const [a, b] = t.toasts.value
    expect(a.id).not.toBe(b.id)
  })
})
