<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { promoApi, type PromoSlotData } from '@/api/promo'
import { listingsApi, type ListingData } from '@/api/listings'
import { useToast } from '@/composables/useToast'
import { extractError } from '@/api/client'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'

const props = defineProps<{
  collectionId: number
  slots: PromoSlotData[]
}>()

const emit = defineEmits<{ updated: [slots: PromoSlotData[]] }>()

const toast = useToast()
const localSlots = ref<PromoSlotData[]>([...props.slots].sort((a, b) => a.rank - b.rank))

const showAddModal = ref(false)
const searchQuery = ref('')
const searchResults = ref<ListingData[]>([])
const searchLoading = ref(false)

const showDeleteConfirm = ref(false)
const deletingSlotId = ref<number | null>(null)
const reordering = ref(false)
const draggingIndex = ref<number | null>(null)

async function searchListings() {
  if (!searchQuery.value.trim()) return
  searchLoading.value = true
  try {
    const res = await listingsApi.list({ status: 'published', q: searchQuery.value, limit: 10 })
    searchResults.value = res.data.data.items
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    searchLoading.value = false
  }
}

async function addSlot(listingId: number) {
  const nextRank = localSlots.value.length > 0 ? Math.max(...localSlots.value.map(s => s.rank)) + 1 : 1
  try {
    const res = await promoApi.addSlot(props.collectionId, listingId, nextRank)
    localSlots.value.push(res.data.data)
    localSlots.value.sort((a, b) => a.rank - b.rank)
    emit('updated', localSlots.value)
    toast.success('Listing added to collection.')
    showAddModal.value = false
    searchResults.value = []
    searchQuery.value = ''
  } catch (err) {
    toast.error(extractError(err))
  }
}

function confirmRemove(slotId: number) {
  deletingSlotId.value = slotId
  showDeleteConfirm.value = true
}

async function removeSlot() {
  showDeleteConfirm.value = false
  if (deletingSlotId.value === null) return
  try {
    await promoApi.removeSlot(props.collectionId, deletingSlotId.value)
    localSlots.value = localSlots.value.filter(s => s.id !== deletingSlotId.value)
    emit('updated', localSlots.value)
    toast.success('Slot removed.')
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    deletingSlotId.value = null
  }
}

function onDragStart(index: number) {
  draggingIndex.value = index
}

function onDragOver(e: DragEvent, index: number) {
  e.preventDefault()
  if (draggingIndex.value === null || draggingIndex.value === index) return
  const items = [...localSlots.value]
  const [moved] = items.splice(draggingIndex.value, 1)
  items.splice(index, 0, moved)
  localSlots.value = items
  draggingIndex.value = index
}

async function onDragEnd() {
  draggingIndex.value = null
  reordering.value = true
  try {
    const updated = localSlots.value.map((s, i) => ({ ...s, rank: i + 1 }))
    await promoApi.reorderSlots(props.collectionId, updated.map(s => ({ slotId: s.id, rank: s.rank })))
    localSlots.value = updated
    emit('updated', localSlots.value)
  } catch (err) {
    toast.error(extractError(err))
  } finally {
    reordering.value = false
  }
}

async function recordClick(slot: PromoSlotData) {
  try {
    await promoApi.click(props.collectionId, slot.listing_id)
  } catch {
    // Engagement tracking is best-effort; failures must not block navigation.
  }
}
</script>

<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
      <h3 class="section-title" style="margin-bottom: 0;">Slots</h3>
      <button class="btn btn-primary btn-sm" @click="showAddModal = true">+ Add Listing</button>
    </div>

    <div v-if="localSlots.length === 0" class="empty-state" style="padding: 24px;">
      <p>No listings in this collection yet.</p>
    </div>

    <div v-else style="display: flex; flex-direction: column; gap: 8px;">
      <div
        v-for="(slot, idx) in localSlots"
        :key="slot.id"
        draggable="true"
        style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-surface); cursor: grab;"
        @dragstart="onDragStart(idx)"
        @dragover="onDragOver($event, idx)"
        @dragend="onDragEnd"
      >
        <span style="font-size: 18px; color: var(--color-text-muted);">☰</span>
        <span class="badge badge-gray" style="min-width: 28px; justify-content: center;">{{ idx + 1 }}</span>
        <span style="flex: 1; font-size: 13px;">Listing #{{ slot.listing_id }}</span>
        <span class="text-muted text-sm">Added {{ new Date(slot.added_at).toLocaleDateString() }}</span>
        <RouterLink
          :to="`/listings/${slot.listing_id}`"
          class="btn btn-secondary btn-sm"
          data-test="promo-click"
          @click="recordClick(slot)"
        >
          Open
        </RouterLink>
        <button class="btn btn-danger btn-sm" @click="confirmRemove(slot.id)">Remove</button>
      </div>
    </div>

    <div v-if="reordering" style="text-align:center; padding: 8px; color: var(--color-text-muted); font-size: 13px;">
      Saving order...
    </div>

    <!-- Add Listing Modal -->
    <Teleport to="body">
      <div v-if="showAddModal" class="overlay" @click.self="showAddModal = false">
        <div class="modal" role="dialog" aria-label="Add Listing">
          <div class="modal-header">
            <h2>Add Published Listing</h2>
            <button class="btn-icon" @click="showAddModal = false">&times;</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Search Published Listings</label>
              <div style="display: flex; gap: 8px;">
                <input v-model="searchQuery" class="form-input" placeholder="Search by address, city..." @keyup.enter="searchListings" />
                <button class="btn btn-primary" @click="searchListings">Search</button>
              </div>
            </div>
            <div v-if="searchLoading" style="text-align:center;"><div class="spinner" /></div>
            <div v-else-if="searchResults.length === 0 && searchQuery" class="empty-state" style="padding: 16px;">
              <p>No published listings found.</p>
            </div>
            <div v-else style="display: flex; flex-direction: column; gap: 8px;">
              <div
                v-for="listing in searchResults"
                :key="listing.id"
                style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--radius);"
              >
                <div>
                  <p style="font-size: 13px; font-weight: 500;">{{ listing.address_line ?? `Listing #${listing.id}` }}</p>
                  <p class="text-muted text-sm">{{ listing.city }}, {{ listing.state_code }}</p>
                </div>
                <button class="btn btn-primary btn-sm" @click="addSlot(listing.id)">Add</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <ConfirmDialog
      :show="showDeleteConfirm"
      title="Remove Slot"
      message="Remove this listing from the collection?"
      confirm-label="Remove"
      :dangerous="true"
      @confirm="removeSlot"
      @cancel="showDeleteConfirm = false"
    />
  </div>
</template>
