import { apiClient } from './client'

export const adminApi = {
  listUsers: (params?: { cursor?: string; limit?: number; search?: string }) =>
    apiClient.get<{ ok: boolean; data: { items: any[]; nextCursor: string | null } }>('/users', { params }),

  createUser: (data: { username: string; password: string; role: string; officeId?: number }) =>
    apiClient.post('/users', {
      username: data.username,
      password: data.password,
      role: data.role,
      office_id: data.officeId,
    }),

  updateUser: (id: number, data: { role?: string; status?: string; officeId?: number; mustChangePassword?: boolean; nonce?: string }) =>
    apiClient.patch(`/users/${id}`, {
      role: data.role,
      status: data.status,
      office_id: data.officeId,
      must_change_password: data.mustChangePassword,
      nonce: data.nonce,
    }),

  unlockUser: (id: number) =>
    apiClient.post(`/users/${id}/unlock`),

  forceReset: (id: number) =>
    apiClient.post(`/users/${id}/force-reset`),

  getRiskProfile: (userId: number) =>
    apiClient.get<{ ok: boolean; data: { profile: any; events: any[] } }>(`/admin/risk/${userId}`),

  applyPenalty: (userId: number, penaltyType: string, detail?: object) =>
    apiClient.post(`/admin/risk/${userId}/penalty`, { penaltyType, detail }),

  listBlacklist: () =>
    apiClient.get<{ ok: boolean; data: any[] }>('/admin/blacklist'),

  addBlacklist: (data: { subjectType: string; subjectValue: string; reason: string; expiresAt?: string }) =>
    apiClient.post('/admin/blacklist', data),

  removeBlacklist: (id: number) =>
    apiClient.delete(`/admin/blacklist/${id}`),

  purgeListing: (id: number, nonce: string) =>
    apiClient.post(`/admin/purge/listing/${id}`, { confirm: `PURGE ${id}` }, { headers: { 'X-Nonce': nonce } }),

  purgeUser: (id: number, nonce: string) =>
    apiClient.post(`/admin/purge/user/${id}`, { confirm: `PURGE ${id}` }, { headers: { 'X-Nonce': nonce } }),

  verifyAuditChain: () =>
    apiClient.get<{ ok: boolean; data: { valid: boolean; brokenAt?: string } }>('/admin/audit-chain'),

  getJobRuns: () =>
    apiClient.get<{ ok: boolean; data: any[] }>('/admin/job-runs'),

  listOffices: () =>
    apiClient.get<{ ok: boolean; data: any[] }>('/offices'),
}
