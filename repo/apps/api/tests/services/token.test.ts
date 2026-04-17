import jwt from 'jsonwebtoken';
import {
  generateJti,
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../src/services/token';
import { config } from '../../src/config';

/**
 * Token service coverage — JWT minting + verification is a load-bearing
 * security primitive that had no dedicated test file.
 *
 * Covers:
 *   - access tokens round-trip sub/role/officeId/jti and type='access'
 *   - refresh tokens round-trip sub + jti and reject type mismatch
 *   - tampered tokens are rejected with 401 AppError (not silently decoded)
 *   - expired tokens are rejected
 *   - generateJti returns a plausibly unique UUIDv4
 */

describe('generateJti', () => {
  it('returns a uuid-shaped string, unique across calls', () => {
    const a = generateJti();
    const b = generateJti();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe('signAccessToken + verifyAccessToken', () => {
  it('round-trips sub/role/officeId/jti with type=access', () => {
    const jti = generateJti();
    const token = signAccessToken(
      { sub: '42', role: 'operations', officeId: '7', jti },
      jti,
    );
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe('42');
    expect(decoded.role).toBe('operations');
    expect(decoded.officeId).toBe('7');
    expect(decoded.jti).toBe(jti);
    expect(decoded.type).toBe('access');
  });

  it('rejects tokens signed with a different secret', () => {
    const jti = generateJti();
    const fake = jwt.sign({ sub: '1', role: 'administrator', officeId: null, jti, type: 'access' }, 'wrong-secret', {
      algorithm: 'HS256',
    });
    expect(() => verifyAccessToken(fake)).toThrow(/invalid/i);
  });

  it('rejects tokens that have expired', () => {
    const jti = generateJti();
    const expired = jwt.sign(
      { sub: '1', role: 'administrator', officeId: null, jti, type: 'access', exp: Math.floor(Date.now() / 1000) - 60 },
      config.jwt.secret,
      { algorithm: 'HS256' },
    );
    expect(() => verifyAccessToken(expired)).toThrow(/invalid|expired/i);
  });

  it('rejects non-JWT strings', () => {
    expect(() => verifyAccessToken('not-a-token')).toThrow(/invalid|expired/i);
  });
});

describe('signRefreshToken + verifyRefreshToken', () => {
  it('round-trips sub + jti', () => {
    const jti = generateJti();
    const token = signRefreshToken(jti, BigInt(99));
    const decoded = verifyRefreshToken(token);
    expect(decoded.sub).toBe('99');
    expect(decoded.jti).toBe(jti);
  });

  it('rejects a refresh token whose type field is wrong', () => {
    // Craft a token whose payload.type is 'access' — the refresh verifier
    // must reject it even though it is signed correctly.
    const jti = generateJti();
    const wrongType = jwt.sign({ sub: '1', jti, type: 'access' }, config.jwt.secret, {
      algorithm: 'HS256',
      expiresIn: 60,
    });
    expect(() => verifyRefreshToken(wrongType)).toThrow(/invalid/i);
  });

  it('rejects tampered refresh tokens', () => {
    const jti = generateJti();
    const good = signRefreshToken(jti, BigInt(1));
    // Flip a character to break the signature.
    const tampered = good.slice(0, -1) + (good.slice(-1) === 'a' ? 'b' : 'a');
    expect(() => verifyRefreshToken(tampered)).toThrow(/invalid|expired/i);
  });
});
