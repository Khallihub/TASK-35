<script setup lang="ts">
import { ref } from 'vue'
import { listingsApi, type ListingData } from '@/api/listings'
import { authApi } from '@/api/auth'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'

const props = defineProps<{
  listing: ListingData
  role: string
  officeId: number | null
}>()

const emit = defineEmits<{ updated: [listing: ListingData] }>()

const toast = useToast()

const showConfirm = ref(false)
const confirmTitle = ref('')
const confirmMessage = ref('')
const confirmLabel = ref('Confirm')
const isDangerous = ref(false)
const pendingAction = ref<(() => Promise<void>) | null>(null)

const showReasonInput = ref(false)
const reasonLabel = ref('')
const reason = ref('')
const reasonAction = ref<((r: string) => Promise<void>) | null>(null)

const overrideReason = ref('')
const loading = ref(false)

function canSubmit() {
  return props.role !== 'operations' && ['draft', 'in_review'].includes(props.listing.status)
    && props.listing.status === 'draft'
}
function isMerchantSameOffice() {
  return props.role === 'merchant' && props.officeId != null && props.officeId === props.listing.office_id
}
function canApprove() {
  return (isMerchantSameOffice() || props.role === 'administrator') && props.listing.status === 'in_review'
}
function canReject() {
  return (isMerchantSameOffice() || props.role === 'administrator') && props.listing.status === 'in_review'
}
function canPublish() {
  return (isMerchantSameOffice() || props.role === 'administrator') && props.listing.status === 'approved'
}
function canArchive() {
  return (isMerchantSameOffice() || props.role === 'administrator') && props.listing.status === 'published'
}
function canReverse() {
  return (isMerchantSameOffice() || props.role === 'administrator') && props.listing.status === 'published'
}
function canDelete() {
  return (isMerchantSameOffice() || props.role === 'administrator') && props.listing.status === 'draft'
}
function canRestore() {
  return (props.role === 'merchant' || props.role === 'administrator') && props.listing.status === 'deleted'
}

function doConfirm(title: string, message: string, label: string, dangerous: boolean, action: () => Promise<void>) {
  confirmTitle.value = title
  confirmMessage.value = message
  confirmLabel.value = label
  isDangerous.value = dangerous
  pendingAction.value = action
  showConfirm.value = true
}

function doReasonInput(label: string, action: (r: string) => Promise<void>) {
  reasonLabel.value = label
  reason.value = ''
  reasonAction.value = action
  showReasonInput.value = true
}

async function executeConfirm() {
  showConfirm.value = false
  if (pendingAction.value) {
    loading.value = true
    try {
      await pendingAction.value()
    } finally {
      loading.value = false
      pendingAction.value = null
    }
  }
}

async function executeReason() {
  if (!reason.value.trim()) {
    toast.error('A reason is required.')
    return
  }
  showReasonInput.value = false
  if (reasonAction.value) {
    loading.value = true
    try {
      await reasonAction.value(reason.value)
    } finally {
      loading.value = false
      reasonAction.value = null
    }
  }
}

async function handleSubmit() {
  doConfirm('Submit Listing', 'Submit this listing for review?', 'Submit', false, async () => {
    const res = await listingsApi.submit(props.listing.id)
    emit('updated', res.data.data)
    toast.success('Listing submitted for review.')
  })
}

async function handleApprove() {
  const hasFlags = props.listing.anomaly_flags.length > 0
  if (hasFlags && (!overrideReason.value.trim() || overrideReason.value.trim().length < 10)) {
    toast.error('Override reason (min 10 characters) is required for listings with anomaly flags.')
    return
  }
  loading.value = true
  let nonce = ''
  try {
    const nr = await authApi.getNonce('approve')
    nonce = nr.data.data.nonce
  } finally {
    loading.value = false
  }
  doConfirm('Approve Listing', 'Approve this listing?', 'Approve', false, async () => {
    const override = hasFlags ? overrideReason.value.trim() : undefined
    const res = await listingsApi.approve(props.listing.id, nonce, override)
    emit('updated', res.data.data)
    toast.success('Listing approved.')
    overrideReason.value = ''
  })
}

