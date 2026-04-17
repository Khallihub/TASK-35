import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/api/client'
import { authApi } from '@/api/auth'
import type { InternalAxiosRequestConfig } from 'axios'

/**
 * Wrapper contract for the auth API.
 */

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

interface Captured {
  method: string
  url: string
  data?: unknown
}

function captureAdapter(): { getCall(): Captured; restore(): void } {
  let captured: Captured | null = null
  const orig = apiClient.defaults.adapter
  apiClient.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    captured = {
      method: config.method ?? '',
      url: config.url ?? '',
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

describe('authApi wire contract', () => {
  it('login posts username/password/nonce (and captcha fields when present)', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() =>
        authApi.login('ops_user', 'Ops@harborstone1', 'login-nonce-1', 'captcha-tok', 7),
      )
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('post')
    expect(call.url).toBe('/auth/login')
    const body = typeof call.data === 'string' ? JSON.parse(call.data) : call.data
    expect(body).toMatchObject({
      username: 'ops_user',
      password: 'Ops@harborstone1',
      nonce: 'login-nonce-1',
      captchaToken: 'captcha-tok',
      captchaAnswer: 7,
    })
  })

  it('getLoginNonce hits GET /auth/nonce/login', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => authApi.getLoginNonce())
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('get')
    expect(call.url).toBe('/auth/nonce/login')
  })

  it('refresh posts the refreshToken in the body', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => authApi.refresh('rt-abc'))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.url).toBe('/auth/refresh')
    const body = typeof call.data === 'string' ? JSON.parse(call.data) : call.data
    expect(body).toMatchObject({ refreshToken: 'rt-abc' })
  })

  it('changePassword posts the credential + rotation nonce', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => authApi.changePassword('old-pw', 'New@Passw0rd!', 'change-pw-nonce'))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.url).toBe('/auth/change-password')
    const body = typeof call.data === 'string' ? JSON.parse(call.data) : call.data
    expect(body).toMatchObject({
      currentPassword: 'old-pw',
      newPassword: 'New@Passw0rd!',
      nonce: 'change-pw-nonce',
    })
  })

  it('acceptConsent posts the versionId', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => authApi.acceptConsent(3))
    } finally {
      cap.restore()
    }
    const body = typeof cap.getCall().data === 'string'
      ? JSON.parse(cap.getCall().data as string)
      : cap.getCall().data
    expect(body).toMatchObject({ versionId: 3 })
  })

  it('me hits GET /auth/me', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => authApi.me())
    } finally {
      cap.restore()
    }
    expect(cap.getCall().url).toBe('/auth/me')
  })

  it('getNonce targets the per-purpose endpoint', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => authApi.getNonce('publish'))
    } finally {
      cap.restore()
    }
    expect(cap.getCall().url).toBe('/auth/nonce/publish')
  })
})
