<script setup lang="ts">
import { useToast } from '@/composables/useToast'
const { toasts } = useToast()
</script>

<template>
  <div class="toast-container">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" :class="['toast', `toast-${t.type}`]">
        <span>{{ t.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>
