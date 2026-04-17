<script setup lang="ts">
import { ref, watch } from 'vue'
import { attachmentsApi } from '@/api/attachments'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'

const props = defineProps<{
  listingId: number
  attachmentId: number
  show: boolean
}>()

const emit = defineEmits<{ close: []; rolledBack: [] }>()

const toast = useToast()
const revisions = ref<any[]>([])
const loading = ref(false)
const rollingBack = ref<number | null>(null)

watch(() => props.show, async (val) => {
  if (val) {
    loading.value = true
    try {
      const res = await attachmentsApi.getRevisions(props.listingId, props.attachmentId)
      revisions.value = res.data.data
    } catch (err) {
      toast.error(extractError(err))
    } finally {
      loading.value = false
    }
  }
})

async function handleRollback(revisionNo: number) {
  rollingBack.value = revisionNo
  try {
    await attachmentsApi.rollback(props.listingId, props.attachmentId, revisionNo)
    toast.success('Attachment rolled back successfully.')
    emit('rolledBack')
    emit('close')
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    rollingBack.value = null
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="show" class="drawer-overlay" @click.self="$emit('close')">
        <div class="drawer">
          <div class="drawer-header">
            <h3>Attachment Revisions</h3>
            <button class="btn-icon" @click="$emit('close')" aria-label="Close">&times;</button>
          </div>
          <div class="drawer-body">
            <div v-if="loading" style="text-align:center; padding:24px;">
              <div class="spinner" />
            </div>
            <div v-else-if="revisions.length === 0" class="empty-state">
              <p>No revisions found.</p>
            </div>
            <table v-else class="table">
              <thead>
                <tr>
                  <th>Rev #</th>
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rev in revisions" :key="rev.revision_no ?? rev.id">
                  <td>{{ rev.revision_no ?? rev.id }}</td>
                  <td class="text-sm text-muted">{{ rev.created_at ? new Date(rev.created_at).toLocaleDateString() : '—' }}</td>
                  <td>
                    <button
                      class="btn btn-secondary btn-sm"
                      :disabled="rollingBack !== null"
                      @click="handleRollback(rev.revision_no ?? rev.id)"
                    >
                      <span v-if="rollingBack === (rev.revision_no ?? rev.id)" class="spinner spinner-sm" />
                      <span v-else>Restore</span>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.45);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
}
.drawer {
  width: 480px;
  max-width: 100vw;
  background: var(--color-surface);
  height: 100%;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-md);
}
.drawer-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.drawer-header h3 { font-size: 16px; font-weight: 600; }
.drawer-body { flex: 1; overflow-y: auto; padding: 20px; }

.drawer-enter-active, .drawer-leave-active { transition: transform .25s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }
</style>
