import Koa from 'koa';
import { AppError, ErrorCodes } from '../errors';
import { checkRateLimit, recordFailedRequest } from '../services/rateLimit';

const IP_RATE_LIMIT_MAX = 30;
const IP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// General API throttle: per-IP limits for all /api requests (successful or not).
// Generous enough not to affect normal usage but caps sustained abuse.
const API_THROTTLE_MAX = 300;             // 300 requests per window
const API_THROTTLE_WINDOW_MS = 60 * 1000; // 1-minute window

function getClientIp(ctx: Koa.Context): string {
  const forwarded = ctx.get('X-Forwarded-For');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return ctx.ip ?? 'unknown';
}

export function ipRateLimitMiddleware(): Koa.Middleware {
  return async (ctx, next) => {
    const ip = getClientIp(ctx);

    // ── General API throttle (pre-route) ──────────────────────────────
    // Applies to all /api requests regardless of success/failure. The
    // counter is incremented on *every* request (the checker is read-only
    // by design — see services/rateLimit.ts), so sustained abuse from a
    // single IP trips the 300-req/min cap even when each individual
    // request would otherwise succeed.
    if (ctx.path.startsWith('/api/')) {
      const apiKey = `api:${ip}`;
      const apiResult = checkRateLimit(apiKey, API_THROTTLE_MAX, API_THROTTLE_WINDOW_MS);
      if (!apiResult.allowed) {
        const retryAfterSecs = Math.ceil(apiResult.retryAfterMs / 1000);
        ctx.set('Retry-After', String(retryAfterSecs));
        ctx.status = 429;
        ctx.body = {
          ok: false,
          error: {
            code: ErrorCodes.RATE_LIMITED,
            message: 'Too many requests. Please slow down.',
          },
        };
        return;
      }
      // Count this request toward the general-API bucket *before* the
      // downstream handler runs — otherwise a single IP can hammer /api
      // as fast as it wants while checkRateLimit always sees zero.
      recordFailedRequest(apiKey, API_THROTTLE_WINDOW_MS);
    }

    // ── Failed-auth throttle (post-route) ─────────────────────────────
    // Stricter limit for brute-force / credential-stuffing patterns.
    // Increment the failed-request counter on every 401/403 outcome so
    // repeated forbidden/unauthorized attempts from the same IP trip the
    // 30-req/15-min cap. Without this increment the check below is a
    // no-op and the middleware-level failed-request throttle never
    // activates for routes that do not themselves call
    // recordFailedRequest.
    //
    // Downstream handlers throw AppError(…, 401/403) which the outer
    // errorMiddleware translates into ctx.status. But errorMiddleware is
    // *outside* this middleware in the stack — so by the time `await
    // next()` returns we may not see ctx.status set yet when the handler
    // threw. We therefore observe the failed-auth outcome in two places:
    //   (a) if `await next()` throws an AppError with status 401/403, OR
    //   (b) if the downstream set ctx.status = 401/403 directly (e.g.,
    //       middleware that writes the status before returning).
    // Either path increments the counter and, if tripped, converts the
    // response into a 429 with Retry-After.
    const failKey = `ip:${ip}`;
    const WINDOW = IP_RATE_LIMIT_WINDOW_MS;
    const tripIfExceeded = (): boolean => {
      const result = checkRateLimit(failKey, IP_RATE_LIMIT_MAX, WINDOW);
      if (!result.allowed) {
        const retryAfterSecs = Math.ceil(result.retryAfterMs / 1000);
        ctx.set('Retry-After', String(retryAfterSecs));
        ctx.status = 429;
        ctx.body = {
          ok: false,
          error: {
            code: ErrorCodes.RATE_LIMITED,
            message: 'Too many failed requests. Please try again later.',
          },
        };
        return true;
      }
      return false;
    };

    try {
      await next();
    } catch (err) {
      // Path (a): AppError thrown from a downstream handler.
      if (err instanceof AppError && (err.statusCode === 401 || err.statusCode === 403)) {
        recordFailedRequest(failKey, WINDOW);
        if (tripIfExceeded()) {
          // Swallow the original 401/403; the 429 response body is
          // authoritative now. Retry-After is already set.
          return;
        }
      }
      throw err;
    }

    // Path (b): downstream middleware/router set ctx.status without
    // throwing (e.g., a `ctx.status = 401; return;` flow).
    if (ctx.status === 401 || ctx.status === 403) {
      recordFailedRequest(failKey, WINDOW);
      tripIfExceeded();
    }
  };
}
