import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('consent_versions', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.string('version', 16).notNullable();
    table.text('body_md').notNullable();
    table.datetime('effective_from', { precision: 3 }).notNullable();
    table.unique(['version'], { indexName: 'uq_consent_version' });
  });

  await knex.schema.createTable('consent_records', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('user_id').unsigned().notNullable();
    table.bigInteger('consent_version_id').unsigned().notNullable();
    table.datetime('accepted_at', { precision: 3 }).notNullable();
    table.string('ip', 45).nullable();
    table.foreign('user_id', 'fk_cr_user').references('id').inTable('users');
    table.foreign('consent_version_id', 'fk_cr_version').references('id').inTable('consent_versions');
    table.index(['user_id'], 'idx_cr_user');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('consent_records');
  await knex.schema.dropTableIfExists('consent_versions');
}
