import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('kpi_daily', (table) => {
    table.bigIncrements('id').primary();
    table.date('grain_date').notNullable();
    table.bigInteger('office_id').unsigned().nullable();
    table.bigInteger('agent_id').unsigned().nullable();
    table.string('metric', 64).notNullable();
    table.bigInteger('value').notNullable().defaultTo(0);
  });

  await knex.schema.raw(
    'ALTER TABLE kpi_daily ADD UNIQUE KEY uq_kpi_daily (grain_date, office_id, agent_id, metric)',
  );
  await knex.schema.raw('CREATE INDEX idx_kpi_daily_date ON kpi_daily (grain_date)');
  await knex.schema.raw('CREATE INDEX idx_kpi_daily_office ON kpi_daily (office_id)');

  await knex.schema.createTable('kpi_monthly', (table) => {
    table.bigIncrements('id').primary();
    table.date('grain_date').notNullable();
    table.bigInteger('office_id').unsigned().nullable();
    table.bigInteger('agent_id').unsigned().nullable();
    table.string('metric', 64).notNullable();
    table.bigInteger('value').notNullable().defaultTo(0);
  });

  await knex.schema.raw(
    'ALTER TABLE kpi_monthly ADD UNIQUE KEY uq_kpi_monthly (grain_date, office_id, agent_id, metric)',
  );
  await knex.schema.raw('CREATE INDEX idx_kpi_monthly_date ON kpi_monthly (grain_date)');
  await knex.schema.raw('CREATE INDEX idx_kpi_monthly_office ON kpi_monthly (office_id)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('kpi_monthly');
  await knex.schema.dropTableIfExists('kpi_daily');
}
