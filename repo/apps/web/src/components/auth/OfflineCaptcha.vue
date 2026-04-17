<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { authApi } from '@/api/auth'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'

const emit = defineEmits<{ submit: [{ token: string; answer: number }] }>()

const toast = useToast()
const question = ref('')
const token = ref('')
const answerInput = ref('')
const loading = ref(false)

async function loadChallenge() {
  loading.value = true
  try {
    const res = await authApi.getCaptchaChallenge()
    question.value = res.data.data.question
    token.value = res.data.data.token
    answerInput.value = ''
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    loading.value = false
  }
}

onMounted(() => loadChallenge())

function handleVerify() {
  const answer = parseInt(answerInput.value, 10)
  if (isNaN(answer)) {
    toast.error('Please enter a valid number')
    return
  }
  emit('submit', { token: token.value, answer })
}
</script>

<template>
  <div style="background: var(--color-background); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 16px;">
    <p style="font-size: 13px; font-weight: 500; margin-bottom: 12px; color: var(--color-text-muted);">
      Security verification required
    </p>
    <div v-if="loading" style="text-align:center;">
      <div class="spinner" />
    </div>
    <template v-else>
      <div class="form-group" style="margin-bottom: 8px;">
        <label class="form-label">{{ question }}</label>
        <input
          v-model="answerInput"
          class="form-input"
          type="number"
          placeholder="Enter your answer"
          @keyup.enter="handleVerify"
        />
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <button class="btn btn-primary btn-sm" @click="handleVerify">Verify</button>
        <button type="button" class="btn btn-secondary btn-sm" @click="loadChallenge">
          Refresh challenge
        </button>
      </div>
    </template>
  </div>
</template>
