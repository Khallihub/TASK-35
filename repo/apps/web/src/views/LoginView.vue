<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'
import { authApi } from '@/api/auth'
import ConsentModal from '@/components/auth/ConsentModal.vue'
import ChangePasswordModal from '@/components/auth/ChangePasswordModal.vue'
import OfflineCaptcha from '@/components/auth/OfflineCaptcha.vue'

const router = useRouter()
const auth = useAuthStore()
const toast = useToast()

const username = ref('')
const password = ref('')
const showPassword = ref(false)
const loading = ref(false)
const errorMsg = ref('')
const failCount = ref(0)

const showCaptcha = ref(false)
const captchaToken = ref('')
const captchaAnswer = ref<number | undefined>(undefined)

const showConsentModal = ref(false)
const consentVersionId = ref<number | null>(null)

const showChangePassword = ref(false)

async function handleLogin() {
  errorMsg.value = ''
  loading.value = true
  try {
    await auth.login(username.value, password.value, captchaToken.value || undefined, captchaAnswer.value)
    failCount.value = 0
    if (auth.requiresConsent) {
      const res = await authApi.getConsentVersion()
      consentVersionId.value = res.data.data.id
      showConsentModal.value = true
    } else if (auth.mustChangePassword) {
      showChangePassword.value = true
    } else {
      router.push('/listings')
    }
  } catch (err: unknown) {
    failCount.value++
    // Show generic error — never disclose account state (PRD §8.2)
    errorMsg.value = extractError(err)
    if (failCount.value >= 5) {
      showCaptcha.value = true
    }
  } finally {
    loading.value = false
  }
}

async function onConsentAccepted() {
  showConsentModal.value = false
  if (auth.mustChangePassword) showChangePassword.value = true
  else router.push('/listings')
}

function onPasswordChanged() {
  showChangePassword.value = false
  router.push('/listings')
}

function onCaptchaSubmit(payload: { token: string; answer: number }) {
  captchaToken.value = payload.token
  captchaAnswer.value = payload.answer
}
</script>

<template>
  <div class="login-page">
    <div class="login-card card">
      <div class="card-header">
        <h2>HarborStone Operations Suite</h2>
      </div>
      <div class="card-body">
        <div
          v-if="errorMsg"
          class="form-error"
          style="margin-bottom: 12px; padding: 8px; background: #f8d7da; border-radius: 4px;"
        >
          {{ errorMsg }}
        </div>
        <div class="form-group">
          <label class="form-label">Username</label>
          <input
            v-model="username"
            class="form-input"
            type="text"
            autocomplete="username"
            @keyup.enter="handleLogin"
          />
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <div style="position: relative;">
            <input
              v-model="password"
              class="form-input"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              @keyup.enter="handleLogin"
            />
            <button
              type="button"
              class="btn-icon"
              style="position:absolute;right:8px;top:50%;transform:translateY(-50%)"
              @click="showPassword = !showPassword"
            >
              {{ showPassword ? '🙈' : '👁️' }}
            </button>
          </div>
        </div>
        <OfflineCaptcha v-if="showCaptcha" style="margin-bottom: 16px;" @submit="onCaptchaSubmit" />
        <button class="btn btn-primary w-full btn-lg" :disabled="loading" @click="handleLogin">
          <span v-if="loading" class="spinner spinner-sm" />
          <span v-else>Sign In</span>
        </button>
      </div>
    </div>
    <ConsentModal
      v-if="showConsentModal && consentVersionId !== null"
      :version-id="consentVersionId"
      @accepted="onConsentAccepted"
    />
    <ChangePasswordModal v-if="showChangePassword" @changed="onPasswordChanged" />
  </div>
</template>

<style scoped>
.login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--color-background); }
.login-card { width: 100%; max-width: 400px; }
</style>
