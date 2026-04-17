<script setup lang="ts">
defineProps<{
  flags: string[]
  role: string
  modelValue: string
}>()

defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div v-if="flags.length > 0" style="background: #ffeeba; border: 1px solid #ffc107; border-radius: var(--radius); padding: 12px 16px; margin-bottom: 16px;">
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
      <span style="font-size: 18px;">⚠️</span>
      <strong style="color: #856404;">Anomaly Flags Detected</strong>
    </div>
    <ul style="padding-left: 20px; color: #856404; font-size: 13px; margin-bottom: 8px;">
      <li v-for="flag in flags" :key="flag">{{ flag }}</li>
    </ul>
    <div v-if="['merchant', 'administrator'].includes(role)" class="form-group" style="margin-bottom: 0; margin-top: 8px;">
      <label class="form-label" style="color: #856404;">Override Reason (required to approve)</label>
      <textarea
        :value="modelValue"
        class="form-textarea"
        placeholder="Explain why these flags can be overridden..."
        @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      />
    </div>
  </div>
</template>
