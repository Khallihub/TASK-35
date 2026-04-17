import Router from 'koa-router';
import { AppError, ErrorCodes } from '../errors';
import { requireAuth } from '../middleware/auth';
import { requireConsent } from '../middleware/auth';
import { hashPassword, comparePassword, validatePasswordPolicy, checkPasswordHistory, savePasswordHistory } from '../services/password';
import { createSession, revokeSession, revokeAllUserSessions, getActiveSession } from '../services/session';
import { verifyRefreshToken } from '../services/token';
import { checkLockout, recordFailedLogin, recordSuccessfulLogin } from '../services/lockout';
import { generateNonce, consumeNonce } from '../services/nonce';
import { getLatestConsentVersion, hasUserAcceptedLatest, recordConsent } from '../services/consent';
import { verifyChallenge } from '../services/captcha';
import { checkRateLimit, recordFailedRequest } from '../services/rateLimit';
import { appendAuditEvent } from '../audit';
import defaultKnex from '../db/knex';
import { systemClock } from '../clock';
import { checkBlacklist } from '../services/risk';
import { generateCsrfToken } from '../middleware/csrf';

const router = new Router({ prefix: '/api/v1/auth' });

// Failed-login IP throttle per PRD §8.2: 30 failures per IP per 15 min
const IP_FAILED_LOGIN_MAX = 30;
const IP_FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;

// Pre-auth burst throttle — protects the nonce + login handler from raw
// request floods independent of credential correctness. Separate from the
// failed-login throttle so that legitimate successful logins from a shared
// IP (office NAT etc.) do not drain the failed-attempt budget.
const IP_BURST_MAX = 120;
const IP_BURST_WINDOW_MS = 60 * 1000;

const ALLOWED_NONCE_PURPOSES = ['change_password', 'publish', 'approve', 'role_change', 'purge'];
// 'login' purpose is served by the public /nonce/login endpoint below

