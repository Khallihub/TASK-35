<script setup lang="ts">
import { ref } from 'vue'
import { type AttachmentData } from '@/api/attachments'
import AttachmentRollbackDrawer from './AttachmentRollbackDrawer.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'

const props = defineProps<{
  listingId: number
  attachments: AttachmentData[]
  role: string
}>()

const emit = defineEmits<{ deleted: [id: number]; rollback: [id: number] }>()

const showRollback = ref(false)
const selectedAttachmentId = ref<number | null>(null)
const showDeleteConfirm = ref(false)
const deletingId = ref<number | null>(null)

const kindIcon: Record<string, string> = {
  image: '🖼️',
  video: '🎬',
  pdf: '📄',
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function openRollback(id: number) {
  selectedAttachmentId.value = id
  showRollback.value = true
}

function confirmDelete(id: number) {
  deletingId.value = id
  showDeleteConfirm.value = true
}

function handleDeleteConfirmed() {
  showDeleteConfirm.value = false
  if (deletingId.value !== null) {
    emit('deleted', deletingId.value)
    deletingId.value = null
  }
}

function onRolledBack() {
  if (selectedAttachmentId.value !== null) {
    emit('rollback', selectedAttachmentId.value)
  }
}
</script>

<template>
  <div>
    <div v-if="attachments.length === 0" class="empty-state">
      <p>No attachments yet.</p>
    </div>
    <table v-else class="table">
      <thead>
        <tr>
          <th>Kind</th>
          <th>Filename</th>
          <th>Size</th>
          <th>Uploaded</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="att in attachments" :key="att.id">
          <td style="font-size: 20px;">{{ kindIcon[att.kind] ?? '📎' }}</td>
          <td>
            <span class="truncate" style="max-width: 240px; display: inline-block;">{{ att.original_filename }}</span>
          </td>
          <td class="text-muted text-sm">{{ formatBytes(att.bytes) }}</td>
          <td class="text-muted text-sm">{{ new Date(att.created_at).toLocaleDateString() }}</td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button
                v-if="['merchant', 'administrator'].includes(role)"
                class="btn btn-secondary btn-sm"
                @click="openRollback(att.id)"
              >
                Revisions
              </button>
              <button
                v-if="['merchant', 'administrator'].includes(role)"
                class="btn btn-danger btn-sm"
                @click="confirmDelete(att.id)"
              >
                Delete
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <AttachmentRollbackDrawer
      v-if="selectedAttachmentId !== null"
      :listing-id="listingId"
      :attachment-id="selectedAttachmentId"
      :show="showRollback"
      @close="showRollback = false"
      @rolled-back="onRolledBack"
    />

    <ConfirmDialog
      :show="showDeleteConfirm"
      title="Delete Attachment"
      message="Are you sure you want to delete this attachment?"
      confirm-label="Delete"
      :dangerous="true"
      @confirm="handleDeleteConfirmed"
      @cancel="showDeleteConfirm = false"
    />
  </div>
</template>
