<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { adminApi } from '@/api/admin'
import { authApi } from '@/api/auth'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'
import AppShell from '@/components/layout/AppShell.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import BaseModal from '@/components/common/BaseModal.vue'

const toast = useToast()
const activeTab = ref<'users' | 'risk' | 'audit' | 'jobs'>('users')

// ── Users ───────────────────────────────────────────────────────────
const users = ref<any[]>([])
const usersLoading = ref(false)
const userSearch = ref('')
const showCreateUserModal = ref(false)
const createUserLoading = ref(false)
const newUser = ref({ username: '', password: '', role: 'regular_user', officeId: undefined as number | undefined })

const showUpdateUserModal = ref(false)
const selectedUser = ref<any | null>(null)
const updateUserData = ref({ role: '', status: '', mustChangePassword: false })
const updateUserLoading = ref(false)

async function loadUsers() {
  usersLoading.value = true
  try {
    const params: { limit: number; search?: string } = { limit: 50 }
    if (userSearch.value.trim()) params.search = userSearch.value.trim()
    const res = await adminApi.listUsers(params)
    users.value = res.data.data.items
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    usersLoading.value = false
  }
}

let searchDebounce: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => loadUsers(), 300)
}

function blacklistFromUser(type: 'user' | 'ip' | 'device', value: string) {
  newBlacklist.value = { subjectType: type, subjectValue: value, reason: '', expiresAt: '' }
  showAddBlacklistModal.value = true
}

async function handleCreateUser() {
  createUserLoading.value = true
  try {
    await adminApi.createUser({
      username: newUser.value.username,
      password: newUser.value.password,
      role: newUser.value.role,
      officeId: newUser.value.officeId,
    })
    toast.success('User created.')
    showCreateUserModal.value = false
    newUser.value = { username: '', password: '', role: 'regular_user', officeId: undefined }
    loadUsers()
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    createUserLoading.value = false
  }
}

function openUpdateUser(user: any) {
  selectedUser.value = user
  updateUserData.value = { role: user.role, status: user.status, mustChangePassword: !!user.must_change_password }
  showUpdateUserModal.value = true
}

async function handleUpdateUser() {
  if (!selectedUser.value) return
  updateUserLoading.value = true
  try {
    const payload: { role?: string; status?: string; mustChangePassword?: boolean; nonce?: string } = {}

    // Only include role when it has actually changed — backend requires a nonce for role changes
    const roleChanged = updateUserData.value.role !== selectedUser.value.role
    if (roleChanged) {
      const nonceRes = await authApi.getNonce('role_change')
      payload.nonce = nonceRes.data.data.nonce
      payload.role = updateUserData.value.role
    }

    if (updateUserData.value.status !== selectedUser.value.status) {
      payload.status = updateUserData.value.status
    }

    const currentMcp = !!selectedUser.value.must_change_password
    if (updateUserData.value.mustChangePassword !== currentMcp) {
      payload.mustChangePassword = updateUserData.value.mustChangePassword
    }

    // If nothing changed, skip the request
    if (Object.keys(payload).filter(k => k !== 'nonce').length === 0) {
      toast.success('No changes to save.')
      showUpdateUserModal.value = false
      return
    }

    await adminApi.updateUser(selectedUser.value.id, payload)
    toast.success('User updated.')
    showUpdateUserModal.value = false
    loadUsers()
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    updateUserLoading.value = false
  }
}

async function handleUnlockUser(id: number) {
  try {
    await adminApi.unlockUser(id)
    toast.success('User unlocked.')
    loadUsers()
  } catch (err) {
    toast.error(extractError(err))
  }
}

// ── Risk & Blacklist ─────────────────────────────────────────────────
const blacklist = ref<any[]>([])
const blacklistLoading = ref(false)
const showAddBlacklistModal = ref(false)
const addBlacklistLoading = ref(false)
const newBlacklist = ref({ subjectType: 'user', subjectValue: '', reason: '', expiresAt: '' })
const showRemoveBlacklistConfirm = ref(false)
const removingBlacklistId = ref<number | null>(null)

async function loadBlacklist() {
  blacklistLoading.value = true
  try {
    const res = await adminApi.listBlacklist()
    blacklist.value = res.data.data
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    blacklistLoading.value = false
  }
}

