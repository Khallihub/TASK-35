import { Knex } from 'knex';

/**
 * Add next_attempt_at to export_jobs for schedule-aware retry with backoff.
 * PRD §9.3: Failed jobs retry with exponential backoff (30s, 2m, 10m).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('export_jobs', (table) => {
    table.dateTime('next_attempt_at', { precision: 3 }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('export_jobs', (table) => {
    table.dropColumn('next_attempt_at');
  });
}
