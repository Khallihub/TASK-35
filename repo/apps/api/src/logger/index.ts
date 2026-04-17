import pino from 'pino';
import { config } from '../config';

const REDACT_PATHS = [
  'password',
  'password_hash',
  'hash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'secret',
  'jwt',
  'nonce',
  'x-csrf-token',
  'idempotency_key',
  // nested variants
  '*.password',
  '*.password_hash',
  '*.token',
  '*.authorization',
  '*.secret',
  '*.hash',
  '*.cookie',
  '*.jwt',
  '*.nonce',
];

export const logger = pino({
  level: config.log.level,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  ...(config.log.pretty ? { transport: { target: 'pino-pretty' } } : {}),
});
