<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { listingsApi, type ListingData } from '@/api/listings'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'
import AppShell from '@/components/layout/AppShell.vue'
import StatusBadge from '@/components/listings/StatusBadge.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import EmptyState from '@/components/common/EmptyState.vue'

const router = useRouter()
const auth = useAuthStore()
const toast = useToast()

const listings = ref<ListingData[]>([])
const loading = ref(false)
const nextCursor = ref<string | null>(null)

const filters = ref({ status: '', q: '', city: '', state_code: '' })

const canCreate = computed(() => ['regular_user', 'merchant', 'administrator'].includes(auth.user?.role ?? ''))

async function load(reset = false) {
  loading.value = true
  try {
    const params: Record<string, unknown> = { limit: 25 }
    if (filters.value.status) params.status = filters.value.status
    if (filters.value.q) params.q = filters.value.q
    if (filters.value.city) params.city = filters.value.city
    if (filters.value.state_code) params.state_code = filters.value.state_code
    if (!reset && nextCursor.value) params.cursor = nextCursor.value
    const res = await listingsApi.list(params)
    if (reset) listings.value = res.data.data.items
    else listings.value.push(...res.data.data.items)
    nextCursor.value = res.data.data.nextCursor
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    loading.value = false
  }
}

onMounted(() => load(true))

function applyFilters() {
  nextCursor.value = null
  load(true)
}

function formatPrice(cents: number | null) {
  if (cents == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}
</script>

<template>
  <AppShell>
    <div class="page-header">
      <h1>Listings</h1>
      <RouterLink v-if="canCreate" to="/listings/new" class="btn btn-primary">+ New Listing</RouterLink>
    </div>

    <!-- Filters -->
    <div class="card" style="margin-bottom: 16px;">
      <div class="card-body" style="display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end;">
        <div class="form-group" style="margin-bottom: 0; min-width: 150px;">
          <label class="form-label">Status</label>
          <select v-model="filters.status" class="form-select">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="in_review">In Review</option>
            <option value="approved">Approved</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 160px;">
          <label class="form-label">Search</label>
          <input v-model="filters.q" class="form-input" placeholder="Address, city..." @keyup.enter="applyFilters" />
        </div>
        <div class="form-group" style="margin-bottom: 0; min-width: 120px;">
          <label class="form-label">City</label>
          <input v-model="filters.city" class="form-input" @keyup.enter="applyFilters" />
        </div>
        <button class="btn btn-primary" @click="applyFilters">Apply</button>
      </div>
    </div>

    <!-- Table -->
    <div class="card">
      <div v-if="loading && listings.length === 0" class="card-body" style="text-align: center;">
        <LoadingSpinner size="lg" />
      </div>
      <EmptyState v-else-if="!loading && listings.length === 0" message="No listings found." icon="🏘️">
        <RouterLink v-if="canCreate" to="/listings/new" class="btn btn-primary" style="margin-top: 12px;">Create one</RouterLink>
      </EmptyState>
      <div v-else>
        <table class="table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Price</th>
              <th>Beds/Baths</th>
              <th>Status</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="l in listings"
              :key="l.id"
              style="cursor: pointer;"
              @click="router.push(`/listings/${l.id}`)"
            >
              <td>
                {{ l.address_line ?? '—' }}<br>
                <span class="text-muted text-sm">{{ l.city }}, {{ l.state_code }}</span>
              </td>
              <td>{{ formatPrice(l.price_usd_cents) }}</td>
              <td>{{ l.beds ?? '—' }}bd / {{ l.baths != null ? l.baths : '—' }}ba</td>
              <td><StatusBadge :status="l.status" /></td>
              <td class="text-muted text-sm">{{ new Date(l.updated_at).toLocaleDateString() }}</td>
              <td>
                <RouterLink :to="`/listings/${l.id}`" class="btn btn-secondary btn-sm" @click.stop>View</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="nextCursor" style="padding: 16px; text-align: center;">
          <button class="btn btn-secondary" :disabled="loading" @click="load()">
            <LoadingSpinner v-if="loading" size="sm" />
            Load more
          </button>
        </div>
      </div>
    </div>
  </AppShell>
</template>
