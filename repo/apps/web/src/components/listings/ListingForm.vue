<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { type ListingData } from '@/api/listings'
import AnomalyFlagBanner from './AnomalyFlagBanner.vue'

const props = defineProps<{
  listing?: ListingData
  loading?: boolean
  role?: string
}>()

const emit = defineEmits<{ submit: [data: Record<string, unknown>] }>()

const ORIENTATIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const BATHS_OPTIONS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]

// Area unit toggle
const areaUnit = ref<'sqft' | 'sqm'>('sqft')

// Price in dollars (display)
const priceDollars = ref<string>(props.listing?.price_usd_cents != null ? String(props.listing.price_usd_cents / 100) : '')

// Fields
const addressLine = ref(props.listing?.address_line ?? '')
const city = ref(props.listing?.city ?? '')
const stateCode = ref(props.listing?.state_code ?? '')
const postalCode = ref(props.listing?.postal_code ?? '')
const beds = ref<string>(props.listing?.beds != null ? String(props.listing.beds) : '')
const baths = ref<string>(props.listing?.baths != null ? String(props.listing.baths) : '')
const floorLevel = ref<string>(props.listing?.floor_level != null ? String(props.listing.floor_level) : '')
const orientation = ref<string>(props.listing?.orientation ?? '')
const latitude = ref<string>(props.listing?.latitude != null ? String(props.listing.latitude) : '')
const longitude = ref<string>(props.listing?.longitude != null ? String(props.listing.longitude) : '')
const areaSqft = ref<string>(props.listing?.area_sqft != null ? String(props.listing.area_sqft) : '')
const areaSqm = ref<string>(props.listing?.area_sqm != null ? String(props.listing.area_sqm) : '')

const overrideReason = ref('')
const anomalyFlags = computed(() => props.listing?.anomaly_flags ?? [])

// Validation errors
const errors = ref<Record<string, string>>({})

function validateField(field: string, value: string) {
  const e: Record<string, string> = { ...errors.value }
  delete e[field]
  if (field === 'priceDollars' && value && isNaN(parseFloat(value))) {
    e[field] = 'Must be a valid number'
  }
  if (field === 'latitude' && value && (isNaN(parseFloat(value)) || Math.abs(parseFloat(value)) > 90)) {
    e[field] = 'Must be between -90 and 90'
  }
  if (field === 'longitude' && value && (isNaN(parseFloat(value)) || Math.abs(parseFloat(value)) > 180)) {
    e[field] = 'Must be between -180 and 180'
  }
  if (field === 'beds' && value && (!Number.isInteger(parseFloat(value)) || parseFloat(value) < 0)) {
    e[field] = 'Must be a non-negative integer'
  }
  errors.value = e
}

// Sync sqft/sqm when unit changes
watch(areaUnit, (unit) => {
  if (unit === 'sqm' && areaSqft.value) {
    areaSqm.value = (parseFloat(areaSqft.value) * 0.0929).toFixed(2)
  } else if (unit === 'sqft' && areaSqm.value) {
    areaSqft.value = (parseFloat(areaSqm.value) / 0.0929).toFixed(2)
  }
})

function handleSubmit() {
  const data: Record<string, unknown> = {}

  if (addressLine.value) data.address_line = addressLine.value
  if (city.value) data.city = city.value
  if (stateCode.value) data.state_code = stateCode.value
  if (postalCode.value) data.postal_code = postalCode.value
  if (beds.value) data.beds = parseInt(beds.value, 10)
  if (baths.value) data.baths = parseFloat(baths.value)
  if (floorLevel.value) data.floor_level = parseInt(floorLevel.value, 10)
  if (orientation.value) data.orientation = orientation.value
  if (latitude.value) data.latitude = parseFloat(latitude.value)
  if (longitude.value) data.longitude = parseFloat(longitude.value)
  if (priceDollars.value) data.price_usd_cents = Math.round(parseFloat(priceDollars.value) * 100)

  // Area
  if (areaUnit.value === 'sqft') {
    if (areaSqft.value) {
      data.area_sqft = parseFloat(areaSqft.value)
      data.area_sqm = parseFloat((parseFloat(areaSqft.value) * 0.0929).toFixed(2))
    }
  } else {
    if (areaSqm.value) {
      data.area_sqm = parseFloat(areaSqm.value)
      data.area_sqft = parseFloat((parseFloat(areaSqm.value) / 0.0929).toFixed(2))
    }
  }

  emit('submit', data)
}
</script>

