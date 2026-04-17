import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/api/client'
import type { InternalAxiosRequestConfig, AxiosResponse } from 'axios'

/**
 * AnalyticsView integration — real analyticsApi + real KPI aggregation
 * logic, real axios transport. Only the far-end HTTP endpoint is
 * simulated. The previous test in AnalyticsView.test.ts mocked @/api/admin
 * and @/api/analytics, which hid wire-format issues. This test catches
 * them.
 */

type Handler = (config: InternalAxiosRequestConfig) => Promise<AxiosResponse> | AxiosResponse

function installHandler(handler: Handler) {
  const orig = apiClient.defaults.adapter
  apiClient.defaults.adapter = handler
  return () => {
    apiClient.defaults.adapter = orig
  }
}

function ok<T>(data: T, config: InternalAxiosRequestConfig): AxiosResponse {
  return {
    data: { ok: true, data },
    status: 200,
    statusText: '',
    headers: { 'x-csrf-token': 'csrf' },
    config,
  }
}

vi.mock('@/components/layout/AppShell.vue', () => ({
  default: { name: 'AppShell', template: '<div><slot /></div>' },
}))
// Keep ExportPanel + FunnelChart stubbed shallowly so the test stays
// focused on KPI wiring.
vi.mock('@/components/analytics/ExportPanel.vue', () => ({
  default: { name: 'ExportPanel', template: '<div class="export-stub" />' },
}))
vi.mock('@/components/analytics/FunnelChart.vue', () => ({
  default: { name: 'FunnelChart', template: '<div class="funnel-stub" />' },
}))

import AnalyticsView from '@/views/AnalyticsView.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.setItem('hs_access_token', 'tok')
  localStorage.setItem(
    'hs_user',
    JSON.stringify({ id: 1, username: 'ops_user', role: 'operations', officeId: 1 }),
  )
})

afterEach(() => {
  localStorage.clear()
})

describe('AnalyticsView integration', () => {
  it('fetches KPIs + offices on mount and aggregates engagement_actions across rows', async () => {
    const calls: Array<{ url: string; params?: Record<string, unknown> }> = []
    const restore = installHandler((config) => {
      calls.push({
        url: config.url ?? '',
        params: config.params as Record<string, unknown> | undefined,
      })
      if (config.url === '/analytics/kpi') {
        return Promise.resolve(
          ok(
            {
              rows: [
                { grain_date: '2026-04-14', office_id: null, agent_id: null, metric: 'engagement_actions', value: 10 },
                { grain_date: '2026-04-14', office_id: 1, agent_id: null, metric: 'engagement_actions', value: 7 },
                { grain_date: '2026-04-14', office_id: null, agent_id: null, metric: 'listings_published', value: 3 },
              ],
              funnel: { draft: 5, approved: 2, published: 1, approvalRate: 0.4, publishRate: 0.5 },
            },
            config,
          ),
        )
      }
      if (config.url === '/offices') {
        return Promise.resolve(ok([{ id: 1, name: 'Main', code: 'MAIN', active: 1 }], config))
      }
      return Promise.resolve(ok({}, config))
    })

    try {
      const wrapper = mount(AnalyticsView)
      await flushPromises()

      // KPI endpoint must be hit with grain + date range params built by
      // the view (defaults to the current day / daily grain).
      const kpiCall = calls.find((c) => c.url === '/analytics/kpi')
      expect(kpiCall).toBeTruthy()
      expect(kpiCall!.params).toMatchObject({
        grain: expect.any(String),
        from: expect.any(String),
        to: expect.any(String),
      })

      // Engagement card renders only global-level rows (office_id=null,
      // agent_id=null). The office-level row (value=7) is a breakdown,
      // not added to the summary.
      const engagementCard = wrapper.find('[data-test="kpi-engagement-actions"]')
      expect(engagementCard.exists()).toBe(true)
      expect(engagementCard.text()).toContain('10') // global row only
    } finally {
      restore()
    }
  })
})
