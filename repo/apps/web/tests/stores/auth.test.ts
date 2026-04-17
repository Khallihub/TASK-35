import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * Auth store behavioural coverage.
 *
 * Exercises the full session lifecycle that the LoginView and the router
 * guard depend on:
 *   - login persists user, access/refresh tokens, consent + mustChangePassword
 *   - logout clears state and localStorage
 *   - refresh rotates tokens
 *   - loadFromStorage rehydrates a prior session
 *   - isAdmin / isOperations / isMerchant / isRegularUser role computeds
 *
 * The API layer is stubbed so the tests run against the store logic in
 * isolation; this is the boundary the router and views actually observe.
 */

const loginMock = vi.fn()
const nonceMock = vi.fn()
const logoutMock = vi.fn()
const refreshMock = vi.fn()
const acceptConsentMock = vi.fn()
const changePasswordMock = vi.fn()

vi.mock('@/api/auth', () => ({
  authApi: {
    login: (...args: unknown[]) => loginMock(...args),
    getLoginNonce: (...args: unknown[]) => nonceMock(...args),
    logout: (...args: unknown[]) => logoutMock(...args),
    refresh: (...args: unknown[]) => refreshMock(...args),
    acceptConsent: (...args: unknown[]) => acceptConsentMock(...args),
    changePassword: (...args: unknown[]) => changePasswordMock(...args),
    getConsentVersion: vi.fn(),
  },
}))

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  loginMock.mockReset()
  nonceMock.mockReset()
  logoutMock.mockReset()
  refreshMock.mockReset()
  acceptConsentMock.mockReset()
  changePasswordMock.mockReset()

  nonceMock.mockResolvedValue({ data: { data: { nonce: 'fresh-nonce' } } })
})

describe('useAuthStore — login lifecycle', () => {
  it('login hydrates user, tokens, and consent/change-password flags', async () => {
    loginMock.mockResolvedValue({
      data: {
        data: {
          user: { id: 7, username: 'ops_user', role: 'operations', officeId: 1 },
          accessToken: 'at-1',
          refreshToken: 'rt-1',
          requiresConsent: false,
          mustChangePassword: false,
        },
      },
    })

    const { useAuthStore } = await import('@/stores/auth')
    const store = useAuthStore()
    await store.login('ops_user', 'password')

    expect(store.isAuthenticated).toBe(true)
    expect(store.isOperations).toBe(true)
    expect(store.isAdmin).toBe(false)
    expect(store.accessToken).toBe('at-1')
    expect(store.refreshToken).toBe('rt-1')
    expect(store.user?.username).toBe('ops_user')
    expect(store.requiresConsent).toBe(false)
    expect(store.mustChangePassword).toBe(false)
    // Tokens and user are persisted so the router can rehydrate on reload.
    expect(localStorage.getItem('hs_access_token')).toBe('at-1')
    expect(localStorage.getItem('hs_refresh_token')).toBe('rt-1')
  })

  it('login surfaces mustChangePassword for admin bootstrap accounts', async () => {
    loginMock.mockResolvedValue({
      data: {
        data: {
          user: { id: 1, username: 'admin', role: 'administrator', officeId: 1 },
          accessToken: 'at-admin',
          refreshToken: 'rt-admin',
          requiresConsent: false,
          mustChangePassword: true,
        },
      },
    })

    const { useAuthStore } = await import('@/stores/auth')
    const store = useAuthStore()
    await store.login('admin', 'Admin@harborstone1')

    expect(store.isAdmin).toBe(true)
    expect(store.mustChangePassword).toBe(true)
  })

  it('login propagates requiresConsent so LoginView can mount ConsentModal', async () => {
    loginMock.mockResolvedValue({
      data: {
        data: {
          user: { id: 9, username: 'merchant_user', role: 'merchant', officeId: 1 },
          accessToken: 'at',
          refreshToken: 'rt',
          requiresConsent: true,
          mustChangePassword: false,
        },
      },
    })

    const { useAuthStore } = await import('@/stores/auth')
    const store = useAuthStore()
    await store.login('merchant_user', 'Merchant@harborstone1')
    expect(store.requiresConsent).toBe(true)
    expect(store.isMerchant).toBe(true)
  })

  it('logout clears state and removes tokens from localStorage', async () => {
    loginMock.mockResolvedValue({
      data: {
        data: {
          user: { id: 3, username: 'agent_user', role: 'regular_user', officeId: 1 },
          accessToken: 'at',
          refreshToken: 'rt',
          requiresConsent: false,
          mustChangePassword: false,
        },
      },
    })
    logoutMock.mockResolvedValue({ data: { ok: true } })

    const { useAuthStore } = await import('@/stores/auth')
    const store = useAuthStore()
    await store.login('agent_user', 'pw')
    expect(store.isAuthenticated).toBe(true)

    await store.logout()
    expect(store.isAuthenticated).toBe(false)
    expect(store.user).toBe(null)
    expect(store.accessToken).toBe(null)
    expect(store.refreshToken).toBe(null)
    expect(localStorage.getItem('hs_access_token')).toBe(null)
    expect(localStorage.getItem('hs_user')).toBe(null)
  })

  it('logout tolerates API failures (best-effort) and still clears local state', async () => {
    loginMock.mockResolvedValue({
      data: {
        data: {
          user: { id: 3, username: 'u', role: 'regular_user', officeId: 1 },
          accessToken: 'at',
          refreshToken: 'rt',
          requiresConsent: false,
          mustChangePassword: false,
        },
      },
    })
    logoutMock.mockRejectedValue(new Error('network down'))

    const { useAuthStore } = await import('@/stores/auth')
    const store = useAuthStore()
    await store.login('u', 'pw')
    await store.logout()
    expect(store.isAuthenticated).toBe(false)
  })
})

