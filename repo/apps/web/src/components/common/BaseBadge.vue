<script setup lang="ts">
defineProps<{ variant: 'gray' | 'blue' | 'teal' | 'green' | 'orange' | 'red' | 'yellow' }>()
</script>

<template>
  <span :class="['badge', `badge-${variant}`]"><slot /></span>
</template>
