import pino from 'pino';

/**
 * Create a test logger that captures output as strings.
 * We use pino with a custom destination stream.
 */
function createTestLogger() {
  const lines: string[] = [];

  const stream = {
    write(msg: string) {
      lines.push(msg);
    },
  };

  const testLogger = pino(
    {
      level: 'trace',
      redact: {
        paths: [
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
          '*.password',
          '*.password_hash',
          '*.token',
          '*.authorization',
          '*.secret',
          '*.hash',
          '*.cookie',
          '*.jwt',
          '*.nonce',
        ],
        censor: '[REDACTED]',
      },
    },
    stream as NodeJS.WritableStream,
  );

  return { logger: testLogger, lines };
}

describe('Logger redaction', () => {
  test('password field is redacted — captured log does NOT contain the secret value', () => {
    const { logger, lines } = createTestLogger();

    logger.info({ password: 'secret123' }, 'test message');

    expect(lines.length).toBeGreaterThan(0);
    const output = lines.join('');
    expect(output).not.toContain('secret123');
    expect(output).toContain('[REDACTED]');
  });

  test('authorization field is redacted — captured log does NOT contain the Bearer token', () => {
    const { logger, lines } = createTestLogger();

    logger.info({ authorization: 'Bearer my-token-value' }, 'test message');

    expect(lines.length).toBeGreaterThan(0);
    const output = lines.join('');
    expect(output).not.toContain('Bearer my-token-value');
    expect(output).toContain('[REDACTED]');
  });

  test('nested password field is redacted — captured log does NOT contain the nested value', () => {
    const { logger, lines } = createTestLogger();

    logger.info({ user: { password: 'nested-secret-x' } }, 'test message');

    expect(lines.length).toBeGreaterThan(0);
    const output = lines.join('');
    expect(output).not.toContain('nested-secret-x');
    expect(output).toContain('[REDACTED]');
  });

  test('non-sensitive fields are NOT redacted', () => {
    const { logger, lines } = createTestLogger();

    logger.info({ username: 'john_doe', email: 'john@example.com' }, 'test message');

    expect(lines.length).toBeGreaterThan(0);
    const output = lines.join('');
    expect(output).toContain('john_doe');
    expect(output).toContain('john@example.com');
  });

  test('token field is redacted', () => {
    const { logger, lines } = createTestLogger();

    logger.info({ token: 'my-jwt-token-value' }, 'test message');

    const output = lines.join('');
    expect(output).not.toContain('my-jwt-token-value');
    expect(output).toContain('[REDACTED]');
  });
});
