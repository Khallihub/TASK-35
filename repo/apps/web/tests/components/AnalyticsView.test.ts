import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// Mock the analytics + admin API modules so the AnalyticsView mounts without
// real network calls. The test asserts that the `engagement_actions` KPI card
// renders from the data returned by the API — i.e. the engagement metric is
// wired end-to-end from the analytics endpoint to the dashboard view.
const getKpiMock = vi.fn()
const listOfficesMock = vi.fn()

vi.mock('@/api/analytics', () => ({
  analyticsApi: {
    getKpi: (...args: unknown[]) => getKpiMock(...args),
  },
}))

vi.mock('@/api/admin', () => ({
  adminApi: {
    listOffices: (...args: unknown[]) => listOfficesMock(...args),
  },
}))

// AppShell pulls in router-link / pinia-driven sidebar/topbar; stub it so the
// view test focuses on the KPI rendering surface instead of the chrome.
vi.mock('@/components/layout/AppShell.vue', () => ({
  default: {
    name: 'AppShell',
    template: '<div class="app-shell-stub"><slot /></div>',
  },
}))

vi.mock('@/components/analytics/ExportPanel.vue', () => ({
  default: { name: 'ExportPanel', template: '<div />' },
}))
vi.mock('@/components/analytics/FunnelChart.vue', () => ({
  default: { name: 'FunnelChart', template: '<div />' },
}))

import AnalyticsView from '@/views/AnalyticsView.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  getKpiMock.mockReset()
  listOfficesMock.mockReset()
  listOfficesMock.mockResolvedValue({ data: { data: [] } })
})

describe('AnalyticsView engagement_actions KPI', () => {
  it('renders the engagement_actions card from real API rollup data', async () => {
    // API response represents the rollup output that the analytics endpoint
    // would return — including the engagement_actions metric the dashboard
    // is required (per prompt §1) to surface.
    getKpiMock.mockResolvedValue({
      data: {
        data: {
          rows: [
            { grain_date: '2026-04-14', office_id: null, agent_id: null, metric: 'listings_published', value: 7 },
            { grain_date: '2026-04-14', office_id: null, agent_id: null, metric: 'new_users', value: 3 },
            { grain_date: '2026-04-14', office_id: null, agent_id: null, metric: 'active_users', value: 12 },
            { grain_date: '2026-04-14', office_id: null, agent_id: null, metric: 'engagement_actions', value: 42 },
          ],
          funnel: { draft: 10, approved: 4, published: 2, approvalRate: 0.4, publishRate: 0.5 },
        },
      },
    })

    const wrapper = mount(AnalyticsView)
    await flushPromises()

    const engagementCard = wrapper.find('[data-test="kpi-engagement-actions"]')
    expect(engagementCard.exists()).toBe(true)
    expect(engagementCard.text()).toMatch(/Engagement Actions/i)
    // Locale-formatted value for 42 is "42"; assert presence on the card.
    expect(engagementCard.text()).toContain('42')
  })

  it('renders 0 for engagement_actions when no events have been emitted', async () => {
    getKpiMock.mockResolvedValue({
      data: {
        data: {
          rows: [
            { grain_date: '2026-04-14', office_id: null, agent_id: null, metric: 'listings_published', value: 0 },
          ],
          funnel: { draft: 0, approved: 0, published: 0, approvalRate: 0, publishRate: 0 },
        },
      },
    })

    const wrapper = mount(AnalyticsView)
    await flushPromises()

    const engagementCard = wrapper.find('[data-test="kpi-engagement-actions"]')
    expect(engagementCard.exists()).toBe(true)
    expect(engagementCard.text()).toContain('0')
  })

  it('aggregates only global-level engagement_actions rows (office_id=null, agent_id=null)', async () => {
    getKpiMock.mockResolvedValue({
      data: {
        data: {
          rows: [
            { grain_date: '2026-04-13', office_id: null, agent_id: null, metric: 'engagement_actions', value: 5 },
            { grain_date: '2026-04-14', office_id: 1, agent_id: null, metric: 'engagement_actions', value: 9 },
            { grain_date: '2026-04-14', office_id: null, agent_id: null, metric: 'engagement_actions', value: 11 },
          ],
          funnel: { draft: 0, approved: 0, published: 0, approvalRate: 0, publishRate: 0 },
        },
      },
    })

    const wrapper = mount(AnalyticsView)
    await flushPromises()

    const engagementCard = wrapper.find('[data-test="kpi-engagement-actions"]')
    expect(engagementCard.exists()).toBe(true)
    // Only global rows (office_id=null, agent_id=null): 5 + 11 = 16
    // Office-level row (office_id=1) is a breakdown, not added to summary
    expect(engagementCard.text()).toContain('16')
  })
})
