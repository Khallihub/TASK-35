import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.string('username', 32).notNullable();
    table.string('password_hash', 255).notNullable();
    table.enu('role', ['regular_user', 'merchant', 'operations', 'administrator']).notNullable();
    table.bigInteger('office_id').unsigned().nullable();
    table.enu('status', ['active', 'locked', 'disabled']).notNullable().defaultTo('active');
    table.integer('failed_login_count').unsigned().notNullable().defaultTo(0);
    table.datetime('locked_until', { precision: 3 }).nullable();
    table.bigInteger('consent_version_accepted').unsigned().nullable();
    table.datetime('consent_accepted_at', { precision: 3 }).nullable();
    table.datetime('last_password_change_at', { precision: 3 }).nullable();
    table.tinyint('must_change_password').notNullable().defaultTo(0);
    table.datetime('created_at', { precision: 3 }).notNullable();
    table.datetime('updated_at', { precision: 3 }).notNullable();
    table.unique(['username'], { indexName: 'uq_username' });
    table.foreign('office_id', 'fk_user_office').references('id').inTable('offices');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
}
