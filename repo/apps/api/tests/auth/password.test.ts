import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import {
  validatePasswordPolicy,
  hashPassword,
  comparePassword,
  checkPasswordHistory,
  savePasswordHistory,
} from '../../src/services/password';
import { Knex as KnexType } from 'knex';

describe('password service', () => {
  describe('validatePasswordPolicy', () => {
    it('rejects passwords shorter than 12 characters', () => {
      const result = validatePasswordPolicy('Ab1!');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('12'))).toBe(true);
    });

    it('rejects passwords without uppercase', () => {
      const result = validatePasswordPolicy('abcdefghij1!');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('uppercase'))).toBe(true);
    });

    it('rejects passwords without lowercase', () => {
      const result = validatePasswordPolicy('ABCDEFGHIJ1!');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('lowercase'))).toBe(true);
    });

    it('rejects passwords without digit', () => {
      const result = validatePasswordPolicy('Abcdefghijk!');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('digit'))).toBe(true);
    });

    it('rejects passwords without symbol', () => {
      const result = validatePasswordPolicy('Abcdefghijk1');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('symbol'))).toBe(true);
    });

    it('accepts a valid password', () => {
      const result = validatePasswordPolicy('Admin@123456!');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('hashPassword + comparePassword round-trip', () => {
    it('hashes and verifies a password correctly', async () => {
      const plain = 'MyP@ssw0rdXYZ';
      const hash = await hashPassword(plain);
      expect(hash).not.toBe(plain);
      expect(hash.startsWith('$2b$')).toBe(true);

      const match = await comparePassword(plain, hash);
      expect(match).toBe(true);

      const noMatch = await comparePassword('WrongPassword1!', hash);
      expect(noMatch).toBe(false);
    });
  });

  describe('checkPasswordHistory', () => {
    let knex: KnexType;
    let userId: bigint;

    beforeEach(async () => {
      knex = createTestKnex();
      await runTestMigrations(knex);

      const now = new Date();
      const [id] = await knex('users').insert({
        username: 'historyuser',
        password_hash: 'placeholder',
        role: 'regular_user',
        status: 'active',
        failed_login_count: 0,
        must_change_password: 0,
        created_at: now,
        updated_at: now,
      });
      userId = BigInt(id);
    });

    afterEach(async () => {
      await dropTestTables(knex);
      await knex.destroy();
    });

    it('returns false when no history exists', async () => {
      const result = await checkPasswordHistory(userId, 'NewPassword1!', knex);
      expect(result).toBe(false);
    });

    it('returns false for 4 unique passwords and the 5th is new', async () => {
      const passwords = ['Password1!aa', 'Password2!bb', 'Password3!cc', 'Password4!dd'];
      for (const pw of passwords) {
        const hash = await hashPassword(pw);
        await savePasswordHistory(userId, hash, knex);
      }
      const result = await checkPasswordHistory(userId, 'BrandNew5!ee', knex);
      expect(result).toBe(false);
    });

    it('returns true (reject) when the password matches one of the last 5', async () => {
      const reusedPassword = 'Reused@password1';
      const passwords = [reusedPassword, 'Password2!bb', 'Password3!cc', 'Password4!dd', 'Password5!ee'];
      for (const pw of passwords) {
        const hash = await hashPassword(pw);
        await savePasswordHistory(userId, hash, knex);
      }
      const result = await checkPasswordHistory(userId, reusedPassword, knex);
      expect(result).toBe(true);
    });
  });
});
