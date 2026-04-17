import { Knex } from 'knex';
import bcrypt from 'bcrypt';
import { config } from '../../config';
import { appendAuditEvent, setAuditKnex, resetAuditKnex } from '../../audit/chain';

/**
 * Seed default users for all roles.
 * Idempotent — skips any username that already exists.
 *
 * Passwords are read from environment variables so they can be overridden in
 * docker-compose.yml or a .env file without touching the code.  Defaults are
 * intentionally weak demo values; change them before exposing the app.
 *
 * Default credentials (also shown in README):
 *
 *   username       role            default password
 *   ─────────────  ──────────────  ─────────────────────────
 *   admin          administrator   Admin@harborstone1
 *   ops_user       operations      Ops@harborstone1
 *   merchant_user  merchant        Merchant@harborstone1
 *   agent_user     regular_user    Agent@harborstone1
 */

interface SeedUser {
  username: string;
  passwordEnvVar: string;
  defaultPassword: string;
  role: 'administrator' | 'operations' | 'merchant' | 'regular_user';
  mustChangePassword: 0 | 1;
}

const SEED_USERS: SeedUser[] = [
  {
    username: 'admin',
    passwordEnvVar: 'SEED_ADMIN_PASSWORD',
    defaultPassword: 'Admin@harborstone1',
    role: 'administrator',
    mustChangePassword: 1,
  },
  {
    username: 'ops_user',
    passwordEnvVar: 'SEED_OPS_PASSWORD',
    defaultPassword: 'Ops@harborstone1',
    role: 'operations',
    mustChangePassword: 0,
  },
  {
    username: 'merchant_user',
    passwordEnvVar: 'SEED_MERCHANT_PASSWORD',
    defaultPassword: 'Merchant@harborstone1',
    role: 'merchant',
    mustChangePassword: 0,
  },
  {
    username: 'agent_user',
    passwordEnvVar: 'SEED_AGENT_PASSWORD',
    defaultPassword: 'Agent@harborstone1',
    role: 'regular_user',
    mustChangePassword: 0,
  },
];

export async function seed(knex: Knex): Promise<void> {
  setAuditKnex(knex);

  try {
    // Ensure Main Office exists
    let officeId: number;
    const existingOffice = await knex('offices').where({ code: 'MAIN' }).first();
    if (existingOffice) {
      officeId = existingOffice.id;
    } else {
      const [id] = await knex('offices').insert({
        name: 'Main Office',
        code: 'MAIN',
        active: 1,
      });
      officeId = id;
    }

    const now = new Date();

    for (const u of SEED_USERS) {
      const existing = await knex('users').where({ username: u.username }).first();
      if (existing) continue;

      const password = process.env[u.passwordEnvVar] || u.defaultPassword;
      const passwordHash = await bcrypt.hash(password, config.bcrypt.cost);

      const [userId] = await knex('users').insert({
        username: u.username,
        password_hash: passwordHash,
        role: u.role,
        office_id: officeId,
        status: 'active',
        failed_login_count: 0,
        must_change_password: u.mustChangePassword,
        created_at: now,
        updated_at: now,
      });

      // Record initial password in history so it cannot be reused on first change
      await knex('password_history').insert({
        user_id: userId.toString(),
        password_hash: passwordHash,
        created_at: now,
      });

      await appendAuditEvent({
        actor_id: null,
        actor_role: 'system',
        action: 'system.bootstrap_user',
        entity_type: 'user',
        entity_id: String(userId),
        after_json: { username: u.username, role: u.role, office_code: 'MAIN' },
      });
    }
  } finally {
    resetAuditKnex();
  }
}
