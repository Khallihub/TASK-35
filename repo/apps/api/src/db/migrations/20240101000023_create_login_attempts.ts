import { Knex } from 'knex';

/**
 * Track individual failed login timestamps for windowed brute-force detection.
 * Per PRD 8.2: "10 failed logins per username per 15 min -> lock account for 30 min."
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('login_attempts', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('user_id').unsigned().notNullable();
    table.dateTime('attempted_at', { precision: 3 }).notNullable();
    table.foreign('user_id').references('users.id');
    table.index(['user_id', 'attempted_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('login_attempts');
}
