<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useOfflineQueue } from '@/composables/useOfflineQueue'

defineProps<{ collapsed: boolean }>()
defineEmits<{ toggle: [] }>()

const auth = useAuthStore()
const { isOnline } = useOfflineQueue()

const navItems = computed(() => {
  const role = auth.user?.role ?? ''
  const items: { to: string; label: string; icon: string }[] = [
    { to: '/listings', label: 'Listings', icon: '🏠' },
  ]
  if (['merchant', 'operations', 'administrator'].includes(role)) {
    items.push({ to: '/analytics', label: 'Analytics', icon: '📊' })
  }
  if (['operations', 'administrator'].includes(role)) {
    items.push({ to: '/promo', label: 'Promotions', icon: '📌' })
  }
  if (role === 'administrator') {
    items.push({ to: '/admin', label: 'Admin', icon: '⚙️' })
  }
  return items
})
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar-collapsed': collapsed }">
    <div class="sidebar-header">
      <span v-if="!collapsed" class="sidebar-logo">HarborStone</span>
      <button class="btn-icon" @click="$emit('toggle')" :aria-label="collapsed ? 'Expand' : 'Collapse'">
        {{ collapsed ? '→' : '←' }}
      </button>
    </div>
    <nav class="sidebar-nav">
      <RouterLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="nav-item"
        :class="{ 'nav-collapsed': collapsed }"
      >
        <span class="nav-icon">{{ item.icon }}</span>
        <span v-if="!collapsed" class="nav-label">{{ item.label }}</span>
      </RouterLink>
    </nav>
    <div class="sidebar-footer">
      <div v-if="!isOnline" class="offline-dot" title="Offline" />
      <template v-if="!collapsed && auth.user">
        <div class="sidebar-user">
          <span class="sidebar-username">{{ auth.user.username }}</span>
          <span class="badge badge-gray" style="font-size:10px">{{ auth.user.role }}</span>
        </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.sidebar { width: var(--sidebar-width); background: var(--color-primary); color: #fff; display: flex; flex-direction: column; transition: width var(--transition); flex-shrink: 0; }
.sidebar-collapsed { width: var(--sidebar-collapsed-width); }
.sidebar-header { height: var(--topbar-height); display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-bottom: 1px solid rgba(255,255,255,.15); }
.sidebar-logo { font-size: 16px; font-weight: 700; letter-spacing: .5px; }
.sidebar-nav { flex: 1; padding: 12px 0; }
.nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 16px; color: rgba(255,255,255,.8); text-decoration: none; transition: background var(--transition); border-radius: var(--radius); margin: 2px 8px; }
.nav-item:hover, .nav-item.router-link-active { background: rgba(255,255,255,.15); color: #fff; }
.nav-collapsed { justify-content: center; padding: 10px; }
.nav-icon { font-size: 18px; }
.sidebar-footer { padding: 12px; border-top: 1px solid rgba(255,255,255,.15); }
.sidebar-user { display: flex; flex-direction: column; gap: 4px; }
.sidebar-username { font-size: 13px; font-weight: 600; color: #fff; }
.offline-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--color-warning); margin-bottom: 8px; }
</style>