<template>
  <div>
    <AnomalyFlagBanner
      v-if="anomalyFlags.length > 0"
      :flags="anomalyFlags"
      :role="role ?? ''"
      v-model="overrideReason"
    />

    <!-- Address -->
    <h3 class="section-title">Location</h3>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
      <div class="form-group" style="grid-column: 1 / -1;">
        <label class="form-label">Address Line</label>
        <input v-model="addressLine" class="form-input" type="text" placeholder="123 Main St" />
      </div>
      <div class="form-group">
        <label class="form-label" for="listing-city">City</label>
        <input id="listing-city" v-model="city" class="form-input" type="text" />
      </div>
      <div class="form-group">
        <label class="form-label" for="listing-state">State Code</label>
        <input id="listing-state" v-model="stateCode" class="form-input" type="text" placeholder="CA" maxlength="2" />
      </div>
      <div class="form-group">
        <label class="form-label" for="listing-postal">Postal Code</label>
        <input id="listing-postal" v-model="postalCode" class="form-input" type="text" />
      </div>
      <div class="form-group">
        <label class="form-label">Latitude</label>
        <input
          v-model="latitude"
          class="form-input"
          :class="{ error: errors.latitude }"
          type="number"
          step="0.000001"
          @blur="validateField('latitude', latitude)"
        />
        <span v-if="errors.latitude" class="form-error">{{ errors.latitude }}</span>
      </div>
      <div class="form-group">
        <label class="form-label">Longitude</label>
        <input
          v-model="longitude"
          class="form-input"
          :class="{ error: errors.longitude }"
          type="number"
          step="0.000001"
          @blur="validateField('longitude', longitude)"
        />
        <span v-if="errors.longitude" class="form-error">{{ errors.longitude }}</span>
      </div>
    </div>

    <hr class="divider" />

    <!-- Property details -->
    <h3 class="section-title">Property Details</h3>
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
      <div class="form-group">
        <label class="form-label">Price (USD)</label>
        <input
          v-model="priceDollars"
          class="form-input"
          :class="{ error: errors.priceDollars }"
          type="number"
          step="0.01"
          min="0"
          placeholder="500000"
          @blur="validateField('priceDollars', priceDollars)"
        />
        <span v-if="errors.priceDollars" class="form-error">{{ errors.priceDollars }}</span>
      </div>
      <div class="form-group">
        <label class="form-label" for="listing-beds">Beds</label>
        <input
          id="listing-beds"
          v-model="beds"
          class="form-input"
          :class="{ error: errors.beds }"
          type="number"
          min="0"
          step="1"
          @blur="validateField('beds', beds)"
        />
        <span v-if="errors.beds" class="form-error">{{ errors.beds }}</span>
      </div>
      <div class="form-group">
        <label class="form-label" for="listing-baths">Baths</label>
        <select id="listing-baths" v-model="baths" class="form-select">
          <option value="">Select</option>
          <option v-for="b in BATHS_OPTIONS" :key="b" :value="String(b)">{{ b }}</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Floor Level</label>
        <input v-model="floorLevel" class="form-input" type="number" min="0" step="1" />
      </div>
      <div class="form-group">
        <label class="form-label">Orientation</label>
        <select v-model="orientation" class="form-select">
          <option value="">Select</option>
          <option v-for="o in ORIENTATIONS" :key="o" :value="o">{{ o }}</option>
        </select>
      </div>
    </div>

    <!-- Area with unit toggle -->
    <div class="form-group">
      <label class="form-label">
        Area
        <span style="margin-left: 12px;">
          <button
            type="button"
            :class="['btn btn-sm', areaUnit === 'sqft' ? 'btn-primary' : 'btn-secondary']"
            style="margin-right: 4px;"
            @click="areaUnit = 'sqft'"
          >sqft</button>
          <button
            type="button"
            :class="['btn btn-sm', areaUnit === 'sqm' ? 'btn-primary' : 'btn-secondary']"
            @click="areaUnit = 'sqm'"
          >sqm</button>
        </span>
      </label>
      <input
        v-if="areaUnit === 'sqft'"
        v-model="areaSqft"
        class="form-input"
        type="number"
        min="0"
        step="1"
        placeholder="Area in sqft"
      />
      <input
        v-else
        v-model="areaSqm"
        class="form-input"
        type="number"
        min="0"
        step="0.01"
        placeholder="Area in sqm"
      />
    </div>

    <div style="display: flex; justify-content: flex-end; margin-top: 24px;">
      <button class="btn btn-primary" :disabled="loading" @click="handleSubmit">
        <span v-if="loading" class="spinner spinner-sm" />
        <span v-else>{{ listing ? 'Save Changes' : 'Create Listing' }}</span>
      </button>
    </div>
  </div>
</template>
