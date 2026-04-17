import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('event_log', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('user_id').unsigned().nullable();
    table.string('event_type', 64).notNullable();
    table.string('entity_type', 64).nullable();
    table.bigInteger('entity_id').unsigned().nullable();
    table.bigInteger('office_id').unsigned().nullable();
    table.json('payload_json').nullable();
    table.string('ip', 45).nullable();
    table.datetime('created_at', { precision: 3 }).notNullable();
  });

  await knex.schema.table('event_log', (table) => {
    table.index(['user_id'], 'idx_event_user');
    table.index(['event_type'], 'idx_event_type');
    table.index(['entity_type', 'entity_id'], 'idx_event_entity');
    table.index(['office_id'], 'idx_event_office');
    table.index(['created_at'], 'idx_event_created');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('event_log');
}
