<script setup lang="ts">
import BaseModal from './BaseModal.vue'
defineProps<{ show: boolean; title: string; message: string; confirmLabel?: string; dangerous?: boolean }>()
defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <BaseModal :title="title" :show="show" @close="$emit('cancel')">
    <p>{{ message }}</p>
    <template #footer>
      <button class="btn btn-secondary" @click="$emit('cancel')">Cancel</button>
      <button :class="['btn', dangerous ? 'btn-danger' : 'btn-primary']" @click="$emit('confirm')">
        {{ confirmLabel ?? 'Confirm' }}
      </button>
    </template>
  </BaseModal>
</template>
