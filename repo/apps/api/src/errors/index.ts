export const ErrorCodes = {
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  RATE_LIMITED: 'RATE_LIMITED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  NONCE_INVALID: 'NONCE_INVALID',
  NONCE_EXPIRED: 'NONCE_EXPIRED',
  ATTACHMENT_REJECTED: 'ATTACHMENT_REJECTED',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    // Restore prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
