import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('password_history', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('user_id').unsigned().notNullable();
    table.string('password_hash', 255).notNullable();
    table.datetime('created_at', { precision: 3 }).notNullable();
    table.foreign('user_id', 'fk_ph_user').references('id').inTable('users');
    table.index(['user_id', 'created_at'], 'idx_ph_user');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('password_history');
}