function getClientIp(ctx: Router.RouterContext): string {
  const forwarded = ctx.get('X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  return ctx.ip ?? 'unknown';
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: 'regular_user' | 'merchant' | 'operations' | 'administrator';
  office_id: number | null;
  status: string;
  failed_login_count: number;
  locked_until: Date | string | null;
  must_change_password: number;
  consent_version_accepted: number | null;
}

// GET /api/v1/auth/nonce/login — public endpoint, no auth required
router.get('/nonce/login', async (ctx) => {
  const nonce = await generateNonce('login', null);
  ctx.status = 200;
  ctx.body = { ok: true, data: { nonce } };
});

// POST /api/v1/auth/login
router.post('/login', async (ctx) => {
  const body = ctx.request.body as {
    username?: string;
    password?: string;
    captchaToken?: string;
    captchaAnswer?: number;
    nonce?: string;
  };

  if (!body.username || !body.password) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'username and password are required', 400);
  }

  // Consume login nonce before credential verification (replay protection)
  if (!body.nonce) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'nonce is required for login', 400);
  }
  await consumeNonce(body.nonce, 'login');

  const ip = getClientIp(ctx);

  // Check IP blacklist before any credential work
  const isIpBlacklisted = await checkBlacklist('ip', ip);
  if (isIpBlacklisted) {
    throw new AppError(ErrorCodes.ACCOUNT_LOCKED, 'Access denied', 401);
  }

  // Two separate throttles per PRD §8.2:
  //   1) Pre-auth burst throttle: protects against request floods (counts every attempt)
  //   2) Failed-login throttle: only increments on credential failures (PRD-mandated 30/15min)
  const ipBurstKey = `login_burst:${ip}`;
  const ipFailKey = `login_fail:${ip}`;

  const burstCheck = checkRateLimit(ipBurstKey, IP_BURST_MAX, IP_BURST_WINDOW_MS);
  if (!burstCheck.allowed) {
    const retryAfterSecs = Math.ceil(burstCheck.retryAfterMs / 1000);
    ctx.set('Retry-After', String(retryAfterSecs));
    throw new AppError(ErrorCodes.RATE_LIMITED, 'Too many requests', 429);
  }
  // Record this attempt against the burst bucket (counts all attempts)
  recordFailedRequest(ipBurstKey, IP_BURST_WINDOW_MS);

  const failCheck = checkRateLimit(ipFailKey, IP_FAILED_LOGIN_MAX, IP_FAILED_LOGIN_WINDOW_MS);
  if (!failCheck.allowed) {
    const retryAfterSecs = Math.ceil(failCheck.retryAfterMs / 1000);
    ctx.set('Retry-After', String(retryAfterSecs));
    throw new AppError(ErrorCodes.RATE_LIMITED, 'Too many failed login attempts', 429);
  }

  // Find user by username (case-insensitive)
  const user = await defaultKnex('users')
    .whereRaw('LOWER(username) = ?', [body.username.toLowerCase()])
    .first<UserRow | undefined>();

  if (!user) {
    // Generic error to prevent username enumeration
    recordFailedRequest(ipFailKey, IP_FAILED_LOGIN_WINDOW_MS);
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 'Invalid credentials', 401);
  }

  // Reject disabled accounts — only administrator can restore (PRD §8.12)
  if (user.status === 'disabled') {
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 'Invalid credentials', 401);
  }

  // Check lockout — use generic error to prevent account state disclosure (PRD §8.2)
  const lockStatus = await checkLockout(BigInt(user.id));
  if (lockStatus.blocked) {
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 'Invalid credentials', 401);
  }

  // Captcha check
  let captchaSettingEnabled = false;
  try {
    const setting = await defaultKnex('settings').where({ key: 'offline_captcha.enabled' }).first<{ value: string } | undefined>();
    captchaSettingEnabled = setting?.value === 'true' || setting?.value === '1';
  } catch {
    // ignore
  }

  if (captchaSettingEnabled && user.failed_login_count >= 5) {
    if (!body.captchaToken || body.captchaAnswer === undefined) {
      throw new AppError(ErrorCodes.CAPTCHA_REQUIRED, 'CAPTCHA is required', 401);
    }
    const captchaValid = verifyChallenge(body.captchaToken, Number(body.captchaAnswer));
    if (!captchaValid) {
      throw new AppError(ErrorCodes.CAPTCHA_REQUIRED, 'Invalid CAPTCHA answer', 401);
    }
  }

  // Compare password
  const passwordMatch = await comparePassword(body.password, user.password_hash);
  if (!passwordMatch) {
    await recordFailedLogin(BigInt(user.id));
    recordFailedRequest(ipFailKey, IP_FAILED_LOGIN_WINDOW_MS);
    // Generic error — never disclose lock state or which credential was wrong (PRD §8.2)
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 'Invalid credentials', 401);
  }

  // Successful login
  await recordSuccessfulLogin(BigInt(user.id));

  // Check blacklist (user, device) — generic error to avoid state disclosure (PRD §8.2)
  const isUserBlacklisted = await checkBlacklist('user', String(user.id));
  if (isUserBlacklisted) {
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 'Invalid credentials', 401);
  }

  const deviceFingerprint = ctx.get('X-Device-Fingerprint') || undefined;
  if (deviceFingerprint) {
    const isDeviceBlacklisted = await checkBlacklist('device', deviceFingerprint);
    if (isDeviceBlacklisted) {
      throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 'Invalid credentials', 401);
    }
  }

  // Check consent
  const requiresConsent = !(await hasUserAcceptedLatest(BigInt(user.id)));

  // Create session + audit atomically in one transaction
  let accessToken!: string;
  let refreshToken!: string;
  let sessionJti!: string;
  await defaultKnex.transaction(async (trx) => {
    const sessionResult = await createSession({
      userId: BigInt(user.id),
      role: user.role,
      officeId: user.office_id ? BigInt(user.office_id) : null,
      ip,
      userAgent: ctx.get('User-Agent') || undefined,
      deviceFingerprint,
    }, trx);
    accessToken = sessionResult.accessToken;
    refreshToken = sessionResult.refreshToken;
    sessionJti = sessionResult.session.jti;

    // Audit inside the transaction for atomicity
    await appendAuditEvent({
      actor_id: user.id,
      actor_role: user.role,
      action: 'auth.login',
      entity_type: 'user',
      entity_id: String(user.id),
      ip,
    }, systemClock, trx);
  });

  // ── Automatic risk-score anomaly detection (non-blocking) ──────────
  try {
    const { applyPenalty, getOrCreateProfile } = await import('../services/risk');
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Multi-device: >2 distinct fingerprints within 10 min
    if (deviceFingerprint) {
      const recentFingerprints = await defaultKnex('sessions')
        .where('user_id', user.id)
        .where('issued_at', '>=', tenMinAgo)
        .whereNotNull('device_fingerprint')
        .distinct('device_fingerprint')
        .pluck('device_fingerprint') as string[];

      if (recentFingerprints.length > 2) {
        await getOrCreateProfile(user.id);
        await applyPenalty(user.id, 'multi_device_login', { fingerprints: recentFingerprints.length, ip });
      }
    }

    // Abnormal IP pattern: >5 distinct IPs in 24h
    const recentIps = await defaultKnex('sessions')
      .where('user_id', user.id)
      .where('issued_at', '>=', twentyFourHoursAgo)
      .whereNotNull('ip')
      .distinct('ip')
      .pluck('ip') as string[];

    if (recentIps.length > 5) {
      await getOrCreateProfile(user.id);
      await applyPenalty(user.id, 'abnormal_ip_pattern', { distinctIps: recentIps.length });
    }
  } catch {
    // Risk detection is non-blocking — log failures but don't break login
  }

  // Issue CSRF token so the client can make mutating requests immediately
  ctx.set('X-CSRF-Token', generateCsrfToken(sessionJti));

  ctx.status = 200;
  ctx.body = {
    ok: true,
    data: {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        officeId: user.office_id,
      },
      requiresConsent,
      mustChangePassword: user.must_change_password === 1,
    },
  };
});

