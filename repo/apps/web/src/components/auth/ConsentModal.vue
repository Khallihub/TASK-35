<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/api/auth'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'

const props = defineProps<{ versionId: number }>()
const emit = defineEmits<{ accepted: [] }>()

const auth = useAuthStore()
const toast = useToast()

const bodyMd = ref('')
const loading = ref(false)
const agreeing = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    const res = await authApi.getConsentVersion()
    bodyMd.value = res.data.data.body_md
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    loading.value = false
  }
})

async function handleAgree() {
  agreeing.value = true
  try {
    await auth.acceptConsent(props.versionId)
    emit('accepted')
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    agreeing.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay">
      <div class="modal" role="dialog" aria-label="Terms of Service">
        <div class="modal-header">
          <h2>Terms of Service &amp; Consent</h2>
        </div>
        <div class="modal-body">
          <div v-if="loading" style="text-align:center; padding: 24px;">
            <div class="spinner" />
          </div>
          <pre v-else style="white-space: pre-wrap; word-wrap: break-word; font-family: var(--font); font-size: 14px; line-height: 1.6; max-height: 400px; overflow-y: auto; background: var(--color-background); padding: 16px; border-radius: var(--radius); border: 1px solid var(--color-border);">{{ bodyMd }}</pre>
          <p style="margin-top: 16px; font-size: 13px; color: var(--color-text-muted);">
            You must accept these terms to continue using HarborStone Operations Suite.
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" :disabled="loading || agreeing" @click="handleAgree">
            <span v-if="agreeing" class="spinner spinner-sm" />
            <span v-else>I Agree</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
