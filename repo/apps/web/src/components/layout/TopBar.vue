<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useOfflineQueue } from '@/composables/useOfflineQueue'
import { useRouter } from 'vue-router'

const auth = useAuthStore()
const { pendingCount } = useOfflineQueue()
const router = useRouter()

async function handleLogout() {
  await auth.logout()
  router.push('/login')
}
</script>

<template>
  <header class="topbar">
    <div class="topbar-left">
      <span class="topbar-title">Operations Suite</span>
    </div>
    <div class="topbar-right">
      <div v-if="pendingCount > 0" class="sync-badge">
        <span>⏳ {{ pendingCount }} queued</span>
      </div>
      <button class="btn btn-secondary btn-sm" @click="handleLogout">Logout</button>
    </div>
  </header>
</template>

<style scoped>
.topbar { height: var(--topbar-height); background: var(--color-surface); border-bottom: 1px solid var(--color-border); display: flex; align-items: center; justify-content: space-between; padding: 0 24px; flex-shrink: 0; box-shadow: var(--shadow); }
.topbar-title { font-weight: 600; font-size: 15px; color: var(--color-text-muted); }
.topbar-right { display: flex; align-items: center; gap: 12px; }
.sync-badge { background: #fff3cd; color: #856404; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
</style>
