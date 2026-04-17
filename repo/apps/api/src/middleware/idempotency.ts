import crypto from 'crypto';
import Koa from 'koa';
import { AppError, ErrorCodes } from '../errors';
import { checkIdempotency, saveIdempotency } from '../services/idempotency';
import { verifyAccessToken } from '../services/token';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Paths that skip idempotency enforcement.
 *
 * Per PRD §8.3 every state-changing endpoint requires Idempotency-Key.
 * Login and refresh are included: login is additionally protected by
 * single-use nonces, and refresh by single-use rotating tokens, but
 * the idempotency layer still provides the PRD-mandated dedup guarantee
 * for all write operations.
 *
 * No paths are currently skipped.
 */
const IDEMPOTENCY_SKIP_PATHS: string[] = [];

function computeRequestHash(method: string, path: string, body: unknown): string {
  const payload = method + path + JSON.stringify(body ?? {});
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Extract user ID from Authorization header without full session validation.
 * Used so idempotency can enforce before route-level auth runs.
 */
function extractUserIdFromToken(ctx: Koa.Context): bigint | null {
  const authHeader = ctx.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.slice(7);
    const payload = verifyAccessToken(token);
    return BigInt(payload.sub);
  } catch {
    return null;
  }
}

export function idempotencyMiddleware(): Koa.Middleware {
  return async (ctx, next) => {
    const path = ctx.path;

    if (!MUTATING_METHODS.has(ctx.method)) {
      await next();
      return;
    }

    if (IDEMPOTENCY_SKIP_PATHS.some((skip) => path === skip || path.startsWith(skip))) {
      await next();
      return;
    }

    // Extract user ID from JWT; if none present, derive a surrogate from client identity
    // so that unauthenticated write endpoints (login, refresh) still enforce idempotency.
    let userId = ctx.state?.user
      ? BigInt(ctx.state.user.id as string | number | bigint)
      : extractUserIdFromToken(ctx);

    if (!userId) {
      // Build surrogate scope key from route + client IP + device fingerprint
      const ip = ctx.get('X-Forwarded-For')?.split(',')[0]?.trim() || ctx.ip || 'unknown';
      const fingerprint = ctx.get('X-Device-Fingerprint') || '';
      const surrogateInput = `anon:${path}:${ip}:${fingerprint}`;
      // Use first 8 bytes of SHA-256 as a deterministic bigint surrogate
      const surrogateHash = crypto.createHash('sha256').update(surrogateInput).digest();
      userId = surrogateHash.readBigUInt64BE(0);
    }

    const idempotencyKey = ctx.get('Idempotency-Key');
    if (!idempotencyKey) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Idempotency-Key header is required', 400);
    }

    if (!UUID_REGEX.test(idempotencyKey)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Idempotency-Key must be a valid UUIDv4', 400);
    }

    const requestHash = computeRequestHash(ctx.method, path, ctx.request.body);

    const { exists, response } = await checkIdempotency(
      idempotencyKey,
      userId,
      path,
      requestHash,
    );

    if (exists && response) {
      ctx.status = response.status;
      ctx.body = response.body;
      return;
    }

    await next();

    // Save idempotency after successful handler
    if (ctx.status >= 200 && ctx.status < 300) {
      await saveIdempotency(
        idempotencyKey,
        userId,
        path,
        requestHash,
        ctx.status,
        ctx.body,
      );
    }
  };
}
