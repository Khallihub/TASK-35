import crypto from 'crypto';
import { config } from '../config';

const CAPTCHA_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface CaptchaChallenge {
  question: string;
  answer: number;
  token: string;
}

function generateHmac(data: string): string {
  return crypto.createHmac('sha256', config.jwt.secret).update(data).digest('hex');
}

export function generateChallenge(): CaptchaChallenge {
  const a = Math.floor(Math.random() * 20) + 1;
  const b = Math.floor(Math.random() * 20) + 1;
  const answer = a + b;
  const expiresAt = Date.now() + CAPTCHA_TTL_MS;
  const token = generateHmac(`${answer}:${expiresAt}`);

  return {
    question: `What is ${a} + ${b}?`,
    answer,
    token: `${token}:${expiresAt}`,
  };
}

export function verifyChallenge(token: string, answer: number): boolean {
  const parts = token.split(':');
  if (parts.length !== 2) {
    return false;
  }

  const [hmac, expiresAtStr] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);

  if (isNaN(expiresAt) || Date.now() > expiresAt) {
    return false;
  }

  const expectedHmac = generateHmac(`${answer}:${expiresAt}`);
  return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expectedHmac, 'hex'));
}
