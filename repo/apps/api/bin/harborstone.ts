#!/usr/bin/env node
import readline from 'readline';
import knex from '../src/db/knex';
import { hashPassword, validatePasswordPolicy } from '../src/services/password';
import { revokeAllUserSessions } from '../src/services/session';
import { verifyChain } from '../src/audit/chain';
import { appendAuditEvent } from '../src/audit';
import { systemClock } from '../src/clock';
import {
  listBlacklist,
  addBlacklist,
  removeBlacklist,
  getRiskProfile,
  getOrCreateProfile,
} from '../src/services/risk';

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

async function bootstrapAdmin(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const username = (await prompt(rl, 'Admin username [admin]: ')).trim() || 'admin';
    const password = await prompt(rl, 'Admin password: ');

    const { valid, errors } = validatePasswordPolicy(password);
    if (!valid) {
      console.error('Password does not meet policy requirements:');
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }

    const existing = await knex('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first();
    if (existing) {
      console.log(`User '${username}' already exists. Skipping.`);
      return;
    }

    // Create or find main office
    let officeId: number;
    const existingOffice = await knex('offices').where({ code: 'MAIN' }).first();
    if (existingOffice) {
      officeId = existingOffice.id;
    } else {
      const [id] = await knex('offices').insert({ name: 'Main Office', code: 'MAIN', active: 1 });
      officeId = id;
    }

    const hash = await hashPassword(password);
    const now = systemClock.now();

    const [userId] = await knex('users').insert({
      username: username.toLowerCase(),
      password_hash: hash,
      role: 'administrator',
      office_id: officeId,
      status: 'active',
      failed_login_count: 0,
      must_change_password: 1,
      created_at: now,
      updated_at: now,
    });

    await appendAuditEvent({
      actor_id: null,
      actor_role: 'system',
      action: 'system.bootstrap_admin',
      entity_type: 'user',
      entity_id: String(userId),
      after_json: { username, role: 'administrator', office_code: 'MAIN' },
    });

    console.log(`Admin user '${username}' created successfully (id=${userId}).`);
    console.log('Note: User must change password on first login.');
  } finally {
    rl.close();
    await knex.destroy();
  }
}

async function unlockUser(username: string): Promise<void> {
  const user = await knex('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first();
  if (!user) {
    console.error(`User '${username}' not found.`);
    process.exit(1);
  }

  await knex('users').where({ id: user.id }).update({
    status: 'active',
    failed_login_count: 0,
    locked_until: null,
    updated_at: systemClock.now(),
  });

  await appendAuditEvent({
    actor_id: null,
    actor_role: 'system',
    action: 'users.unlock',
    entity_type: 'user',
    entity_id: String(user.id),
    after_json: { username, action: 'unlocked' },
  });

  console.log(`User '${username}' has been unlocked.`);
  await knex.destroy();
}

async function forcePasswordReset(username: string): Promise<void> {
  const user = await knex('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first();
  if (!user) {
    console.error(`User '${username}' not found.`);
    process.exit(1);
  }

  await knex('users').where({ id: user.id }).update({
    must_change_password: 1,
    updated_at: systemClock.now(),
  });

  await revokeAllUserSessions(BigInt(user.id), 'force_reset_cli');

  await appendAuditEvent({
    actor_id: null,
    actor_role: 'system',
    action: 'users.force_reset',
    entity_type: 'user',
    entity_id: String(user.id),
    after_json: { username, action: 'force_reset' },
  });

  console.log(`User '${username}' must change password on next login. All sessions revoked.`);
  await knex.destroy();
}

async function verifyAuditChain(): Promise<void> {
  console.log('Verifying audit chain integrity...');
  const result = await verifyChain();
  if (result.valid) {
    console.log('Audit chain is valid. All records are intact.');
  } else {
    console.error(`Audit chain is BROKEN at row id: ${result.brokenAt}`);
    process.exit(1);
  }
  await knex.destroy();
}

async function cliListBlacklist(): Promise<void> {
  const entries = await listBlacklist();
  if (entries.length === 0) {
    console.log('No blacklist entries.');
  } else {
    for (const entry of entries) {
      console.log(
        `[${entry.id}] ${entry.subject_type}:${entry.subject_value} — ${entry.reason}` +
        (entry.expires_at ? ` (expires: ${entry.expires_at})` : ' (no expiry)'),
      );
    }
  }
  await knex.destroy();
}

async function cliAddBlacklist(subjectType: string, subjectValue: string, reason: string): Promise<void> {
  if (!['user', 'ip', 'device'].includes(subjectType)) {
    console.error('subjectType must be user, ip, or device');
    process.exit(1);
  }
  const entry = await addBlacklist({
    subjectType: subjectType as 'user' | 'ip' | 'device',
    subjectValue,
    reason,
  });
  console.log(`Blacklist entry added: [${entry.id}] ${entry.subject_type}:${entry.subject_value}`);
  await knex.destroy();
}

async function cliRemoveBlacklist(id: number): Promise<void> {
  await removeBlacklist(id, { id: 0, role: 'system' });
  console.log(`Blacklist entry ${id} removed.`);
  await knex.destroy();
}

async function cliPurgeListing(id: number): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await prompt(rl, `Type PURGE ${id} to confirm: `)).trim();
    if (answer !== `PURGE ${id}`) {
      console.error('Confirmation failed. Aborting.');
      process.exit(1);
    }

    const listing = await knex('listings').where({ id }).first();
    if (!listing) {
      console.error(`Listing ${id} not found.`);
      process.exit(1);
    }

    await knex.transaction(async (trx) => {
      const attachments = await trx('attachments').where({ listing_id: id }).select('id');
      const attachmentIds = attachments.map((a: { id: number }) => a.id);

      if (attachmentIds.length > 0) {
        await trx('attachment_revisions').whereIn('attachment_id', attachmentIds).delete();
      }
      await trx('attachments').where({ listing_id: id }).delete();
      await trx('listing_revisions').where({ listing_id: id }).delete();
      await trx('listing_status_history').where({ listing_id: id }).delete();
      await trx('listings').where({ id }).delete();
    });

    await appendAuditEvent({
      actor_id: null,
      actor_role: 'system',
      action: 'admin.purge_listing',
      entity_type: 'listing',
      entity_id: String(id),
      after_json: { listingId: id, purged: true },
    });

    console.log(`Listing ${id} has been hard-deleted.`);
  } finally {
    rl.close();
    await knex.destroy();
  }
}

