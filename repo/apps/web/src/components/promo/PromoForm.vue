<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { type PromoData } from '@/api/promo'
import { apiClient } from '@/api/client'
import { toTzDatetimeInput, fromTzDatetimeInput } from '@/utils/timezone'

const props = defineProps<{ promo?: PromoData; loading?: boolean }>()
const emit = defineEmits<{ submit: [data: { title: string; theme_date?: string; starts_at: string; ends_at: string }] }>()

// Install-configured timezone (fetched from server, falls back to America/New_York)
const installTimezone = ref('America/New_York')
// Track whether the timezone has been resolved from the server so we don't populate
// the datetime-local fields with possibly-wrong values before the fetch completes.
const timezoneResolved = ref(false)

const title = ref(props.promo?.title ?? '')
const themeDate = ref(props.promo?.theme_date ?? '')
const startsAt = ref('')
const endsAt = ref('')
const errors = ref<Record<string, string>>({})

// Recompute the datetime-local values reactively from the resolved timezone
// so that a late timezone response (or a prop update) repaints the inputs
// with values that the user will interpret correctly.
function recomputeFormDateFields() {
  if (props.promo) {
    startsAt.value = toTzDatetimeInput(props.promo.starts_at, installTimezone.value)
    endsAt.value = toTzDatetimeInput(props.promo.ends_at, installTimezone.value)
  }
}

watch(installTimezone, recomputeFormDateFields)
watch(
  () => props.promo,
  () => recomputeFormDateFields(),
  { immediate: true },
)

onMounted(async () => {
  try {
    const res = await apiClient.get('/api/v1/config/timezone')
    if (res.data?.data?.timezone) {
      installTimezone.value = res.data.data.timezone
    }
  } catch {
    // Use default; the watch already populated fields with the default zone.
  } finally {
    timezoneResolved.value = true
  }
})

function validate() {
  const e: Record<string, string> = {}
  if (!title.value.trim()) e.title = 'Title is required'
  if (!startsAt.value) e.startsAt = 'Start time is required'
  if (!endsAt.value) e.endsAt = 'End time is required'
  if (startsAt.value && endsAt.value && new Date(startsAt.value) >= new Date(endsAt.value)) {
    e.endsAt = 'End time must be after start time'
  }
  errors.value = e
  return Object.keys(e).length === 0
}

function handleSubmit() {
  if (!validate()) return
  emit('submit', {
    title: title.value.trim(),
    theme_date: themeDate.value || undefined,
    starts_at: fromTzDatetimeInput(startsAt.value, installTimezone.value),
    ends_at: fromTzDatetimeInput(endsAt.value, installTimezone.value),
  })
}
</script>

<template>
  <div>
    <p class="text-muted text-sm" style="margin-bottom: 16px;">
      All times are in <strong>{{ installTimezone }}</strong>.
    </p>
    <div class="form-group">
      <label class="form-label">Title <span class="required">*</span></label>
      <input v-model="title" class="form-input" :class="{ error: errors.title }" type="text" placeholder="Spring Collection 2025" />
      <span v-if="errors.title" class="form-error">{{ errors.title }}</span>
    </div>
    <div class="form-group">
      <label class="form-label">Theme Date <span class="text-muted">(optional)</span></label>
      <input v-model="themeDate" class="form-input" type="date" />
    </div>
    <div class="form-group">
      <label class="form-label">Starts At <span class="required">*</span></label>
      <input v-model="startsAt" class="form-input" :class="{ error: errors.startsAt }" type="datetime-local" :disabled="!timezoneResolved && !!props.promo" />
      <span v-if="errors.startsAt" class="form-error">{{ errors.startsAt }}</span>
    </div>
    <div class="form-group">
      <label class="form-label">Ends At <span class="required">*</span></label>
      <input v-model="endsAt" class="form-input" :class="{ error: errors.endsAt }" type="datetime-local" :disabled="!timezoneResolved && !!props.promo" />
      <span v-if="errors.endsAt" class="form-error">{{ errors.endsAt }}</span>
    </div>
    <div style="display: flex; justify-content: flex-end; margin-top: 8px;">
      <button class="btn btn-primary" :disabled="loading || !timezoneResolved" @click="handleSubmit">
        <span v-if="loading" class="spinner spinner-sm" />
        <span v-else>{{ promo ? 'Save Changes' : 'Create Collection' }}</span>
      </button>
    </div>
  </div>
</template>
