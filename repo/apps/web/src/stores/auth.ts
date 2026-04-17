import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi } from '@/api/auth'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<{ id: number; username: string; role: string; officeId: number | null } | null>(null)
  const accessToken = ref<string | null>(null)
  const refreshToken = ref<string | null>(null)
  const requiresConsent = ref(false)
  const mustChangePassword = ref(false)
  const captchaChallenge = ref<{ question: string; token: string } | null>(null)

  const isAuthenticated = computed(() => !!accessToken.value && !!user.value)
  const isAdmin = computed(() => user.value?.role === 'administrator')
  const isOperations = computed(() => user.value?.role === 'operations')
  const isMerchant = computed(() => user.value?.role === 'merchant')
  const isRegularUser = computed(() => user.value?.role === 'regular_user')

  function persist() {
    if (accessToken.value) localStorage.setItem('hs_access_token', accessToken.value)
    else localStorage.removeItem('hs_access_token')
    if (refreshToken.value) localStorage.setItem('hs_refresh_token', refreshToken.value)
    else localStorage.removeItem('hs_refresh_token')
    if (user.value) localStorage.setItem('hs_user', JSON.stringify(user.value))
    else localStorage.removeItem('hs_user')
  }

  function loadFromStorage() {
    accessToken.value = localStorage.getItem('hs_access_token')
    refreshToken.value = localStorage.getItem('hs_refresh_token')
    const stored = localStorage.getItem('hs_user')
    if (stored) try { user.value = JSON.parse(stored) } catch { user.value = null }
  }

  async function login(username: string, password: string, captchaToken?: string, captchaAnswer?: number) {
    const nonceRes = await authApi.getLoginNonce()
    const nonce = nonceRes.data.data.nonce
    const res = await authApi.login(username, password, nonce, captchaToken, captchaAnswer)
    const d = res.data.data
    user.value = d.user
    accessToken.value = d.accessToken
    refreshToken.value = d.refreshToken
    requiresConsent.value = d.requiresConsent
    mustChangePassword.value = d.mustChangePassword
    persist()
  }

  async function logout() {
    try { await authApi.logout() } catch { /* ignore */ }
    user.value = null
    accessToken.value = null
    refreshToken.value = null
    requiresConsent.value = false
    mustChangePassword.value = false
    persist()
  }

  async function refresh() {
    if (!refreshToken.value) throw new Error('No refresh token')
    const res = await authApi.refresh(refreshToken.value)
    accessToken.value = res.data.data.accessToken
    refreshToken.value = res.data.data.refreshToken
    persist()
  }

  async function acceptConsent(versionId: number) {
    await authApi.acceptConsent(versionId)
    requiresConsent.value = false
  }

  async function changePassword(currentPassword: string, newPassword: string, nonce: string) {
    const res = await authApi.changePassword(currentPassword, newPassword, nonce)
    accessToken.value = res.data.data.accessToken
    refreshToken.value = res.data.data.refreshToken
    mustChangePassword.value = false
    persist()
  }

  return {
    user, accessToken, refreshToken, requiresConsent, mustChangePassword, captchaChallenge,
    isAuthenticated, isAdmin, isOperations, isMerchant, isRegularUser,
    login, logout, refresh, acceptConsent, changePassword, loadFromStorage,
  }
})
