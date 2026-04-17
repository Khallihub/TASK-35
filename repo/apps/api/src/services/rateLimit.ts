interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();

/**
 * Check if a key has exceeded maxAttempts within windowMs milliseconds.
 * Returns { allowed: true } if within limit, or { allowed: false, retryAfterMs } if exceeded.
 * This is a read-only check — it does NOT increment the counter.
 * Use recordFailedRequest() to increment on failed attempts only.
 */
export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    // No active window or window expired — allowed
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= maxAttempts) {
    const retryAfterMs = windowMs - (now - entry.windowStart);
    return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Increment the counter for a key (used when a request results in 401/403).
 */
export function recordFailedRequest(key: string, windowMs: number): void {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    store.set(key, { count: 1, windowStart: now });
  } else {
    entry.count++;
  }
}

/**
 * Reset a key's counter (e.g., on successful login).
 */
export function resetRateLimit(key: string): void {
  store.delete(key);
}

/** For testing: clear all entries */
export function clearAllRateLimits(): void {
  store.clear();
}