// POST /api/v1/auth/refresh
router.post('/refresh', async (ctx) => {
  const body = ctx.request.body as { refreshToken?: string };

  if (!body.refreshToken) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'refreshToken is required', 400);
  }

  const { sub, jti } = verifyRefreshToken(body.refreshToken);

  // Find session by jti
  const session = await getActiveSession(jti);
  if (!session) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 'Session not found or expired', 401);
  }

  // Enforce device fingerprint binding (PRD §8.1: refresh token bound to device_fingerprint)
  const refreshFingerprint = ctx.get('X-Device-Fingerprint') || undefined;
  if (session.device_fingerprint && refreshFingerprint !== session.device_fingerprint) {
    await revokeSession(jti, 'fingerprint_mismatch');
    throw new AppError(ErrorCodes.UNAUTHORIZED, 'Session not found or expired', 401);
  }

  // Get the user
  const user = await defaultKnex('users')
    .where({ id: sub })
    .first<UserRow | undefined>();

  if (!user) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 'User not found', 401);
  }

  // Reject disabled/locked accounts on refresh (PRD §8.12)
  if (user.status === 'disabled' || user.status === 'locked') {
    await revokeSession(jti, 'account_' + user.status);
    throw new AppError(ErrorCodes.UNAUTHORIZED, 'Session not found or expired', 401);
  }

  // Revoke old session
  await revokeSession(jti, 'refreshed');

  // Create new session — preserve device fingerprint binding from the old session
  const newSession = await createSession({
    userId: BigInt(user.id),
    role: user.role,
    officeId: user.office_id ? BigInt(user.office_id) : null,
    ip: session.ip ?? undefined,
    userAgent: session.user_agent ?? undefined,
    deviceFingerprint: session.device_fingerprint ?? undefined,
  });

  // Issue CSRF token for the new session
  ctx.set('X-CSRF-Token', generateCsrfToken(newSession.session.jti));

  ctx.status = 200;
  ctx.body = { ok: true, data: { accessToken: newSession.accessToken, refreshToken: newSession.refreshToken } };
});

// POST /api/v1/auth/logout
router.post('/logout', requireAuth(), async (ctx) => {
  const { jti, id, role } = ctx.state.user;

  // Revoke session + audit atomically
  await defaultKnex.transaction(async (trx) => {
    await revokeSession(jti, 'logout', trx);

    await appendAuditEvent({
      actor_id: Number(id),
      actor_role: role,
      action: 'auth.logout',
      entity_type: 'user',
      entity_id: id.toString(),
      ip: getClientIp(ctx),
    }, systemClock, trx);
  });

  ctx.status = 200;
  ctx.body = { ok: true };
});

// POST /api/v1/auth/consent
router.post('/consent', requireAuth(), async (ctx) => {
  const body = ctx.request.body as { versionId?: number };

  if (!body.versionId) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'versionId is required', 400);
  }

  const { id, role } = ctx.state.user;
  const ip = getClientIp(ctx);

  // Verify the consent version exists
  const version = await defaultKnex('consent_versions')
    .where({ id: body.versionId })
    .first();

  if (!version) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Consent version not found', 404);
  }

  // Record consent + audit atomically
  await defaultKnex.transaction(async (trx) => {
    await recordConsent(id, BigInt(body.versionId!), ip, trx);

    await appendAuditEvent({
      actor_id: Number(id),
      actor_role: role,
      action: 'auth.consent_accepted',
      entity_type: 'consent_version',
      entity_id: String(body.versionId),
      ip,
    }, systemClock, trx);
  });

  ctx.status = 200;
  ctx.body = { ok: true };
});

