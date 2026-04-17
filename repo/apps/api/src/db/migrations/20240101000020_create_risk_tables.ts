import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('risk_profiles', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('user_id').unsigned().notNullable();
    table.smallint('credit_score').notNullable().defaultTo(100);
    table.datetime('last_decay_at', { useTz: false, precision: 3 }).nullable();
    table.json('flags').nullable();
    table.unique(['user_id']);
    table.foreign('user_id').references('users.id');
  });

  await knex.schema.createTable('blacklist_entries', (table) => {
    table.bigIncrements('id').primary();
    table.enu('subject_type', ['user', 'ip', 'device']).notNullable();
    table.string('subject_value', 255).notNullable();
    table.string('reason', 512).notNullable();
    table.datetime('expires_at', { useTz: false, precision: 3 }).nullable();
    table.bigInteger('created_by').unsigned().nullable();
    table.datetime('created_at', { useTz: false, precision: 3 }).notNullable();
  });
  await knex.schema.raw(
    'ALTER TABLE blacklist_entries ADD UNIQUE KEY uq_bl (subject_type, subject_value)',
  );

  await knex.schema.createTable('risk_events', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('user_id').unsigned().notNullable();
    table.string('event_type', 64).notNullable();
    table.smallint('delta').notNullable();
    table.smallint('new_score').notNullable();
    table.json('detail_json').nullable();
    table.datetime('created_at', { useTz: false, precision: 3 }).notNullable();
    table.foreign('user_id').references('users.id');
  });
  await knex.schema.raw('CREATE INDEX idx_re_user ON risk_events (user_id)');
  await knex.schema.raw('CREATE INDEX idx_re_created ON risk_events (created_at)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('risk_events');
  await knex.schema.dropTableIfExists('blacklist_entries');
  await knex.schema.dropTableIfExists('risk_profiles');
}
