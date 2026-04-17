<script setup lang="ts">
defineProps<{ label: string; value: number; suffix?: string }>()
</script>

<template>
  <div class="card" style="text-align: center; padding: 20px;">
    <p class="text-muted text-sm" style="margin-bottom: 8px; text-transform: uppercase; letter-spacing: .5px;">{{ label }}</p>
    <p style="font-size: 28px; font-weight: 700; color: var(--color-primary);">
      {{ value.toLocaleString() }}<span v-if="suffix" style="font-size: 16px; font-weight: 400; color: var(--color-text-muted);">{{ suffix }}</span>
    </p>
  </div>
</template>
