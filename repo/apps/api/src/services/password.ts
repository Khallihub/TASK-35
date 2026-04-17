import bcrypt from 'bcrypt';
import { Knex as KnexType } from 'knex';
import { config } from '../config';
import defaultKnex from '../db/knex';

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

const SYMBOL_SET = '!@#$%^&*()_+-=[]{};\':,.?/\\|~';

export function validatePasswordPolicy(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 12) {
    errors.push('Password must be at least 12 characters long.');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter.');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter.');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one digit.');
  }

  const symbolRegex = /[!@#$%^&*()_+\-=\[\]{};':,.?/\\|~]/;
  if (!symbolRegex.test(password)) {
    errors.push(`Password must contain at least one symbol from: ${SYMBOL_SET}`);
  }

  return { valid: errors.length === 0, errors };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.bcrypt.cost);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Returns true if newHash matches ANY of the last 5 hashes for the user (reject if true).
 */
export async function checkPasswordHistory(
  userId: bigint,
  newPlainPassword: string,
  knexInstance: KnexType = defaultKnex,
): Promise<boolean> {
  const rows = await knexInstance('password_history')
    .where({ user_id: userId.toString() })
    .orderBy('created_at', 'desc')
    .limit(5)
    .select<Array<{ password_hash: string }>>(['password_hash']);

  for (const row of rows) {
    const matches = await bcrypt.compare(newPlainPassword, row.password_hash);
    if (matches) {
      return true;
    }
  }
  return false;
}

/**
 * Inserts a new password history row.
 * If user already has >= 5 entries, delete the oldest first.
 */
export async function savePasswordHistory(
  userId: bigint,
  hash: string,
  knexInstance: KnexType = defaultKnex,
): Promise<void> {
  const count = await knexInstance('password_history')
    .where({ user_id: userId.toString() })
    .count<Array<{ 'count(*)': number }>>('* as count')
    .first();

  const rowCount = count ? Number(count['count(*)']) : 0;

  if (rowCount >= 5) {
    // Delete oldest
    const oldest = await knexInstance('password_history')
      .where({ user_id: userId.toString() })
      .orderBy('created_at', 'asc')
      .first<{ id: number }>();

    if (oldest) {
      await knexInstance('password_history').where({ id: oldest.id }).delete();
    }
  }

  await knexInstance('password_history').insert({
    user_id: userId.toString(),
    password_hash: hash,
    created_at: new Date(),
  });
}
