import { describe, it, expect, beforeEach } from 'vitest'
import { getDeviceFingerprint, _resetFingerprintCache, STORAGE_KEY } from '@/api/fingerprint'

describe('getDeviceFingerprint', () => {
  beforeEach(() => {
    localStorage.clear()
    _resetFingerprintCache()
  })

  it('generates a UUID fingerprint on first call', () => {
    const fp = getDeviceFingerprint()
    expect(fp).toBeTruthy()
    expect(fp).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('returns the same fingerprint on subsequent calls', () => {
    const fp1 = getDeviceFingerprint()
    const fp2 = getDeviceFingerprint()
    expect(fp1).toBe(fp2)
  })

  it('persists fingerprint in localStorage', () => {
    const fp = getDeviceFingerprint()
    const stored = localStorage.getItem(STORAGE_KEY)
    expect(stored).toBe(fp)
  })

  it('reuses fingerprint from localStorage when cache is cold', () => {
    const manualFp = 'pre-set-fp-12345678'
    localStorage.setItem(STORAGE_KEY, manualFp)
    const fp = getDeviceFingerprint()
    expect(fp).toBe(manualFp)
  })
})
