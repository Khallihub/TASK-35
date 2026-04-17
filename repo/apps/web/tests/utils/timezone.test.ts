import { describe, it, expect } from 'vitest'
import { toTzDatetimeInput, fromTzDatetimeInput, getTimezoneOffsetMs } from '@/utils/timezone'

describe('getTimezoneOffsetMs', () => {
  it('returns -4h for America/New_York in July (EDT)', () => {
    const ms = getTimezoneOffsetMs(new Date('2025-07-01T12:00:00Z'), 'America/New_York')
    expect(ms).toBe(-4 * 60 * 60 * 1000)
  })

  it('returns -5h for America/New_York in January (EST)', () => {
    const ms = getTimezoneOffsetMs(new Date('2025-01-15T12:00:00Z'), 'America/New_York')
    expect(ms).toBe(-5 * 60 * 60 * 1000)
  })

  it('returns +9h for Asia/Tokyo', () => {
    const ms = getTimezoneOffsetMs(new Date('2025-07-01T12:00:00Z'), 'Asia/Tokyo')
    expect(ms).toBe(9 * 60 * 60 * 1000)
  })

  it('returns 0 for UTC', () => {
    expect(getTimezoneOffsetMs(new Date('2025-07-01T12:00:00Z'), 'UTC')).toBe(0)
  })
})

describe('toTzDatetimeInput', () => {
  it('converts UTC to wall time in America/New_York (EDT)', () => {
    expect(toTzDatetimeInput('2025-07-01T18:00:00Z', 'America/New_York')).toBe('2025-07-01T14:00')
  })

  it('converts UTC to wall time in America/New_York (EST)', () => {
    expect(toTzDatetimeInput('2025-01-15T18:00:00Z', 'America/New_York')).toBe('2025-01-15T13:00')
  })

  it('converts UTC to wall time in Asia/Tokyo', () => {
    expect(toTzDatetimeInput('2025-07-01T05:00:00Z', 'Asia/Tokyo')).toBe('2025-07-01T14:00')
  })

  it('is identity for UTC', () => {
    expect(toTzDatetimeInput('2025-07-01T14:30:00Z', 'UTC')).toBe('2025-07-01T14:30')
  })

  it('returns empty string for empty input', () => {
    expect(toTzDatetimeInput('', 'America/New_York')).toBe('')
  })
})

describe('fromTzDatetimeInput', () => {
  it('converts New York wall time to correct UTC in July (EDT)', () => {
    // 14:00 EDT = 18:00 UTC
    expect(fromTzDatetimeInput('2025-07-01T14:00', 'America/New_York')).toBe('2025-07-01T18:00:00.000Z')
  })

  it('converts New York wall time to correct UTC in January (EST)', () => {
    // 13:00 EST = 18:00 UTC
    expect(fromTzDatetimeInput('2025-01-15T13:00', 'America/New_York')).toBe('2025-01-15T18:00:00.000Z')
  })

  it('converts Tokyo wall time to correct UTC', () => {
    // 14:00 JST = 05:00 UTC
    expect(fromTzDatetimeInput('2025-07-01T14:00', 'Asia/Tokyo')).toBe('2025-07-01T05:00:00.000Z')
  })

  it('is identity for UTC', () => {
    expect(fromTzDatetimeInput('2025-07-01T14:30', 'UTC')).toBe('2025-07-01T14:30:00.000Z')
  })

  it('returns empty string for empty input', () => {
    expect(fromTzDatetimeInput('', 'America/New_York')).toBe('')
  })

  it('round-trips through toTzDatetimeInput', () => {
    const orig = '2025-07-01T18:00:00.000Z'
    const local = toTzDatetimeInput(orig, 'America/New_York')
    const back = fromTzDatetimeInput(local, 'America/New_York')
    expect(back).toBe(orig)
  })

  it('round-trips for negative-offset zone in winter', () => {
    const orig = '2025-01-15T18:00:00.000Z'
    const local = toTzDatetimeInput(orig, 'America/New_York')
    const back = fromTzDatetimeInput(local, 'America/New_York')
    expect(back).toBe(orig)
  })

  it('round-trips for positive-offset zone', () => {
    const orig = '2025-07-01T05:00:00.000Z'
    const local = toTzDatetimeInput(orig, 'Asia/Tokyo')
    const back = fromTzDatetimeInput(local, 'Asia/Tokyo')
    expect(back).toBe(orig)
  })
})
