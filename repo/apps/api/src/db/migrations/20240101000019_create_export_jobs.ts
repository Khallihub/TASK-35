import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('export_jobs', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('requested_by').unsigned().notNullable();
    table.json('params_json').notNullable();
    table
      .enu('status', ['queued', 'running', 'completed', 'failed', 'expired'])
      .notNullable()
      .defaultTo('queued');
    table.string('file_key', 512).nullable();
    table.string('sha256', 64).nullable();
    table.bigInteger('bytes').unsigned().nullable();
    table.integer('attempt_count').unsigned().notNullable().defaultTo(0);
    table.text('last_error').nullable();
    table.datetime('requested_at', { useTz: false, precision: 3 }).notNullable();
    table.datetime('completed_at', { useTz: false, precision: 3 }).nullable();
    table.datetime('expires_at', { useTz: false, precision: 3 }).notNullable();
    table.foreign('requested_by').references('users.id');
  });
  await knex.schema.raw('CREATE INDEX idx_ej_user ON export_jobs (requested_by)');
  await knex.schema.raw('CREATE INDEX idx_ej_status ON export_jobs (status)');
  await knex.schema.raw('CREATE INDEX idx_ej_expires ON export_jobs (expires_at)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('export_jobs');
}
