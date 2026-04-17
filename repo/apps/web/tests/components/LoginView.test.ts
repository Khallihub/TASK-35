import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

/**
 * LoginView user journey — drives the sign-in surface end-to-end through
 * the auth store boundary (API stubbed). Verifies that:
 *
 *   - successful login routes to /listings
 *   - invalid credentials surface a generic error without account state
 *     disclosure (PRD §8.2)
 *   - after 5 failed attempts, OfflineCaptcha is revealed
 *   - the ConsentModal appears when requiresConsent is true
 *   - the ChangePasswordModal appears when mustChangePassword is true
 */

const loginMock = vi.fn()
const getConsentVersionMock = vi.fn()
const getLoginNonceMock = vi.fn()
const acceptConsentMock = vi.fn()
const changePasswordMock = vi.fn()

vi.mock('@/api/auth', () => ({
  authApi: {
    login: (...a: unknown[]) => loginMock(...a),
    getLoginNonce: (...a: unknown[]) => getLoginNonceMock(...a),
    getConsentVersion: (...a: unknown[]) => getConsentVersionMock(...a),
    acceptConsent: (...a: unknown[]) => acceptConsentMock(...a),
    changePassword: (...a: unknown[]) => changePasswordMock(...a),
    logout: vi.fn(),
    refresh: vi.fn(),
    getCaptchaChallenge: vi.fn().mockResolvedValue({
      data: { data: { question: 'what is 2+2?', token: 'captcha-tok' } },
    }),
  },
}))

const pushMock = vi.fn()
vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
  return {
    ...actual,
    useRouter: () => ({ push: pushMock }),
  }
})

vi.mock('@/components/auth/ConsentModal.vue', () => ({
  default: {
    name: 'ConsentModal',
    props: ['versionId'],
    emits: ['accepted'],
    template: '<div class="consent-stub" @click="$emit(\'accepted\')">consent-modal</div>',
  },
}))

vi.mock('@/components/auth/ChangePasswordModal.vue', () => ({
  default: {
    name: 'ChangePasswordModal',
    emits: ['changed'],
    template: '<div class="change-password-stub">change-password-modal</div>',
  },
}))

vi.mock('@/components/auth/OfflineCaptcha.vue', () => ({
  default: {
    name: 'OfflineCaptcha',
    emits: ['submit'],
    template: '<div class="offline-captcha-stub">captcha</div>',
  },
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}))

import { AxiosError } from 'axios'
import LoginView from '@/views/LoginView.vue'

function axiosErr(message: string): AxiosError {
  const err = new AxiosError('boom')
  err.response = {
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: {} as any,
    data: { ok: false, error: { code: 'INVALID_CREDENTIALS', message } },
  }
  return err
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  loginMock.mockReset()
  getConsentVersionMock.mockReset()
  getLoginNonceMock.mockReset()
  acceptConsentMock.mockReset()
  changePasswordMock.mockReset()
  pushMock.mockReset()

  getLoginNonceMock.mockResolvedValue({ data: { data: { nonce: 'fresh-nonce' } } })
})

function fillAndSubmit(wrapper: ReturnType<typeof mount>, username: string, password: string) {
  const usernameInput = wrapper.find('input[autocomplete="username"]')
  const passwordInput = wrapper.find('input[autocomplete="current-password"]')
  return (async () => {
    await usernameInput.setValue(username)
    await passwordInput.setValue(password)
    const btn = wrapper.findAll('button').find((b) => /sign in/i.test(b.text()))!
    await btn.trigger('click')
    await flushPromises()
  })()
}

describe('LoginView — happy path', () => {
  it('successful login navigates to /listings', async () => {
    loginMock.mockResolvedValue({
      data: {
        data: {
          user: { id: 1, username: 'ops_user', role: 'operations', officeId: 1 },
          accessToken: 'at',
          refreshToken: 'rt',
          requiresConsent: false,
          mustChangePassword: false,
        },
      },
    })

    const wrapper = mount(LoginView)
    await fillAndSubmit(wrapper, 'ops_user', 'Ops@harborstone1')

    expect(pushMock).toHaveBeenCalledWith('/listings')
  })
})

describe('LoginView — failure paths', () => {
  it('invalid credentials surface an error message without routing', async () => {
    // The store throws when the underlying authApi.login rejects. The view
    // extracts error text via @/api/client#extractError.
    loginMock.mockRejectedValue(axiosErr('Invalid credentials'))

    const wrapper = mount(LoginView)
    await fillAndSubmit(wrapper, 'ops_user', 'wrong')

    expect(pushMock).not.toHaveBeenCalledWith('/listings')
    const errorEl = wrapper.find('.form-error')
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.text()).toMatch(/invalid credentials/i)
    // Generic error — must not reveal locked/disabled state.
    expect(errorEl.text()).not.toMatch(/locked|disabled/i)
  })

  it('after 5 failed attempts the OfflineCaptcha surface is revealed', async () => {
    loginMock.mockRejectedValue(axiosErr('Invalid credentials'))

    const wrapper = mount(LoginView)
    for (let i = 0; i < 5; i++) {
      await fillAndSubmit(wrapper, 'ops_user', 'wrong')
    }
    expect(wrapper.find('.offline-captcha-stub').exists()).toBe(true)
  })
})

describe('LoginView — consent + mustChangePassword gating', () => {
  it('shows the ConsentModal when requiresConsent is true (skips redirect)', async () => {
    loginMock.mockResolvedValue({
      data: {
        data: {
          user: { id: 1, username: 'u', role: 'merchant', officeId: 1 },
          accessToken: 'at',
          refreshToken: 'rt',
          requiresConsent: true,
          mustChangePassword: false,
        },
      },
    })
    getConsentVersionMock.mockResolvedValue({
      data: { data: { id: 7, version: '1.1', body_md: 'Accept me' } },
    })

    const wrapper = mount(LoginView)
    await fillAndSubmit(wrapper, 'u', 'pw')
    await flushPromises()

    expect(wrapper.find('.consent-stub').exists()).toBe(true)
    // Login does NOT redirect yet — the user must accept consent first.
    expect(pushMock).not.toHaveBeenCalledWith('/listings')
  })

  it('shows the ChangePasswordModal when mustChangePassword is true', async () => {
    loginMock.mockResolvedValue({
      data: {
        data: {
          user: { id: 1, username: 'admin', role: 'administrator', officeId: 1 },
          accessToken: 'at',
          refreshToken: 'rt',
          requiresConsent: false,
          mustChangePassword: true,
        },
      },
    })

    const wrapper = mount(LoginView)
    await fillAndSubmit(wrapper, 'admin', 'Admin@harborstone1')
    await flushPromises()

    expect(wrapper.find('.change-password-stub').exists()).toBe(true)
    expect(pushMock).not.toHaveBeenCalledWith('/listings')
  })
})