describe('useAuthStore — refresh + change-password', () => {
  it('refresh rotates access + refresh tokens and persists', async () => {
    const { useAuthStore } = await import('@/stores/auth')
    const store = useAuthStore()
    store.refreshToken = 'rt-old'
    refreshMock.mockResolvedValue({
      data: { data: { accessToken: 'at-new', refreshToken: 'rt-new' } },
    })

    await store.refresh()
    expect(store.accessToken).toBe('at-new')
    expect(store.refreshToken).toBe('rt-new')
    expect(localStorage.getItem('hs_refresh_token')).toBe('rt-new')
  })

  it('refresh throws when no refresh token is present', async () => {
    const { useAuthStore } = await import('@/stores/auth')
    const store = useAuthStore()
    await expect(store.refresh()).rejects.toThrow(/refresh/i)
  })

  it('changePassword stores new tokens and clears the mustChangePassword flag', async () => {
    const { useAuthStore } = await import('@/stores/auth')
    const store = useAuthStore()
    store.mustChangePassword = true

    changePasswordMock.mockResolvedValue({
      data: { data: { accessToken: 'at-after', refreshToken: 'rt-after' } },
    })

    await store.changePassword('old', 'new', 'nonce')
    expect(store.mustChangePassword).toBe(false)
    expect(store.accessToken).toBe('at-after')
    expect(store.refreshToken).toBe('rt-after')
  })
})

describe('useAuthStore — loadFromStorage rehydration', () => {
  it('restores access/refresh tokens and user from localStorage', async () => {
    localStorage.setItem('hs_access_token', 'at-persisted')
    localStorage.setItem('hs_refresh_token', 'rt-persisted')
    localStorage.setItem(
      'hs_user',
      JSON.stringify({ id: 42, username: 'rehydrated', role: 'administrator', officeId: null }),
    )

    const { useAuthStore } = await import('@/stores/auth')
    const store = useAuthStore()
    store.loadFromStorage()

    expect(store.accessToken).toBe('at-persisted')
    expect(store.refreshToken).toBe('rt-persisted')
    expect(store.user?.username).toBe('rehydrated')
    expect(store.isAdmin).toBe(true)
  })

  it('gracefully handles a corrupted user entry', async () => {
    localStorage.setItem('hs_user', '{not-json')

    const { useAuthStore } = await import('@/stores/auth')
    const store = useAuthStore()
    store.loadFromStorage()

    expect(store.user).toBe(null)
  })
})

describe('useAuthStore — role computeds mirror the API role model', () => {
  it.each([
    ['administrator', 'isAdmin'],
    ['operations', 'isOperations'],
    ['merchant', 'isMerchant'],
    ['regular_user', 'isRegularUser'],
  ])('role=%s => %s is true, others are false', async (role, flag) => {
    const { useAuthStore } = await import('@/stores/auth')
    const store = useAuthStore()
    store.user = { id: 1, username: 'u', role, officeId: 1 }
    store.accessToken = 'fake'

    const flags: Record<string, boolean> = {
      isAdmin: store.isAdmin,
      isOperations: store.isOperations,
      isMerchant: store.isMerchant,
      isRegularUser: store.isRegularUser,
    }
    expect(flags[flag]).toBe(true)
    for (const other of Object.keys(flags)) {
      if (other !== flag) expect(flags[other]).toBe(false)
    }
  })
})
