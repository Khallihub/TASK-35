<script setup lang="ts">
const props = withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' })
</script>

<template>
  <div :class="['spinner', `spinner-${props.size}`]" />
</template>

<style scoped>
.spinner-sm { width: 14px; height: 14px; border-width: 2px; }
.spinner-lg { width: 36px; height: 36px; border-width: 3px; }
</style>
