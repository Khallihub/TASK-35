<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { listingsApi, type ListingData } from '@/api/listings'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'
import AppShell from '@/components/layout/AppShell.vue'
import StatusBadge from '@/components/listings/StatusBadge.vue'
import WorkflowActions from '@/components/listings/WorkflowActions.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToast()

const listing = ref<ListingData | null>(null)
const loading = ref(false)
const revisions = ref<any[]>([])
const showRevisions = ref(false)
const revisionsLoading = ref(false)

const listingId = Number(route.params.id)

async function loadListing() {
  loading.value = true
  try {
    const res = await listingsApi.get(listingId)
    listing.value = res.data.data
  } catch (err) {
    toast.error(extractError(err))
    router.push('/listings')
  } finally {
    loading.value = false
  }
}

async function loadRevisions() {
  if (revisions.value.length > 0) {
    showRevisions.value = !showRevisions.value
    return
  }
  revisionsLoading.value = true
  showRevisions.value = true
  try {
    const res = await listingsApi.getRevisions(listingId)
    revisions.value = res.data.data
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    revisionsLoading.value = false
  }
}

onMounted(loadListing)

function formatPrice(cents: number | null) {
  if (cents == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}

function onUpdated(updated: ListingData) {
  listing.value = updated
}

const favoriting = ref(false)
const sharing = ref(false)

async function favoriteListing() {
  if (!listing.value) return
  favoriting.value = true
  try {
    await listingsApi.favorite(listing.value.id)
    toast.success('Marked as favorite.')
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    favoriting.value = false
  }
}

async function shareListing() {
  if (!listing.value) return
  sharing.value = true
  try {
    await listingsApi.share(listing.value.id)
    toast.success('Share recorded.')
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    sharing.value = false
  }
}
</script>

<template>
  <AppShell>
    <div v-if="loading" style="text-align: center; padding: 48px;">
      <LoadingSpinner size="lg" />
    </div>
    <template v-else-if="listing">
      <div class="page-header">
        <div style="display: flex; align-items: center; gap: 12px;">
          <RouterLink to="/listings" class="btn btn-secondary btn-sm">← Back</RouterLink>
          <h1>{{ listing.address_line ?? `Listing #${listing.id}` }}</h1>
          <StatusBadge :status="listing.status" />
        </div>
        <div style="display: flex; gap: 8px;">
          <RouterLink
            v-if="['draft', 'in_review', 'approved'].includes(listing.status)"
            :to="`/listings/${listing.id}/edit`"
            class="btn btn-secondary btn-sm"
          >
            Edit
          </RouterLink>
          <RouterLink :to="`/listings/${listing.id}/attachments`" class="btn btn-secondary btn-sm">
            Attachments
          </RouterLink>
          <button
            class="btn btn-secondary btn-sm"
            :disabled="favoriting"
            data-test="listing-favorite"
            @click="favoriteListing"
          >
            ★ Favorite
          </button>
          <button
            class="btn btn-secondary btn-sm"
            :disabled="sharing"
            data-test="listing-share"
            @click="shareListing"
          >
            Share
          </button>
        </div>
      </div>

      <!-- Workflow Actions -->
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-header"><h3>Actions</h3></div>
        <div class="card-body">
          <WorkflowActions
            :listing="listing"
            :role="auth.user?.role ?? ''"
            :office-id="auth.user?.officeId ?? null"
            @updated="onUpdated"
          />
        </div>
      </div>

      <!-- Property Details -->
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-header"><h3>Property Details</h3></div>
        <div class="card-body">
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;">
            <div>
              <p class="text-muted text-sm">Price</p>
              <p class="font-medium">{{ formatPrice(listing.price_usd_cents) }}</p>
            </div>
            <div>
              <p class="text-muted text-sm">Beds</p>
              <p class="font-medium">{{ listing.beds ?? '—' }}</p>
            </div>
            <div>
              <p class="text-muted text-sm">Baths</p>
              <p class="font-medium">{{ listing.baths ?? '—' }}</p>
            </div>
            <div>
              <p class="text-muted text-sm">Area (sqft)</p>
              <p class="font-medium">{{ listing.area_sqft != null ? listing.area_sqft.toLocaleString() : '—' }}</p>
            </div>
            <div>
              <p class="text-muted text-sm">Area (sqm)</p>
              <p class="font-medium">{{ listing.area_sqm != null ? listing.area_sqm.toLocaleString() : '—' }}</p>
            </div>
            <div>
              <p class="text-muted text-sm">Floor Level</p>
              <p class="font-medium">{{ listing.floor_level ?? '—' }}</p>
            </div>
            <div>
              <p class="text-muted text-sm">Orientation</p>
              <p class="font-medium">{{ listing.orientation ?? '—' }}</p>
            </div>
            <div>
              <p class="text-muted text-sm">Postal Code</p>
              <p class="font-medium">{{ listing.postal_code ?? '—' }}</p>
            </div>
            <div>
              <p class="text-muted text-sm">Latitude</p>
              <p class="font-medium">{{ listing.latitude ?? '—' }}</p>
            </div>
            <div>
              <p class="text-muted text-sm">Longitude</p>
              <p class="font-medium">{{ listing.longitude ?? '—' }}</p>
            </div>
            <div>
              <p class="text-muted text-sm">Version</p>
              <p class="font-medium">{{ listing.version }}</p>
            </div>
            <div v-if="listing.published_at">
              <p class="text-muted text-sm">Published At</p>
              <p class="font-medium">{{ new Date(listing.published_at).toLocaleString() }}</p>
            </div>
          </div>

          <!-- Anomaly flags -->
          <div v-if="listing.anomaly_flags.length > 0" style="margin-top: 16px;">
            <p class="text-muted text-sm" style="margin-bottom: 6px;">Anomaly Flags</p>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
              <span v-for="flag in listing.anomaly_flags" :key="flag" class="badge badge-yellow">{{ flag }}</span>
            </div>
          </div>

          <div style="margin-top: 16px; font-size: 12px; color: var(--color-text-muted);">
            Created {{ new Date(listing.created_at).toLocaleString() }} · Updated {{ new Date(listing.updated_at).toLocaleString() }}
          </div>
        </div>
      </div>

      <!-- Revisions -->
      <div class="card">
        <div class="card-header" style="cursor: pointer;" @click="loadRevisions">
          <h3>Revision History</h3>
          <span>{{ showRevisions ? '▲' : '▼' }}</span>
        </div>
        <div v-if="showRevisions" class="card-body">
          <div v-if="revisionsLoading" style="text-align: center;">
            <LoadingSpinner size="lg" />
          </div>
          <div v-else-if="revisions.length === 0" class="empty-state" style="padding: 16px;">
            <p>No revisions found.</p>
          </div>
          <table v-else class="table">
            <thead>
              <tr>
                <th>Rev</th><th>Action</th><th>Actor</th><th>Date</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="rev in revisions" :key="rev.id">
                <td>{{ rev.revision_no ?? rev.id }}</td>
                <td>{{ rev.action ?? '—' }}</td>
                <td>{{ rev.actor_id ?? '—' }}</td>
                <td class="text-sm text-muted">{{ rev.created_at ? new Date(rev.created_at).toLocaleString() : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AppShell>
</template>
