import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/api/client'
import { adminApi } from '@/api/admin'
import type { InternalAxiosRequestConfig } from 'axios'

/**
 * Wrapper contract for the admin API (user management + blacklist + purge).
 *
 * The purge endpoints are the most sensitive — they must carry X-Nonce and
 * a `confirm: "PURGE <id>"` body to pass the server's guards. These tests
 * verify the wrapper builds the exact envelope the backend expects.
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

describe('adminApi user management', () => {
  it('updateUser translates officeId/mustChangePassword to snake_case', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() =>
        adminApi.updateUser(42, {
          role: 'merchant',
          status: 'active',
          officeId: 7,
          mustChangePassword: true,
          nonce: 'role-change-nonce',
        }),
      )
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('patch')
    expect(call.url).toBe('/users/42')
    const body = typeof call.data === 'string' ? JSON.parse(call.data) : call.data
    expect(body).toMatchObject({
      role: 'merchant',
      status: 'active',
      office_id: 7,
      must_change_password: true,
      nonce: 'role-change-nonce',
    })
  })

  it('unlockUser hits POST /users/:id/unlock', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => adminApi.unlockUser(42))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('post')
    expect(call.url).toBe('/users/42/unlock')
  })

  it('forceReset hits POST /users/:id/force-reset', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => adminApi.forceReset(42))
    } finally {
      cap.restore()
    }
    expect(cap.getCall().url).toBe('/users/42/force-reset')
  })
})

describe('adminApi blacklist', () => {
  it('addBlacklist posts the subject tuple', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() =>
        adminApi.addBlacklist({ subjectType: 'ip', subjectValue: '10.0.0.1', reason: 'brute force' }),
      )
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('post')
    expect(call.url).toBe('/admin/blacklist')
    const body = typeof call.data === 'string' ? JSON.parse(call.data) : call.data
    expect(body).toMatchObject({
      subjectType: 'ip',
      subjectValue: '10.0.0.1',
      reason: 'brute force',
    })
  })

  it('removeBlacklist hits DELETE /admin/blacklist/:id', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => adminApi.removeBlacklist(9))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('delete')
    expect(call.url).toBe('/admin/blacklist/9')
  })
})

describe('adminApi purge — X-Nonce + confirm envelope', () => {
  it('purgeListing posts { confirm: "PURGE <id>" } and X-Nonce', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => adminApi.purgeListing(77, 'purge-nonce-x'))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('post')
    expect(call.url).toBe('/admin/purge/listing/77')
    expect(call.headers['X-Nonce']).toBe('purge-nonce-x')
    const body = typeof call.data === 'string' ? JSON.parse(call.data) : call.data
    expect(body).toMatchObject({ confirm: 'PURGE 77' })
  })

  it('purgeUser posts { confirm: "PURGE <id>" } and X-Nonce', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => adminApi.purgeUser(99, 'purge-nonce-user'))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.url).toBe('/admin/purge/user/99')
    expect(call.headers['X-Nonce']).toBe('purge-nonce-user')
    const body = typeof call.data === 'string' ? JSON.parse(call.data) : call.data
    expect(body).toMatchObject({ confirm: 'PURGE 99' })
  })

  it('verifyAuditChain / getJobRuns hit the read endpoints', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => adminApi.verifyAuditChain())
    } finally {
      cap.restore()
    }
    expect(cap.getCall().url).toBe('/admin/audit-chain')

    const cap2 = captureAdapter()
    try {
      await swallow(() => adminApi.getJobRuns())
    } finally {
      cap2.restore()
    }
    expect(cap2.getCall().url).toBe('/admin/job-runs')
  })
})