// POST /api/v1/auth/change-password
router.post('/change-password', requireAuth(), requireConsent(), async (ctx) => {
  const body = ctx.request.body as {
    currentPassword?: string;
    newPassword?: string;
    nonce?: string;
  };

  if (!body.currentPassword || !body.newPassword || !body.nonce) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'currentPassword, newPassword, and nonce are required', 400);
  }

  const { id, role, jti } = ctx.state.user;

  // Consume nonce (actor-bound to the authenticated user)
  await consumeNonce(body.nonce, 'change_password', Number(id));

  // Load user
  const user = await defaultKnex('users').where({ id: id.toString() }).first<UserRow>();
  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }

  // Verify current password
  const currentMatch = await comparePassword(body.currentPassword, user.password_hash);
  if (!currentMatch) {
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 'Current password is incorrect', 401);
  }

  // Validate new password policy
  const { valid, errors } = validatePasswordPolicy(body.newPassword);
  if (!valid) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, errors.join(' '), 400, { errors });
  }

  // Check password history
  const isReuse = await checkPasswordHistory(id, body.newPassword);
  if (isReuse) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Cannot reuse a recent password', 400);
  }

  // Hash new password
  const newHash = await hashPassword(body.newPassword);

  // Atomic: update user + save history + revoke sessions + new session + audit
  const now = systemClock.now();
  let accessToken!: string;
  let refreshToken!: string;
  await defaultKnex.transaction(async (trx) => {
    await trx('users').where({ id: id.toString() }).update({
      password_hash: newHash,
      last_password_change_at: now,
      must_change_password: 0,
      updated_at: now,
    });

    await savePasswordHistory(id, newHash, trx);
    await revokeAllUserSessions(id, 'password_changed', trx);

    const sess = await createSession({
      userId: id,
      role,
      officeId: user.office_id ? BigInt(user.office_id) : null,
      ip: getClientIp(ctx),
      userAgent: ctx.get('User-Agent') || undefined,
    }, trx);
    accessToken = sess.accessToken;
    refreshToken = sess.refreshToken;

    await appendAuditEvent({
      actor_id: Number(id),
      actor_role: role,
      action: 'auth.password_changed',
      entity_type: 'user',
      entity_id: id.toString(),
      ip: getClientIp(ctx),
    }, systemClock, trx);
  });

  ctx.status = 200;
  ctx.body = { ok: true, data: { accessToken, refreshToken } };
});

// GET /api/v1/auth/nonce/:purpose
router.get('/nonce/:purpose', requireAuth(), async (ctx) => {
  const purpose = ctx.params.purpose;

  if (!ALLOWED_NONCE_PURPOSES.includes(purpose)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Invalid nonce purpose. Allowed: ${ALLOWED_NONCE_PURPOSES.join(', ')}`,
      400,
    );
  }

  const { id } = ctx.state.user;
  const nonce = await generateNonce(purpose, id);

  ctx.status = 200;
  ctx.body = { ok: true, data: { nonce } };
});

// GET /api/v1/auth/me
router.get('/me', requireAuth(), requireConsent(), async (ctx) => {
  const { id } = ctx.state.user;

  const user = await defaultKnex('users')
    .where({ id: id.toString() })
    .first<Omit<UserRow, 'password_hash'> & { password_hash?: string }>();

  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }

  // Remove password_hash from response
  const { password_hash, ...safeUser } = user;
  void password_hash; // explicitly ignore

  ctx.status = 200;
  ctx.body = { ok: true, data: safeUser };
});

// GET /api/v1/auth/consent-version
router.get('/consent-version', async (ctx) => {
  const version = await getLatestConsentVersion();
  if (!version) {
    ctx.status = 200;
    ctx.body = {
      ok: true,
      data: {
        id: 0,
        version: '1.0',
        body_md: 'By using HarborStone Listings Operations Suite, you agree to our terms of service and privacy policy. This platform is for authorized personnel only. Unauthorized use is prohibited and may be subject to legal action.',
      },
    };
    return;
  }
  ctx.status = 200;
  ctx.body = { ok: true, data: { id: version.id, version: version.version, body_md: version.body_md } };
});

// GET /api/v1/auth/captcha-challenge
router.get('/captcha-challenge', async (ctx) => {
  const { generateChallenge } = await import('../services/captcha');
  const challenge = generateChallenge();
  ctx.status = 200;
  ctx.body = { ok: true, data: { question: challenge.question, token: challenge.token } };
});

export default router;