async function handleAddBlacklist() {
  addBlacklistLoading.value = true
  try {
    await adminApi.addBlacklist({
      subjectType: newBlacklist.value.subjectType,
      subjectValue: newBlacklist.value.subjectValue,
      reason: newBlacklist.value.reason,
      expiresAt: newBlacklist.value.expiresAt || undefined,
    })
    toast.success('Blacklist entry added.')
    showAddBlacklistModal.value = false
    newBlacklist.value = { subjectType: 'user', subjectValue: '', reason: '', expiresAt: '' }
    loadBlacklist()
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    addBlacklistLoading.value = false
  }
}

function confirmRemoveBlacklist(id: number) {
  removingBlacklistId.value = id
  showRemoveBlacklistConfirm.value = true
}

async function handleRemoveBlacklist() {
  showRemoveBlacklistConfirm.value = false
  if (removingBlacklistId.value === null) return
  try {
    await adminApi.removeBlacklist(removingBlacklistId.value)
    toast.success('Blacklist entry removed.')
    loadBlacklist()
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    removingBlacklistId.value = null
  }
}

// ── Audit Chain ──────────────────────────────────────────────────────
const auditResult = ref<{ valid: boolean; brokenAt?: string } | null>(null)
const auditLoading = ref(false)

async function verifyAuditChain() {
  auditLoading.value = true
  try {
    const res = await adminApi.verifyAuditChain()
    auditResult.value = res.data.data
    if (res.data.data.valid) toast.success('Audit chain is valid.')
    else toast.error(`Audit chain broken at: ${res.data.data.brokenAt}`)
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    auditLoading.value = false
  }
}

// ── Job Runs ─────────────────────────────────────────────────────────
const jobRuns = ref<any[]>([])
const jobRunsLoading = ref(false)

async function loadJobRuns() {
  jobRunsLoading.value = true
  try {
    const res = await adminApi.getJobRuns()
    jobRuns.value = res.data.data
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    jobRunsLoading.value = false
  }
}

// Tab switching
function switchTab(tab: typeof activeTab.value) {
  activeTab.value = tab
  if (tab === 'users' && users.value.length === 0) loadUsers()
  if (tab === 'risk' && blacklist.value.length === 0) loadBlacklist()
  if (tab === 'jobs' && jobRuns.value.length === 0) loadJobRuns()
}

onMounted(() => loadUsers())
</script>

