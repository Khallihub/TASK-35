import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('idempotency_keys', (table) => {
    table.string('key_value', 36).notNullable().primary();
    table.bigInteger('user_id').unsigned().notNullable();
    table.string('route', 128).notNullable();
    table.string('request_hash', 64).notNullable();
    table.json('response_snapshot').nullable();
    table.integer('status_code').unsigned().notNullable().defaultTo(200);
    table.datetime('created_at', { precision: 3 }).notNullable();
    table.datetime('expires_at', { precision: 3 }).notNullable();
    table.index(['expires_at'], 'idx_idem_expires');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('idempotency_keys');
}
