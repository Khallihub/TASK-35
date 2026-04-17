<script setup lang="ts">
import { computed } from 'vue'
import BaseBadge from '@/components/common/BaseBadge.vue'

const props = defineProps<{ status: string }>()

const variant = computed((): 'gray' | 'blue' | 'teal' | 'green' | 'orange' | 'red' | 'yellow' => {
  switch (props.status) {
    case 'draft': return 'gray'
    case 'in_review': return 'blue'
    case 'approved': return 'teal'
    case 'published': return 'green'
    case 'archived': return 'orange'
    case 'deleted': return 'red'
    default: return 'gray'
  }
})
</script>

<template>
  <BaseBadge :variant="variant">{{ status.replace('_', ' ') }}</BaseBadge>
</template>