async function cliPurgeUser(id: number): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await prompt(rl, `Type PURGE ${id} to confirm: `)).trim();
    if (answer !== `PURGE ${id}`) {
      console.error('Confirmation failed. Aborting.');
      process.exit(1);
    }

    const user = await knex('users').where({ id }).first();
    if (!user) {
      console.error(`User ${id} not found.`);
      process.exit(1);
    }

    await knex('users').where({ id }).update({ status: 'disabled' });
    await revokeAllUserSessions(BigInt(id), 'admin_purge_cli');

    await appendAuditEvent({
      actor_id: null,
      actor_role: 'system',
      action: 'admin.purge_user',
      entity_type: 'user',
      entity_id: String(id),
      after_json: { userId: id, action: 'disabled' },
    });

    console.log(`User ${id} has been disabled and all sessions revoked.`);
  } finally {
    rl.close();
    await knex.destroy();
  }
}

async function cliRiskScore(username: string): Promise<void> {
  const user = await knex('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first();
  if (!user) {
    console.error(`User '${username}' not found.`);
    process.exit(1);
  }

  const profile = await getOrCreateProfile(user.id);
  console.log(`Risk score for '${username}' (id=${user.id}): ${profile.credit_score}`);
  await knex.destroy();
}

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case 'bootstrap-admin':
      await bootstrapAdmin();
      break;
    case 'unlock-user': {
      const username = process.argv[3];
      if (!username) {
        console.error('Usage: harborstone unlock-user <username>');
        process.exit(1);
      }
      await unlockUser(username);
      break;
    }
    case 'force-password-reset': {
      const username = process.argv[3];
      if (!username) {
        console.error('Usage: harborstone force-password-reset <username>');
        process.exit(1);
      }
      await forcePasswordReset(username);
      break;
    }
    case 'verify-audit-chain':
      await verifyAuditChain();
      break;
    case 'list-blacklist':
      await cliListBlacklist();
      break;
    case 'add-blacklist': {
      const type = process.argv[3];
      const value = process.argv[4];
      const reason = process.argv[5];
      if (!type || !value || !reason) {
        console.error('Usage: harborstone add-blacklist <type> <value> <reason>');
        process.exit(1);
      }
      await cliAddBlacklist(type, value, reason);
      break;
    }
    case 'remove-blacklist': {
      const idStr = process.argv[3];
      if (!idStr) {
        console.error('Usage: harborstone remove-blacklist <id>');
        process.exit(1);
      }
      await cliRemoveBlacklist(parseInt(idStr, 10));
      break;
    }
    case 'purge-listing': {
      const idStr = process.argv[3];
      if (!idStr) {
        console.error('Usage: harborstone purge-listing <id>');
        process.exit(1);
      }
      await cliPurgeListing(parseInt(idStr, 10));
      break;
    }
    case 'purge-user': {
      const idStr = process.argv[3];
      if (!idStr) {
        console.error('Usage: harborstone purge-user <id>');
        process.exit(1);
      }
      await cliPurgeUser(parseInt(idStr, 10));
      break;
    }
    case 'rotate-kek':
      console.log('KEK rotation: re-wrap DEKs here (placeholder)');
      await knex.destroy();
      break;
    case 'risk-score': {
      const username = process.argv[3];
      if (!username) {
        console.error('Usage: harborstone risk-score <username>');
        process.exit(1);
      }
      await cliRiskScore(username);
      break;
    }
    default:
      console.log('HarborStone CLI');
      console.log('');
      console.log('Commands:');
      console.log('  bootstrap-admin              Create the initial admin user interactively');
      console.log('  unlock-user <username>        Clear lockout for a user');
      console.log('  force-password-reset <user>   Set must_change_password, revoke sessions');
      console.log('  verify-audit-chain            Verify audit log chain integrity');
      console.log('  list-blacklist                List all blacklist entries');
      console.log('  add-blacklist <type> <value> <reason>  Add a blacklist entry');
      console.log('  remove-blacklist <id>         Remove a blacklist entry');
      console.log('  purge-listing <id>            Hard-delete a listing (requires confirmation)');
      console.log('  purge-user <id>               Disable a user (requires confirmation)');
      console.log('  rotate-kek                    KEK rotation placeholder');
      console.log('  risk-score <username>         Print current risk score for a user');
      process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
