import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sessions', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('user_id').unsigned().notNullable();
    table.string('jti', 36).notNullable();
    table.datetime('issued_at', { precision: 3 }).notNullable();
    table.datetime('last_activity_at', { precision: 3 }).notNullable();
    table.datetime('expires_at', { precision: 3 }).notNullable();
    table.string('ip', 45).nullable();
    table.string('user_agent', 512).nullable();
    table.string('device_fingerprint', 64).nullable();
    table.datetime('revoked_at', { precision: 3 }).nullable();
    table.string('revoke_reason', 64).nullable();
    table.unique(['jti'], { indexName: 'uq_jti' });
    table.foreign('user_id', 'fk_session_user').references('id').inTable('users');
    table.index(['user_id'], 'idx_sessions_user');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sessions');
}
