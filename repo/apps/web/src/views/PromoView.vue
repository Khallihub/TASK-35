<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { promoApi, type PromoData } from '@/api/promo'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'
import AppShell from '@/components/layout/AppShell.vue'
import PromoStatusPill from '@/components/promo/PromoStatusPill.vue'
import PromoForm from '@/components/promo/PromoForm.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import BaseModal from '@/components/common/BaseModal.vue'

const router = useRouter()
const auth = useAuthStore()
const toast = useToast()

const promos = ref<PromoData[]>([])
const loading = ref(false)
const nextCursor = ref<string | null>(null)
const filterStatus = ref('')
const showCreateModal = ref(false)
const createLoading = ref(false)

async function load(reset = false) {
  loading.value = true
  try {
    const params: Record<string, unknown> = { limit: 25 }
    if (filterStatus.value) params.status = filterStatus.value
    if (!reset && nextCursor.value) params.cursor = nextCursor.value
    const res = await promoApi.list(params)
    if (reset) promos.value = res.data.data.items
    else promos.value.push(...res.data.data.items)
    nextCursor.value = res.data.data.nextCursor
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    loading.value = false
  }
}

onMounted(() => load(true))

async function handleCreate(data: { title: string; theme_date?: string; starts_at: string; ends_at: string }) {
  createLoading.value = true
  try {
    const res = await promoApi.create(data)
    toast.success('Collection created.')
    showCreateModal.value = false
    router.push(`/promo/${res.data.data.id}`)
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    createLoading.value = false
  }
}
</script>

<template>
  <AppShell>
    <div class="page-header">
      <h1>Promotions</h1>
      <button class="btn btn-primary" @click="showCreateModal = true">+ New Collection</button>
    </div>

    <!-- Filter -->
    <div class="card" style="margin-bottom: 16px;">
      <div class="card-body" style="display: flex; gap: 12px; align-items: flex-end;">
        <div class="form-group" style="margin-bottom: 0; min-width: 180px;">
          <label class="form-label">Status</label>
          <select v-model="filterStatus" class="form-select" @change="load(true)">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="live">Live</option>
            <option value="ended">Ended</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div class="card">
      <div v-if="loading && promos.length === 0" class="card-body" style="text-align: center;">
        <LoadingSpinner size="lg" />
      </div>
      <EmptyState v-else-if="!loading && promos.length === 0" message="No collections found." icon="📌" />
      <div v-else>
        <table class="table">
          <thead>
            <tr>
              <th>Title</th><th>Theme Date</th><th>Starts</th><th>Ends</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in promos"
              :key="p.id"
              style="cursor: pointer;"
              @click="router.push(`/promo/${p.id}`)"
            >
              <td class="font-medium">{{ p.title }}</td>
              <td>{{ p.theme_date ?? '—' }}</td>
              <td class="text-muted text-sm">{{ new Date(p.starts_at).toLocaleDateString() }}</td>
              <td class="text-muted text-sm">{{ new Date(p.ends_at).toLocaleDateString() }}</td>
              <td>
                <PromoStatusPill :status="p.status" :starts-at="p.starts_at" :ends-at="p.ends_at" />
              </td>
              <td>
                <RouterLink :to="`/promo/${p.id}`" class="btn btn-secondary btn-sm" @click.stop>View</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="nextCursor" style="padding: 16px; text-align: center;">
          <button class="btn btn-secondary" :disabled="loading" @click="load()">Load more</button>
        </div>
      </div>
    </div>

    <!-- Create Modal -->
    <BaseModal title="New Promo Collection" :show="showCreateModal" @close="showCreateModal = false">
      <PromoForm :loading="createLoading" @submit="handleCreate" />
    </BaseModal>
  </AppShell>
</template>
