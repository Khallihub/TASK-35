import { apiClient } from './client'

export interface LoginResponse {
  user: { id: number; username: string; role: string; officeId: number | null }
  accessToken: string
  refreshToken: string
  requiresConsent: boolean
  mustChangePassword: boolean
}

export const authApi = {
  login: (username: string, password: string, nonce: string, captchaToken?: string, captchaAnswer?: number) =>
    apiClient.post<{ ok: boolean; data: LoginResponse }>('/auth/login', { username, password, nonce, captchaToken, captchaAnswer }),

  getLoginNonce: () =>
    apiClient.get<{ ok: boolean; data: { nonce: string } }>('/auth/nonce/login'),

  logout: () => apiClient.post('/auth/logout'),

  refresh: (refreshToken: string) =>
    apiClient.post<{ ok: boolean; data: { accessToken: string; refreshToken: string } }>('/auth/refresh', { refreshToken }),

  getConsentVersion: () =>
    apiClient.get<{ ok: boolean; data: { id: number; version: string; body_md: string } }>('/auth/consent-version'),

  acceptConsent: (versionId: number) =>
    apiClient.post('/auth/consent', { versionId }),

  getCaptchaChallenge: () =>
    apiClient.get<{ ok: boolean; data: { question: string; token: string } }>('/auth/captcha-challenge'),

  getNonce: (purpose: string) =>
    apiClient.get<{ ok: boolean; data: { nonce: string } }>(`/auth/nonce/${purpose}`),

  changePassword: (currentPassword: string, newPassword: string, nonce: string) =>
    apiClient.post<{ ok: boolean; data: { accessToken: string; refreshToken: string } }>(
      '/auth/change-password',
      { currentPassword, newPassword, nonce }
    ),

  me: () => apiClient.get<{ ok: boolean; data: { id: number; username: string; role: string; officeId: number | null } }>('/auth/me'),
}
