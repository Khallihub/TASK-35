<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { attachmentsApi, type AttachmentData } from '@/api/attachments'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'
import AppShell from '@/components/layout/AppShell.vue'
import AttachmentUploader from '@/components/attachments/AttachmentUploader.vue'
import AttachmentList from '@/components/attachments/AttachmentList.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'

const route = useRoute()
const auth = useAuthStore()
const toast = useToast()

const listingId = Number(route.params.id)
const attachments = ref<AttachmentData[]>([])
const rejections = ref<any[]>([])
const loading = ref(false)

async function loadAttachments() {
  loading.value = true
  try {
    const res = await attachmentsApi.list(listingId)
    attachments.value = res.data.data
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    loading.value = false
  }
}

async function loadRejections() {
  try {
    const res = await attachmentsApi.getRejections(listingId)
    rejections.value = res.data.data
  } catch {
    // Non-critical
  }
}

onMounted(() => {
  loadAttachments()
  loadRejections()
})

function onUploaded(att: AttachmentData) {
  attachments.value.push(att)
}

async function onDeleted(id: number) {
  try {
    await attachmentsApi.delete(listingId, id)
    attachments.value = attachments.value.filter(a => a.id !== id)
    toast.success('Attachment deleted.')
  } catch (err) {
    toast.error(extractError(err))
  }
}

function onRollback() {
  loadAttachments()
}
</script>

<template>
  <AppShell>
    <div class="page-header">
      <div style="display: flex; align-items: center; gap: 12px;">
        <RouterLink :to="`/listings/${listingId}`" class="btn btn-secondary btn-sm">← Back</RouterLink>
        <h1>Attachments — Listing #{{ listingId }}</h1>
      </div>
    </div>

    <!-- Uploader -->
    <div class="card" style="margin-bottom: 16px;">
      <div class="card-header"><h3>Upload Files</h3></div>
      <div class="card-body">
        <AttachmentUploader :listing-id="listingId" @uploaded="onUploaded" />
      </div>
    </div>

    <!-- List -->
    <div class="card" style="margin-bottom: 16px;">
      <div class="card-header"><h3>Files ({{ attachments.length }})</h3></div>
      <div class="card-body">
        <div v-if="loading" style="text-align: center;">
          <LoadingSpinner size="lg" />
        </div>
        <AttachmentList
          v-else
          :listing-id="listingId"
          :attachments="attachments"
          :role="auth.user?.role ?? ''"
          @deleted="onDeleted"
          @rollback="onRollback"
        />
      </div>
    </div>

    <!-- Rejections -->
    <div v-if="rejections.length > 0" class="card">
      <div class="card-header"><h3>Rejection History</h3></div>
      <div class="card-body">
        <table class="table">
          <thead>
            <tr>
              <th>Filename</th><th>Reason</th><th>Date</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rejections" :key="r.id">
              <td>{{ r.filename ?? '—' }}</td>
              <td>{{ r.reason_detail ?? r.reason_code ?? '—' }}</td>
              <td class="text-sm text-muted">{{ r.created_at ? new Date(r.created_at).toLocaleDateString() : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppShell>
</template>
