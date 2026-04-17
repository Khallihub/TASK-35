<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/api/auth'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'

const emit = defineEmits<{ changed: [] }>()

const auth = useAuthStore()
const toast = useToast()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const showCurrent = ref(false)
const showNew = ref(false)
const showConfirm = ref(false)
const errorMsg = ref('')

const rules = computed(() => ({
  length: newPassword.value.length >= 12,
  uppercase: /[A-Z]/.test(newPassword.value),
  lowercase: /[a-z]/.test(newPassword.value),
  digit: /[0-9]/.test(newPassword.value),
  symbol: /[^A-Za-z0-9]/.test(newPassword.value),
}))

const allRulesPassed = computed(() => Object.values(rules.value).every(Boolean))
const passwordsMatch = computed(() => newPassword.value === confirmPassword.value && newPassword.value.length > 0)

async function handleSubmit() {
  errorMsg.value = ''
  if (!currentPassword.value || !newPassword.value || !confirmPassword.value) {
    errorMsg.value = 'All fields are required.'
    return
  }
  if (!allRulesPassed.value) {
    errorMsg.value = 'New password does not meet all requirements.'
    return
  }
  if (!passwordsMatch.value) {
    errorMsg.value = 'Passwords do not match.'
    return
  }
  loading.value = true
  try {
    const nonceRes = await authApi.getNonce('change_password')
    const nonce = nonceRes.data.data.nonce
    await auth.changePassword(currentPassword.value, newPassword.value, nonce)
    toast.success('Password changed successfully.')
    emit('changed')
  } catch (err) {
    errorMsg.value = extractError(err)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay">
      <div class="modal" role="dialog" aria-label="Change Password">
        <div class="modal-header">
          <h2>Change Password</h2>
        </div>
        <div class="modal-body">
          <p style="color: var(--color-text-muted); font-size: 13px; margin-bottom: 16px;">
            You are required to change your password before continuing.
          </p>
          <div v-if="errorMsg" class="form-error" style="margin-bottom: 12px; padding: 8px; background: #f8d7da; border-radius: 4px;">
            {{ errorMsg }}
          </div>
          <div class="form-group">
            <label class="form-label">Current Password</label>
            <div style="position: relative;">
              <input v-model="currentPassword" class="form-input" :type="showCurrent ? 'text' : 'password'" autocomplete="current-password" />
              <button type="button" class="btn-icon" style="position:absolute;right:8px;top:50%;transform:translateY(-50%)" @click="showCurrent = !showCurrent">
                {{ showCurrent ? '🙈' : '👁️' }}
              </button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">New Password</label>
            <div style="position: relative;">
              <input v-model="newPassword" class="form-input" :type="showNew ? 'text' : 'password'" autocomplete="new-password" />
              <button type="button" class="btn-icon" style="position:absolute;right:8px;top:50%;transform:translateY(-50%)" @click="showNew = !showNew">
                {{ showNew ? '🙈' : '👁️' }}
              </button>
            </div>
          </div>
          <!-- Password policy indicators -->
          <div style="background: var(--color-background); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 12px; margin-bottom: 16px; font-size: 12px;">
            <p style="font-weight: 600; margin-bottom: 8px;">Password requirements:</p>
            <ul style="display: flex; flex-direction: column; gap: 4px; list-style: none;">
              <li :style="{ color: rules.length ? 'var(--color-success)' : 'var(--color-danger)' }">
                {{ rules.length ? '✓' : '✗' }} At least 12 characters
              </li>
              <li :style="{ color: rules.uppercase ? 'var(--color-success)' : 'var(--color-danger)' }">
                {{ rules.uppercase ? '✓' : '✗' }} At least one uppercase letter
              </li>
              <li :style="{ color: rules.lowercase ? 'var(--color-success)' : 'var(--color-danger)' }">
                {{ rules.lowercase ? '✓' : '✗' }} At least one lowercase letter
              </li>
              <li :style="{ color: rules.digit ? 'var(--color-success)' : 'var(--color-danger)' }">
                {{ rules.digit ? '✓' : '✗' }} At least one digit
              </li>
              <li :style="{ color: rules.symbol ? 'var(--color-success)' : 'var(--color-danger)' }">
                {{ rules.symbol ? '✓' : '✗' }} At least one symbol
              </li>
            </ul>
          </div>
          <div class="form-group">
            <label class="form-label">Confirm New Password</label>
            <div style="position: relative;">
              <input
                v-model="confirmPassword"
                class="form-input"
                :type="showConfirm ? 'text' : 'password'"
                :class="{ error: confirmPassword.length > 0 && !passwordsMatch }"
                autocomplete="new-password"
              />
              <button type="button" class="btn-icon" style="position:absolute;right:8px;top:50%;transform:translateY(-50%)" @click="showConfirm = !showConfirm">
                {{ showConfirm ? '🙈' : '👁️' }}
              </button>
            </div>
            <span v-if="confirmPassword.length > 0 && !passwordsMatch" class="form-error">Passwords do not match</span>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" :disabled="loading" @click="handleSubmit">
            <span v-if="loading" class="spinner spinner-sm" />
            <span v-else>Change Password</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
