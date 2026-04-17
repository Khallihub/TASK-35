<script setup lang="ts">
import { computed } from 'vue'
import { useClock } from '@/composables/useClock'
import BaseBadge from '@/components/common/BaseBadge.vue'

const props = defineProps<{
  status: string
  startsAt: string
  endsAt: string
}>()

const { now } = useClock()

const liveStatus = computed((): { label: string; variant: 'gray' | 'blue' | 'teal' | 'green' | 'orange' | 'red' | 'yellow' } => {
  if (props.status === 'cancelled') return { label: 'Cancelled', variant: 'red' }
  if (props.status === 'draft') return { label: 'Draft', variant: 'gray' }

  const start = new Date(props.startsAt)
  const end = new Date(props.endsAt)
  const current = now.value

  if (current < start) return { label: 'Scheduled', variant: 'blue' }
  if (current >= start && current < end) return { label: 'Live', variant: 'green' }
  return { label: 'Ended', variant: 'orange' }
})
</script>

<template>
  <BaseBadge :variant="liveStatus.variant">{{ liveStatus.label }}</BaseBadge>
</template>
