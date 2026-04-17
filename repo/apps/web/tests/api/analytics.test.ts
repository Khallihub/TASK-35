import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/api/client'
import { analyticsApi } from '@/api/analytics'
import type { InternalAxiosRequestConfig } from 'axios'

/**
 * Wrapper contract for the analytics API (KPI / funnel / export lifecycle).
 */

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

interface Captured {
  method: string
  url: string
  params?: Record<string, unknown>
  data?: unknown
  responseType?: string
}

function captureAdapter(): { getCall(): Captured; restore(): void } {
  let captured: Captured | null = null
  const orig = apiClient.defaults.adapter
  apiClient.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    captured = {
      method: config.method ?? '',
      url: config.url ?? '',
      params: config.params as Record<string, unknown> | undefined,
      data: config.data,
      responseType: config.responseType as string | undefined,
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

describe('analyticsApi.getKpi', () => {
  it('passes grain/from/to/officeId/agentId as query params', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() =>
        analyticsApi.getKpi({
          grain: 'daily',
          from: '2024-01-01',
          to: '2024-01-31',
          officeId: 2,
          agentId: 7,
        }),
      )
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.url).toBe('/analytics/kpi')
    expect(call.params).toMatchObject({
      grain: 'daily',
      from: '2024-01-01',
      to: '2024-01-31',
      officeId: 2,
      agentId: 7,
    })
  })
})

describe('analyticsApi export lifecycle', () => {
  it('createExport sends grain/from/to as POST body', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() =>
        analyticsApi.createExport({ grain: 'monthly', from: '2024-01-01', to: '2024-03-31' }),
      )
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('post')
    expect(call.url).toBe('/analytics/exports')
    const body = typeof call.data === 'string' ? JSON.parse(call.data) : call.data
    expect(body).toMatchObject({ grain: 'monthly', from: '2024-01-01', to: '2024-03-31' })
  })

  it('getExportJob GETs /analytics/exports/:jobId', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => analyticsApi.getExportJob(42))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('get')
    expect(call.url).toBe('/analytics/exports/42')
  })

  it('downloadExport requests the CSV as a blob', async () => {
    const cap = captureAdapter()
    try {
      await swallow(() => analyticsApi.downloadExport(42))
    } finally {
      cap.restore()
    }
    const call = cap.getCall()
    expect(call.method).toBe('get')
    expect(call.url).toBe('/analytics/exports/42/download')
    expect(call.responseType).toBe('blob')
  })
})
