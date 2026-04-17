<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { listingsApi } from '@/api/listings'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'
import AppShell from '@/components/layout/AppShell.vue'
import ListingForm from '@/components/listings/ListingForm.vue'

const router = useRouter()
const auth = useAuthStore()
const toast = useToast()
const loading = ref(false)

async function handleSubmit(data: Record<string, unknown>) {
  loading.value = true
  try {
    const res = await listingsApi.create(data)
    toast.success('Listing created successfully.')
    router.push(`/listings/${res.data.data.id}`)
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AppShell>
    <div class="page-header">
      <div style="display: flex; align-items: center; gap: 12px;">
        <RouterLink to="/listings" class="btn btn-secondary btn-sm">← Back</RouterLink>
        <h1>New Listing</h1>
      </div>
    </div>
    <div class="card">
      <div class="card-body">
        <ListingForm
          :loading="loading"
          :role="auth.user?.role"
          @submit="handleSubmit"
        />
      </div>
    </div>
  </AppShell>
</template>
