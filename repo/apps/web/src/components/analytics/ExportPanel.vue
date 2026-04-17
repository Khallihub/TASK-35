<script setup lang="ts">
import { ref } from 'vue'
import { analyticsApi } from '@/api/analytics'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'

const props = defineProps<{
  grain: string
  from: string
  to: string
  officeId?: number
  agentId?: number
}>()

const toast = useToast()
const exporting = ref(false)
const jobId = ref<number | null>(null)
const jobStatus = ref<string | null>(null)
const pollHandle = ref<ReturnType<typeof setInterval> | null>(null)

async function startExport() {
  exporting.value = true
  jobStatus.value = null
  jobId.value = null
  try {
    const res = await analyticsApi.createExport({
      grain: props.grain,
      from: props.from,
      to: props.to,
      officeId: props.officeId,
      agentId: props.agentId,
    })
    jobId.value = res.data.data.jobId
    jobStatus.value = res.data.data.status
    pollHandle.value = setInterval(pollJob, 3000)
  } catch (err) {
    toast.error(extractError(err))
    exporting.value = false
  }
}

async function pollJob() {
  if (jobId.value === null) return
  try {
    const res = await analyticsApi.getExportJob(jobId.value)
    jobStatus.value = res.data.data.status
    if (res.data.data.status === 'completed' || res.data.data.status === 'failed') {
      if (pollHandle.value) clearInterval(pollHandle.value)
      pollHandle.value = null
      exporting.value = false
      if (res.data.data.status === 'failed') {
        toast.error('Export job failed.')
        jobId.value = null
      }
    }
  } catch {
    if (pollHandle.value) clearInterval(pollHandle.value)
    exporting.value = false
  }
}

async function downloadExport() {
  if (jobId.value === null) return
  try {
    const res = await analyticsApi.downloadExport(jobId.value)
    const url = URL.createObjectURL(res.data as Blob)
    // Prefer server-provided filename from Content-Disposition header
    let filename = `analytics-export-${props.from}-${props.to}.csv`
    const disposition = res.headers?.['content-disposition'] as string | undefined
    if (disposition) {
      const match = disposition.match(/filename="?([^";\n]+)"?/)
      if (match?.[1]) filename = match[1]
    }
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    toast.error(extractError(err))
  }
}
</script>

<template>
  <div class="card">
    <div class="card-header">
      <h3>Export</h3>
    </div>
    <div class="card-body" style="display: flex; align-items: center; gap: 12px;">
      <button class="btn btn-secondary" :disabled="exporting" @click="startExport">
        <span v-if="exporting && jobStatus !== 'completed'" class="spinner spinner-sm" />
        <span v-else>Export CSV</span>
      </button>
      <div v-if="jobStatus" style="font-size: 13px; color: var(--color-text-muted);">
        Status: <strong>{{ jobStatus }}</strong>
      </div>
      <button
        v-if="jobStatus === 'completed' && jobId !== null"
        class="btn btn-primary btn-sm"
        @click="downloadExport"
      >
        Download
      </button>
    </div>
  </div>
</template>
