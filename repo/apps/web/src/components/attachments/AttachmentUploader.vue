<script setup lang="ts">
import { ref } from 'vue'
import { attachmentsApi, type AttachmentData } from '@/api/attachments'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'

const props = defineProps<{ listingId: number }>()
const emit = defineEmits<{ uploaded: [attachment: AttachmentData] }>()

const toast = useToast()
const isDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

interface FileStatus {
  name: string
  progress: number
  status: 'uploading' | 'done' | 'error' | 'duplicate'
  error?: string
}

const fileStatuses = ref<FileStatus[]>([])

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp']
const VIDEO_MIME = ['video/mp4']
const PDF_MIME = ['application/pdf']
const ALLOWED_MIME = [...IMAGE_MIME, ...VIDEO_MIME, ...PDF_MIME]

const IMAGE_MAX_BYTES = 12 * 1024 * 1024   // 12 MB
const VIDEO_MAX_BYTES = 200 * 1024 * 1024  // 200 MB
const PDF_MAX_BYTES   = 20 * 1024 * 1024   // 20 MB
const MAX_ATTACHMENTS = 25

function getMaxSize(mime: string): { limit: number; label: string } {
  if (IMAGE_MIME.includes(mime)) return { limit: IMAGE_MAX_BYTES, label: '12MB' }
  if (VIDEO_MIME.includes(mime)) return { limit: VIDEO_MAX_BYTES, label: '200MB' }
  if (PDF_MIME.includes(mime)) return { limit: PDF_MAX_BYTES, label: '20MB' }
  return { limit: 0, label: '0' }
}

async function handleFiles(files: FileList | File[]) {
  const list = Array.from(files)
  if (fileStatuses.value.length + list.length > MAX_ATTACHMENTS) {
    toast.error(`Cannot exceed ${MAX_ATTACHMENTS} attachments per listing.`)
    return
  }
  for (const file of list) {
    if (!ALLOWED_MIME.includes(file.type)) {
      toast.error(`${file.name}: unsupported file type (${file.type}). Allowed: JPEG, PNG, WebP, MP4, PDF`)
      continue
    }
    const { limit, label } = getMaxSize(file.type)
    if (file.size > limit) {
      toast.error(`${file.name}: file too large (max ${label})`)
      continue
    }
    const entry: FileStatus = { name: file.name, progress: 0, status: 'uploading' }
    fileStatuses.value.push(entry)
    const idx = fileStatuses.value.length - 1
    try {
      const res = await attachmentsApi.upload(props.listingId, file, (pct) => {
        fileStatuses.value[idx].progress = pct
      })
      fileStatuses.value[idx].status = res.data.data.duplicate ? 'duplicate' : 'done'
      fileStatuses.value[idx].progress = 100
      emit('uploaded', res.data.data.attachment)
      if (res.data.data.duplicate) {
        toast.warning(`${file.name}: duplicate detected, existing attachment retained.`)
      } else {
        toast.success(`${file.name} uploaded.`)
      }
    } catch (err) {
      fileStatuses.value[idx].status = 'error'
      fileStatuses.value[idx].error = extractError(err)
      toast.error(`${file.name}: ${extractError(err)}`)
    }
  }
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files)
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) handleFiles(input.files)
  input.value = ''
}

function openFilePicker() {
  fileInput.value?.click()
}
</script>

<template>
  <div>
    <div
      class="drop-zone"
      :class="{ 'drop-active': isDragging }"
      @dragover.prevent="isDragging = true"
      @dragleave="isDragging = false"
      @drop.prevent="onDrop"
      @click="openFilePicker"
    >
      <input ref="fileInput" type="file" multiple style="display:none" accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf" @change="onFileChange" />
      <div style="font-size: 2rem; margin-bottom: 8px;">📎</div>
      <p style="font-weight: 500;">Drag &amp; drop files here or click to browse</p>
      <p class="text-muted text-sm" style="margin-top: 4px;">Supported: JPEG, PNG, WebP (12 MB), MP4 (200 MB), PDF (20 MB) — max 25 files per listing</p>
    </div>

    <!-- File status list -->
    <div v-if="fileStatuses.length > 0" style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px;">
      <div
        v-for="(f, idx) in fileStatuses"
        :key="idx"
        style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-surface);"
      >
        <span style="flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ f.name }}</span>
        <div v-if="f.status === 'uploading'" style="width: 120px; height: 6px; background: var(--color-border); border-radius: 3px;">
          <div :style="{ width: f.progress + '%', height: '100%', background: 'var(--color-primary)', borderRadius: '3px', transition: 'width .2s' }" />
        </div>
        <span v-else-if="f.status === 'done'" class="badge badge-green">Done</span>
        <span v-else-if="f.status === 'duplicate'" class="badge badge-yellow">Duplicate</span>
        <span v-else-if="f.status === 'error'" class="badge badge-red" :title="f.error">Error</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drop-zone {
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-lg);
  padding: 32px;
  text-align: center;
  cursor: pointer;
  transition: border-color var(--transition), background var(--transition);
}
.drop-zone:hover, .drop-active {
  border-color: var(--color-primary);
  background: rgba(26,75,140,.04);
}
</style>