async function handleReject() {
  doReasonInput('Rejection reason', async (r) => {
    const res = await listingsApi.reject(props.listing.id, r)
    emit('updated', res.data.data)
    toast.success('Listing rejected.')
  })
}

async function handlePublish() {
  loading.value = true
  let nonce = ''
  try {
    const nr = await authApi.getNonce('publish')
    nonce = nr.data.data.nonce
  } finally {
    loading.value = false
  }
  doConfirm('Publish Listing', 'Publish this listing? It will be visible publicly.', 'Publish', false, async () => {
    const res = await listingsApi.publish(props.listing.id, nonce)
    emit('updated', res.data.data)
    toast.success('Listing published.')
  })
}

async function handleArchive() {
  doReasonInput('Archive reason', async (r) => {
    const res = await listingsApi.archive(props.listing.id, r)
    emit('updated', res.data.data)
    toast.success('Listing archived.')
  })
}

async function handleReverse() {
  doReasonInput('Reversal reason', async (r) => {
    const res = await listingsApi.reverse(props.listing.id, r)
    emit('updated', res.data.data)
    toast.success('Listing reversed to approved.')
  })
}

async function handleDelete() {
  doConfirm('Delete Listing', 'Are you sure you want to delete this listing? This action cannot be undone.', 'Delete', true, async () => {
    await listingsApi.delete(props.listing.id)
    emit('updated', { ...props.listing, status: 'deleted' })
    toast.success('Listing deleted.')
  })
}

async function handleRestore() {
  doConfirm('Restore Listing', 'Restore this deleted listing to draft?', 'Restore', false, async () => {
    const res = await listingsApi.restore(props.listing.id)
    emit('updated', res.data.data)
    toast.success('Listing restored.')
  })
}
</script>

<template>
  <div>
    <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
      <template v-if="!loading">
        <button v-if="canSubmit()" class="btn btn-primary btn-sm" @click="handleSubmit">Submit for Review</button>
        <template v-if="canApprove()">
          <div v-if="listing.anomaly_flags.length > 0" class="form-group" style="margin-bottom: 0; min-width: 200px;">
            <input v-model="overrideReason" class="form-input" placeholder="Override reason (min 10 chars, required)" />
          </div>
          <button class="btn btn-primary btn-sm" @click="handleApprove">Approve</button>
        </template>
        <button v-if="canReject()" class="btn btn-danger btn-sm" @click="handleReject">Reject</button>
        <button v-if="canPublish()" class="btn btn-primary btn-sm" @click="handlePublish">Publish</button>
        <button v-if="canArchive()" class="btn btn-secondary btn-sm" @click="handleArchive">Archive</button>
        <button v-if="canReverse()" class="btn btn-secondary btn-sm" @click="handleReverse">Reverse to Approved</button>
        <button v-if="canDelete()" class="btn btn-danger btn-sm" @click="handleDelete">Delete</button>
        <button v-if="canRestore()" class="btn btn-secondary btn-sm" @click="handleRestore">Restore</button>
      </template>
      <div v-else class="spinner spinner-sm" />
    </div>

    <!-- Confirm Dialog -->
    <ConfirmDialog
      :show="showConfirm"
      :title="confirmTitle"
      :message="confirmMessage"
      :confirm-label="confirmLabel"
      :dangerous="isDangerous"
      @confirm="executeConfirm"
      @cancel="showConfirm = false"
    />

    <!-- Reason Input Dialog -->
    <Teleport to="body">
      <div v-if="showReasonInput" class="overlay" @click.self="showReasonInput = false">
        <div class="modal" role="dialog" aria-label="Provide Reason">
          <div class="modal-header">
            <h2>{{ reasonLabel }}</h2>
            <button class="btn-icon" @click="showReasonInput = false">&times;</button>
          </div>
          <div class="modal-body">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">{{ reasonLabel }} <span class="required">*</span></label>
              <textarea v-model="reason" class="form-textarea" placeholder="Enter reason..." />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="showReasonInput = false">Cancel</button>
            <button class="btn btn-primary" @click="executeReason">Submit</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
