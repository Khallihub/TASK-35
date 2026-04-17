<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useOfflineQueue } from '@/composables/useOfflineQueue'
import ToastContainer from '@/components/common/ToastContainer.vue'

const auth = useAuthStore()
const offlineQueue = useOfflineQueue()

onMounted(() => {
  auth.loadFromStorage()
  offlineQueue.start()
})
</script>

<template>
  <RouterView />
  <ToastContainer />
</template>