<template>
  <AppShell>
    <div class="page-header">
      <h1>Admin</h1>
    </div>

    <!-- Tabs -->
    <div style="display: flex; gap: 0; border-bottom: 2px solid var(--color-border); margin-bottom: 24px;">
      <button
        v-for="tab in [['users','Users'],['risk','Risk &amp; Blacklist'],['audit','Audit Chain'],['jobs','Job Runs']]"
        :key="tab[0]"
        :class="['btn', activeTab === tab[0] ? 'btn-primary' : 'btn-secondary']"
        style="border-radius: 0; border-bottom: none;"
        @click="switchTab(tab[0] as 'users' | 'risk' | 'audit' | 'jobs')"
      >
        <span v-html="tab[1]" />
      </button>
    </div>

    <!-- Users Tab -->
    <div v-if="activeTab === 'users'">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px;">
        <input
          v-model="userSearch"
          class="form-input"
          type="text"
          placeholder="Search by username..."
          style="max-width: 300px;"
          @input="onSearchInput"
        />
        <button class="btn btn-primary" @click="showCreateUserModal = true">+ Create User</button>
      </div>
      <div class="card">
        <div v-if="usersLoading" class="card-body" style="text-align: center;">
          <LoadingSpinner size="lg" />
        </div>
        <div v-else style="overflow-x: auto;">
          <table class="table">
            <thead>
              <tr>
                <th>Username</th><th>Role</th><th>Status</th><th>Office</th><th>Last IP</th><th>Device</th><th>Last Active</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td class="font-medium">{{ u.username }}</td>
                <td><span class="badge badge-blue">{{ u.role }}</span></td>
                <td>
                  <span :class="['badge', u.status === 'active' ? 'badge-green' : 'badge-red']">{{ u.status }}</span>
                </td>
                <td class="text-muted text-sm">{{ u.office_id ?? '—' }}</td>
                <td class="font-mono text-sm" style="font-family: var(--font-mono); font-size: 12px;">{{ u.last_ip ?? '—' }}</td>
                <td class="text-sm" style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" :title="u.last_device_fingerprint ?? ''">{{ u.last_device_fingerprint ? u.last_device_fingerprint.slice(0, 12) + '...' : '—' }}</td>
                <td class="text-muted text-sm">{{ u.session_last_activity_at ? new Date(u.session_last_activity_at).toLocaleString() : '—' }}</td>
                <td>
                  <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                    <button class="btn btn-secondary btn-sm" @click="openUpdateUser(u)">Edit</button>
                    <button
                      v-if="u.locked_until"
                      class="btn btn-warning btn-sm"
                      style="background: #ffc107; border-color: #ffc107; color: #000;"
                      @click="handleUnlockUser(u.id)"
                    >
                      Unlock
                    </button>
                    <button class="btn btn-danger btn-sm" @click="blacklistFromUser('user', String(u.id))" title="Blacklist user">Ban User</button>
                    <button v-if="u.last_ip" class="btn btn-danger btn-sm" @click="blacklistFromUser('ip', u.last_ip)" title="Blacklist IP">Ban IP</button>
                    <button v-if="u.last_device_fingerprint" class="btn btn-danger btn-sm" @click="blacklistFromUser('device', u.last_device_fingerprint)" title="Blacklist device">Ban Device</button>
                  </div>
                </td>
              </tr>
              <tr v-if="users.length === 0">
                <td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 24px;">No users found.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Risk & Blacklist Tab -->
    <div v-if="activeTab === 'risk'">
      <div style="display: flex; justify-content: flex-end; margin-bottom: 16px;">
        <button class="btn btn-primary" @click="showAddBlacklistModal = true">+ Add to Blacklist</button>
      </div>
      <div class="card">
        <div class="card-header"><h3>Blacklist</h3></div>
        <div v-if="blacklistLoading" class="card-body" style="text-align: center;">
          <LoadingSpinner size="lg" />
        </div>
        <div v-else>
          <table class="table">
            <thead>
              <tr>
                <th>Type</th><th>Value</th><th>Reason</th><th>Expires</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in blacklist" :key="b.id">
                <td><span class="badge badge-gray">{{ b.subject_type }}</span></td>
                <td class="font-mono" style="font-family: var(--font-mono); font-size: 12px;">{{ b.subject_value }}</td>
                <td class="text-muted text-sm">{{ b.reason }}</td>
                <td class="text-muted text-sm">{{ b.expires_at ? new Date(b.expires_at).toLocaleDateString() : 'Never' }}</td>
                <td>
                  <button class="btn btn-danger btn-sm" @click="confirmRemoveBlacklist(b.id)">Remove</button>
                </td>
              </tr>
              <tr v-if="blacklist.length === 0">
                <td colspan="5" style="text-align: center; color: var(--color-text-muted); padding: 24px;">No blacklist entries.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Audit Chain Tab -->
    <div v-if="activeTab === 'audit'" class="card">
      <div class="card-header"><h3>Audit Chain Verification</h3></div>
      <div class="card-body">
        <p class="text-muted" style="margin-bottom: 16px;">
          Verify the integrity of the audit log chain. This checks that no records have been tampered with.
        </p>
        <button class="btn btn-primary" :disabled="auditLoading" @click="verifyAuditChain">
          <span v-if="auditLoading" class="spinner spinner-sm" />
          <span v-else>Verify Chain</span>
        </button>
        <div v-if="auditResult !== null" style="margin-top: 16px; padding: 16px; border-radius: var(--radius); border: 1px solid;" :style="{ borderColor: auditResult.valid ? 'var(--color-success)' : 'var(--color-danger)', background: auditResult.valid ? '#d4edda' : '#f8d7da' }">
          <p :style="{ color: auditResult.valid ? '#155724' : '#721c24', fontWeight: 600 }">
            {{ auditResult.valid ? '✓ Audit chain is valid' : '✗ Audit chain is broken' }}
          </p>
          <p v-if="auditResult.brokenAt" style="font-size: 13px; margin-top: 4px; color: #721c24;">
            Broken at: {{ auditResult.brokenAt }}
          </p>
        </div>
      </div>
    </div>

    <!-- Job Runs Tab -->
    <div v-if="activeTab === 'jobs'" class="card">
      <div class="card-header">
        <h3>Job Runs</h3>
        <button class="btn btn-secondary btn-sm" @click="loadJobRuns">Refresh</button>
      </div>
      <div v-if="jobRunsLoading" class="card-body" style="text-align: center;">
        <LoadingSpinner size="lg" />
      </div>
      <div v-else>
        <table class="table">
          <thead>
            <tr>
              <th>Job</th><th>Status</th><th>Started</th><th>Finished</th><th>Error</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="j in jobRuns" :key="j.id">
              <td class="font-medium">{{ j.job_name ?? j.name ?? '—' }}</td>
              <td>
                <span :class="['badge', j.status === 'success' ? 'badge-green' : j.status === 'running' ? 'badge-blue' : 'badge-red']">
                  {{ j.status }}
                </span>
              </td>
              <td class="text-sm text-muted">{{ j.started_at ? new Date(j.started_at).toLocaleString() : '—' }}</td>
              <td class="text-sm text-muted">{{ j.finished_at ? new Date(j.finished_at).toLocaleString() : '—' }}</td>
              <td class="text-sm" style="color: var(--color-danger); max-width: 200px; overflow: hidden; text-overflow: ellipsis;">{{ j.error_message ?? '—' }}</td>
            </tr>
            <tr v-if="jobRuns.length === 0">
              <td colspan="5" style="text-align: center; color: var(--color-text-muted); padding: 24px;">No job runs found.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Create User Modal -->
    <BaseModal title="Create User" :show="showCreateUserModal" @close="showCreateUserModal = false">
      <div class="form-group">
        <label class="form-label">Username <span class="required">*</span></label>
        <input v-model="newUser.username" class="form-input" type="text" />
      </div>
      <div class="form-group">
        <label class="form-label">Password <span class="required">*</span></label>
        <input v-model="newUser.password" class="form-input" type="password" autocomplete="new-password" />
      </div>
      <div class="form-group">
        <label class="form-label">Role</label>
        <select v-model="newUser.role" class="form-select">
          <option value="regular_user">Regular User</option>
          <option value="merchant">Merchant</option>
          <option value="operations">Operations</option>
          <option value="administrator">Administrator</option>
        </select>
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="showCreateUserModal = false">Cancel</button>
        <button class="btn btn-primary" :disabled="createUserLoading" @click="handleCreateUser">
          <span v-if="createUserLoading" class="spinner spinner-sm" />
          <span v-else>Create</span>
        </button>
      </template>
    </BaseModal>

    <!-- Update User Modal -->
    <BaseModal v-if="selectedUser" title="Edit User" :show="showUpdateUserModal" @close="showUpdateUserModal = false">
      <p class="text-muted" style="margin-bottom: 16px;">Editing: <strong>{{ selectedUser.username }}</strong></p>
      <div class="form-group">
        <label class="form-label">Role</label>
        <select v-model="updateUserData.role" class="form-select">
          <option value="regular_user">Regular User</option>
          <option value="merchant">Merchant</option>
          <option value="operations">Operations</option>
          <option value="administrator">Administrator</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select v-model="updateUserData.status" class="form-select">
          <option value="active">Active</option>
          <option value="locked">Locked</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input v-model="updateUserData.mustChangePassword" type="checkbox" />
          <span class="form-label" style="margin-bottom: 0;">Must change password on next login</span>
        </label>
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="showUpdateUserModal = false">Cancel</button>
        <button class="btn btn-primary" :disabled="updateUserLoading" @click="handleUpdateUser">
          <span v-if="updateUserLoading" class="spinner spinner-sm" />
          <span v-else>Save</span>
        </button>
      </template>
    </BaseModal>

    <!-- Add Blacklist Modal -->
    <BaseModal title="Add to Blacklist" :show="showAddBlacklistModal" @close="showAddBlacklistModal = false">
      <div class="form-group">
        <label class="form-label">Subject Type</label>
        <select v-model="newBlacklist.subjectType" class="form-select">
          <option value="user">User</option>
          <option value="ip">IP Address</option>
          <option value="device">Device</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Subject Value <span class="required">*</span></label>
        <input v-model="newBlacklist.subjectValue" class="form-input" type="text" placeholder="User ID, IP, or email" />
      </div>
      <div class="form-group">
        <label class="form-label">Reason <span class="required">*</span></label>
        <textarea v-model="newBlacklist.reason" class="form-textarea" placeholder="Reason for blacklisting..." />
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Expires At (optional)</label>
        <input v-model="newBlacklist.expiresAt" class="form-input" type="datetime-local" />
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="showAddBlacklistModal = false">Cancel</button>
        <button class="btn btn-danger" :disabled="addBlacklistLoading" @click="handleAddBlacklist">
          <span v-if="addBlacklistLoading" class="spinner spinner-sm" />
          <span v-else>Add</span>
        </button>
      </template>
    </BaseModal>

    <!-- Remove Blacklist Confirm -->
    <ConfirmDialog
      :show="showRemoveBlacklistConfirm"
      title="Remove Blacklist Entry"
      message="Remove this entry from the blacklist?"
      confirm-label="Remove"
      :dangerous="true"
      @confirm="handleRemoveBlacklist"
      @cancel="showRemoveBlacklistConfirm = false"
    />
  </AppShell>
</template>
