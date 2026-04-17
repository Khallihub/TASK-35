/**
 * Timezone-aware conversion utilities for datetime-local inputs.
 *
 * These functions use Intl.DateTimeFormat (available in all modern browsers and Node ≥ 14)
 * to perform correct conversion between UTC instants and wall-clock times in an
 * IANA-named timezone — without requiring an external dependency.
 */

/**
 * Read a specific field from a formatToParts result.
 */
function getPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '00'
}

/**
 * Compute the timezone offset (in milliseconds) at a specific UTC instant in a named IANA zone.
 *
 * Example: for `America/New_York` in July 2025, returns -14400000 (-4 hours, EDT).
 */
export function getTimezoneOffsetMs(utcInstant: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(utcInstant)
  // Handle the 'hour: 24' edge case some runtimes produce at midnight
  const hourRaw = getPart(parts, 'hour')
  const hour = hourRaw === '24' ? 0 : Number(hourRaw)
  // "asIfUtc" is the wall time we'd see in `timeZone`, treated as UTC — in ms.
  const asIfUtc = Date.UTC(
    Number(getPart(parts, 'year')),
    Number(getPart(parts, 'month')) - 1,
    Number(getPart(parts, 'day')),
    hour,
    Number(getPart(parts, 'minute')),
    Number(getPart(parts, 'second')),
  )
  // offset = tz wall-time minus true UTC. For UTC-4 zones this is negative.
  return asIfUtc - utcInstant.getTime()
}

/**
 * Convert a UTC ISO-8601 string to a `datetime-local` input value
 * representing the same instant in the install timezone.
 *
 * Example: for "2025-07-01T18:00:00Z" + "America/New_York" → "2025-07-01T14:00".
 */
export function toTzDatetimeInput(iso: string, timeZone: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(d)
  const hourRaw = getPart(parts, 'hour')
  const hour = hourRaw === '24' ? '00' : hourRaw.padStart(2, '0')
  return (
    `${getPart(parts, 'year')}-${getPart(parts, 'month')}-${getPart(parts, 'day')}` +
    `T${hour}:${getPart(parts, 'minute')}`
  )
}

/**
 * Convert a `datetime-local` value (wall-clock time in the install timezone) to a UTC ISO-8601 string.
 *
 * Uses an iterative offset-resolution approach that correctly handles DST boundaries.
 *
 * Example: for "2025-07-01T14:00" + "America/New_York" → "2025-07-01T18:00:00.000Z"
 *          (EDT is UTC-4, so 14:00 EDT = 18:00 UTC)
 */
export function fromTzDatetimeInput(localValue: string, timeZone: string): string {
  if (!localValue) return ''
  // Treat localValue as if it were UTC — this gives us a first guess
  const naive = new Date(localValue.length === 16 ? `${localValue}:00Z` : `${localValue}Z`)
  if (Number.isNaN(naive.getTime())) return ''

  // Step 1: initial guess — subtract the offset computed at `naive`
  const offset1 = getTimezoneOffsetMs(naive, timeZone)
  const guess1 = new Date(naive.getTime() - offset1)

  // Step 2: refine — recompute offset at the guessed instant (handles DST crossing)
  const offset2 = getTimezoneOffsetMs(guess1, timeZone)
  const guess2 = new Date(naive.getTime() - offset2)

  return guess2.toISOString()
}
