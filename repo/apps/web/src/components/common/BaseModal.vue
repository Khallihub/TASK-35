<script setup lang="ts">
defineProps<{ title: string; show: boolean }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="overlay" @click.self="$emit('close')">
      <div class="modal" role="dialog" :aria-label="title">
        <div class="modal-header">
          <h2>{{ title }}</h2>
          <button class="btn-icon" @click="$emit('close')" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body"><slot /></div>
        <div class="modal-footer"><slot name="footer" /></div>
      </div>
    </div>
  </Teleport>
</template>
