<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { analyticsApi, type KpiRow, type FunnelData } from '@/api/analytics'
import { adminApi } from '@/api/admin'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'
import AppShell from '@/components/layout/AppShell.vue'
import KpiCard from '@/components/analytics/KpiCard.vue'
import FunnelChart from '@/components/analytics/FunnelChart.vue'
import ExportPanel from '@/components/analytics/ExportPanel.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'

const auth = useAuthStore()
const toast = useToast()

// Filters
const grain = ref<'daily' | 'monthly'>('daily')
const _defaultFrom = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().split('T')[0]
})()
const dateFrom = ref(_defaultFrom)
const dateTo = ref(new Date().toISOString().split('T')[0])
const selectedOfficeId = ref<number | undefined>(undefined)
const selectedAgentId = ref<number | undefined>(undefined)
const offices = ref<any[]>([])

const loading = ref(false)
const kpiRows = ref<KpiRow[]>([])
const funnel = ref<FunnelData>({ draft: 0, approved: 0, published: 0, approvalRate: 0, publishRate: 0 })

// Aggregate KPI rows into summary cards — use only global-level rows
// (office_id=null, agent_id=null) to avoid double-counting per-office
// and per-agent breakdowns.
const kpiSummary = computed(() => {
  const sums: Record<string, number> = {}
  for (const row of kpiRows.value) {
    if (row.office_id === null && row.agent_id === null) {
      sums[row.metric] = (sums[row.metric] ?? 0) + row.value
    }
  }
  return sums
})

async function loadData() {
  loading.value = true
  try {
    const params = {
      grain: grain.value,
      from: dateFrom.value,
      to: dateTo.value,
      officeId: selectedOfficeId.value,
      agentId: selectedAgentId.value,
    }
    const res = await analyticsApi.getKpi(params)
    kpiRows.value = res.data.data.rows
    funnel.value = res.data.data.funnel
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    loading.value = false
  }
}

async function loadOffices() {
  if (auth.isAdmin || auth.isOperations) {
    try {
      const res = await adminApi.listOffices()
      offices.value = res.data.data
    } catch {
      // Non-critical
    }
  }
}

onMounted(() => {
  loadData()
  loadOffices()
})
</script>

<template>
  <AppShell>
    <div class="page-header">
      <h1>Analytics</h1>
    </div>

    <!-- Filter Bar -->
    <div class="card" style="margin-bottom: 16px;">
      <div class="card-body" style="display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end;">
        <div class="form-group" style="margin-bottom: 0; min-width: 120px;">
          <label class="form-label">Grain</label>
          <select v-model="grain" class="form-select">
            <option value="daily">Daily</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 0; min-width: 150px;">
          <label class="form-label">From</label>
          <input v-model="dateFrom" class="form-input" type="date" />
        </div>
        <div class="form-group" style="margin-bottom: 0; min-width: 150px;">
          <label class="form-label">To</label>
          <input v-model="dateTo" class="form-input" type="date" />
        </div>
        <div v-if="offices.length > 0" class="form-group" style="margin-bottom: 0; min-width: 160px;">
          <label class="form-label">Office</label>
          <select v-model="selectedOfficeId" class="form-select">
            <option :value="undefined">All Offices</option>
            <option v-for="o in offices" :key="o.id" :value="o.id">{{ o.name }}</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 0; min-width: 130px;">
          <label class="form-label">Agent ID</label>
          <input v-model.number="selectedAgentId" class="form-input" type="number" placeholder="All agents" />
        </div>
        <button class="btn btn-primary" :disabled="loading" @click="loadData">
          <span v-if="loading" class="spinner spinner-sm" />
          <span v-else>Apply</span>
        </button>
      </div>
    </div>

    <!-- KPI Cards -->
    <div v-if="loading" style="text-align: center; padding: 32px;">
      <LoadingSpinner size="lg" />
    </div>
    <template v-else>
      <div data-test="kpi-cards" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-bottom: 16px;">
        <KpiCard label="Published Listings" :value="(kpiSummary['listings_published'] ?? 0)" />
        <KpiCard label="New Users" :value="(kpiSummary['new_users'] ?? 0)" />
        <KpiCard label="Active Users" :value="(kpiSummary['active_users'] ?? 0)" />
        <KpiCard
          data-test="kpi-engagement-actions"
          label="Engagement Actions"
          :value="(kpiSummary['engagement_actions'] ?? 0)"
        />
        <KpiCard label="Approval Rate" :value="Math.round(funnel.approvalRate * 100)" suffix="%" />
        <KpiCard label="Publish Rate" :value="Math.round(funnel.publishRate * 100)" suffix="%" />
      </div>

      <!-- Funnel Chart -->
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-header"><h3>Listing Funnel</h3></div>
        <div class="card-body">
          <FunnelChart :funnel="funnel" />
          <div style="display: flex; gap: 24px; margin-top: 12px; font-size: 13px;">
            <span><strong>{{ funnel.draft }}</strong> Draft</span>
            <span><strong>{{ funnel.approved }}</strong> Approved</span>
            <span><strong>{{ funnel.published }}</strong> Published</span>
          </div>
        </div>
      </div>

      <!-- Export -->
      <ExportPanel
        :grain="grain"
        :from="dateFrom"
        :to="dateTo"
        :office-id="selectedOfficeId"
        :agent-id="selectedAgentId"
      />
    </template>
  </AppShell>
</template>
