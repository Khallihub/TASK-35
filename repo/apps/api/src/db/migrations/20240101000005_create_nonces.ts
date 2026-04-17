import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('nonces', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.string('value', 64).notNullable();
    table.string('purpose', 64).notNullable();
    table.bigInteger('user_id').unsigned().nullable();
    table.datetime('created_at', { precision: 3 }).notNullable();
    table.datetime('expires_at', { precision: 3 }).notNullable();
    table.datetime('consumed_at', { precision: 3 }).nullable();
    table.unique(['value'], { indexName: 'uq_nonce_value' });
    table.index(['expires_at'], 'idx_nonces_expires');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('nonces');
}
