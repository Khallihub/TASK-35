<script setup lang="ts">
defineProps<{ message?: string; icon?: string }>()
</script>

<template>
  <div class="empty-state">
    <div v-if="icon" style="font-size: 2.5rem; margin-bottom: 8px;">{{ icon }}</div>
    <p>{{ message ?? 'No items found.' }}</p>
    <slot />
  </div>
</template>
