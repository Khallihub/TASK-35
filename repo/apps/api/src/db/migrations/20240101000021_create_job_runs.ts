import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('job_runs', (table) => {
    table.bigIncrements('id').primary();
    table.string('job_name', 64).notNullable();
    table.enu('status', ['running', 'completed', 'failed']).notNullable().defaultTo('running');
    table.datetime('started_at', { useTz: false, precision: 3 }).notNullable();
    table.datetime('finished_at', { useTz: false, precision: 3 }).nullable();
    table.integer('records_processed').unsigned().defaultTo(0);
    table.text('error_detail').nullable();
  });
  await knex.schema.raw('CREATE INDEX idx_jr_job ON job_runs (job_name)');
  await knex.schema.raw('CREATE INDEX idx_jr_status ON job_runs (status)');
  await knex.schema.raw('CREATE INDEX idx_jr_started ON job_runs (started_at)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('job_runs');
}
