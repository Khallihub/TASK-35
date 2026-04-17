import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { AppError, ErrorCodes } from '../errors';

export type UserRole = 'regular_user' | 'merchant' | 'operations' | 'administrator';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  officeId: string | null;
  jti: string;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: 'refresh';
}

export function generateJti(): string {
  return uuidv4();
}

export function signAccessToken(payload: Omit<AccessTokenPayload, 'type'>, jti: string): string {
  const tokenPayload: AccessTokenPayload = {
    ...payload,
    jti,
    type: 'access',
  };
  return jwt.sign(tokenPayload as unknown as Record<string, unknown>, config.jwt.secret, {
    expiresIn: config.jwt.accessTtlMinutes * 60,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
    return decoded as AccessTokenPayload;
  } catch {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 'Invalid or expired access token', 401);
  }
}

export function signRefreshToken(jti: string, userId: bigint): string {
  const payload: RefreshTokenPayload = {
    sub: userId.toString(),
    jti,
    type: 'refresh',
  };
  return jwt.sign(payload as unknown as Record<string, unknown>, config.jwt.secret, {
    expiresIn: 4 * 60 * 60, // 4 hours in seconds
    algorithm: 'HS256',
  });
}

export function verifyRefreshToken(token: string): { sub: string; jti: string } {
  try {
    const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] }) as RefreshTokenPayload;
    if (decoded.type !== 'refresh') {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 'Invalid refresh token', 401);
    }
    return { sub: decoded.sub, jti: decoded.jti };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(ErrorCodes.UNAUTHORIZED, 'Invalid or expired refresh token', 401);
  }
}
