import { apiClient } from './client'

export interface KpiRow {
  grain_date: string; office_id: number | null; agent_id: number | null;
  metric: string; value: number;
}

export interface FunnelData {
  draft: number; approved: number; published: number;
  approvalRate: number; publishRate: number;
}

/**
 * Public export-job projection. file_key and sha256 are internal
 * storage-layer details and are stripped server-side; the UI relies on
 * `downloadUrl` (set when status === 'completed') to fetch the file.
 * See apps/api/src/services/exportService.ts#toPublicExportJob.
 */
export interface ExportJob {
  id: number; status: string;
  bytes: number | null; requested_at: string; completed_at: string | null; expires_at: string;
  downloadUrl?: string;
}

export const analyticsApi = {
  getKpi: (params: { grain: string; from: string; to: string; officeId?: number; agentId?: number }) =>
    apiClient.get<{ ok: boolean; data: { rows: KpiRow[]; funnel: FunnelData } }>('/analytics/kpi', { params }),

  getFunnel: (params: { from: string; to: string; officeId?: number }) =>
    apiClient.get<{ ok: boolean; data: FunnelData }>('/analytics/funnel', { params }),

  createExport: (params: { grain: string; from: string; to: string; officeId?: number; agentId?: number }) =>
    apiClient.post<{ ok: boolean; data: { jobId: number; status: string } }>('/analytics/exports', params),

  getExportJob: (jobId: number) =>
    apiClient.get<{ ok: boolean; data: ExportJob }>(`/analytics/exports/${jobId}`),

  downloadExport: (jobId: number) =>
    apiClient.get(`/analytics/exports/${jobId}/download`, { responseType: 'blob' }),
}
