<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { listingsApi, type ListingData } from '@/api/listings'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'
import AppShell from '@/components/layout/AppShell.vue'
import ListingForm from '@/components/listings/ListingForm.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToast()

const listing = ref<ListingData | null>(null)
const pageLoading = ref(false)
const submitLoading = ref(false)

const listingId = Number(route.params.id)

async function loadListing() {
  pageLoading.value = true
  try {
    const res = await listingsApi.get(listingId)
    listing.value = res.data.data
  } catch (err) {
    toast.error(extractError(err))
    router.push('/listings')
  } finally {
    pageLoading.value = false
  }
}

async function handleSubmit(data: Record<string, unknown>) {
  if (!listing.value) return
  submitLoading.value = true
  try {
    const res = await listingsApi.update(listingId, data, listing.value.version)
    toast.success('Listing updated successfully.')
    router.push(`/listings/${listingId}`)
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: { code?: string } } } }
    if (e?.response?.data?.error?.code === 'VERSION_CONFLICT') {
      toast.error('Version conflict: the listing was modified by someone else. Please reload and try again.')
    } else {
      toast.error(extractError(err))
    }
  } finally {
    submitLoading.value = false
  }
}

onMounted(loadListing)
</script>

<template>
  <AppShell>
    <div class="page-header">
      <div style="display: flex; align-items: center; gap: 12px;">
        <RouterLink :to="`/listings/${listingId}`" class="btn btn-secondary btn-sm">← Back</RouterLink>
        <h1>Edit Listing</h1>
      </div>
    </div>
    <div v-if="pageLoading" style="text-align: center; padding: 48px;">
      <LoadingSpinner size="lg" />
    </div>
    <div v-else-if="listing" class="card">
      <div class="card-body">
        <ListingForm
          :listing="listing"
          :loading="submitLoading"
          :role="auth.user?.role"
          @submit="handleSubmit"
        />
      </div>
    </div>
  </AppShell>
</template>
