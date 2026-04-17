<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { promoApi, type PromoData } from '@/api/promo'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'
import AppShell from '@/components/layout/AppShell.vue'
import PromoStatusPill from '@/components/promo/PromoStatusPill.vue'
import PromoSlotEditor from '@/components/promo/PromoSlotEditor.vue'
import PromoForm from '@/components/promo/PromoForm.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import { type PromoSlotData } from '@/api/promo'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToast()

const promoId = Number(route.params.id)
const promo = ref<PromoData | null>(null)
const loading = ref(false)
const actionLoading = ref(false)
const showEditModal = ref(false)
const editLoading = ref(false)

const showActivateConfirm = ref(false)
const showCancelConfirm = ref(false)

async function loadPromo() {
  loading.value = true
  try {
    const res = await promoApi.get(promoId)
    promo.value = res.data.data
  } catch (err) {
    toast.error(extractError(err))
    router.push('/promo')
  } finally {
    loading.value = false
  }
}

onMounted(loadPromo)

async function handleActivate() {
  showActivateConfirm.value = false
  actionLoading.value = true
  try {
    const res = await promoApi.activate(promoId)
    promo.value = res.data.data
    toast.success('Collection activated.')
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    actionLoading.value = false
  }
}

async function handleCancel() {
  showCancelConfirm.value = false
  actionLoading.value = true
  try {
    const res = await promoApi.cancel(promoId)
    promo.value = res.data.data
    toast.success('Collection cancelled.')
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    actionLoading.value = false
  }
}

async function handleEdit(data: { title: string; theme_date?: string; starts_at: string; ends_at: string }) {
  editLoading.value = true
  try {
    const res = await promoApi.update(promoId, data)
    promo.value = res.data.data
    showEditModal.value = false
    toast.success('Collection updated.')
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    editLoading.value = false
  }
}

function onSlotsUpdated(slots: PromoSlotData[]) {
  if (promo.value) {
    promo.value = { ...promo.value, slots }
  }
}
</script>

<template>
  <AppShell>
    <div v-if="loading" style="text-align: center; padding: 48px;">
      <LoadingSpinner size="lg" />
    </div>
    <template v-else-if="promo">
      <div class="page-header">
        <div style="display: flex; align-items: center; gap: 12px;">
          <RouterLink to="/promo" class="btn btn-secondary btn-sm">← Back</RouterLink>
          <h1>{{ promo.title }}</h1>
          <PromoStatusPill :status="promo.status" :starts-at="promo.starts_at" :ends-at="promo.ends_at" />
        </div>
        <div style="display: flex; gap: 8px;" v-if="!actionLoading">
          <button
            v-if="promo.status === 'draft'"
            class="btn btn-primary btn-sm"
            @click="showActivateConfirm = true"
          >
            Activate
          </button>
          <button
            v-if="['draft', 'scheduled', 'live'].includes(promo.status)"
            class="btn btn-danger btn-sm"
            @click="showCancelConfirm = true"
          >
            Cancel
          </button>
          <button
            v-if="['draft', 'scheduled'].includes(promo.status)"
            class="btn btn-secondary btn-sm"
            @click="showEditModal = true"
          >
            Edit
          </button>
        </div>
        <LoadingSpinner v-else size="sm" />
      </div>

      <!-- Details card -->
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-header"><h3>Details</h3></div>
        <div class="card-body">
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;">
            <div>
              <p class="text-muted text-sm">Theme Date</p>
              <p class="font-medium">{{ promo.theme_date ?? '—' }}</p>
            </div>
            <div>
              <p class="text-muted text-sm">Starts At</p>
              <p class="font-medium">{{ new Date(promo.starts_at).toLocaleString() }}</p>
            </div>
            <div>
              <p class="text-muted text-sm">Ends At</p>
              <p class="font-medium">{{ new Date(promo.ends_at).toLocaleString() }}</p>
            </div>
            <div>
              <p class="text-muted text-sm">Slots</p>
              <p class="font-medium">{{ promo.slots?.length ?? 0 }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Slots -->
      <div class="card">
        <div class="card-header"><h3>Listings</h3></div>
        <div class="card-body">
          <PromoSlotEditor
            :collection-id="promo.id"
            :slots="promo.slots ?? []"
            @updated="onSlotsUpdated"
          />
        </div>
      </div>

      <!-- Confirm dialogs -->
      <ConfirmDialog
        :show="showActivateConfirm"
        title="Activate Collection"
        message="Activate this promo collection? It will become scheduled or live based on its dates."
        confirm-label="Activate"
        @confirm="handleActivate"
        @cancel="showActivateConfirm = false"
      />
      <ConfirmDialog
        :show="showCancelConfirm"
        title="Cancel Collection"
        message="Cancel this promo collection? This cannot be undone."
        confirm-label="Cancel Collection"
        :dangerous="true"
        @confirm="handleCancel"
        @cancel="showCancelConfirm = false"
      />

      <!-- Edit Modal -->
      <BaseModal title="Edit Collection" :show="showEditModal" @close="showEditModal = false">
        <PromoForm :promo="promo" :loading="editLoading" @submit="handleEdit" />
      </BaseModal>
    </template>
  </AppShell>
</template>
