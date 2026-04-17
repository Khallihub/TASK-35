export const STORAGE_KEY = 'hs_device_fingerprint'

let cached: string | null = null

/**
 * Returns a stable device fingerprint for this browser.
 * Generated once via crypto.randomUUID() and persisted in localStorage.
 * Used for refresh-token binding (PRD §8.1) and multi-device risk scoring.
 */
export function getDeviceFingerprint(): string {
  if (cached) return cached
  let fp = localStorage.getItem(STORAGE_KEY)
  if (!fp) {
    fp = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, fp)
  }
  cached = fp
  return fp
}

/** Reset the in-memory cache (for testing only). */
export function _resetFingerprintCache(): void {
  cached = null
}
