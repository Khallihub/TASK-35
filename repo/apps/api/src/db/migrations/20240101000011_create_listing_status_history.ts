import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('listing_status_history', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('listing_id').unsigned().notNullable();
    table.string('from_status', 32).nullable();
    table.string('to_status', 32).notNullable();
    table.bigInteger('actor_id').unsigned().notNullable();
    table.string('reason', 512).nullable();
    table.datetime('created_at', { precision: 3 }).notNullable();
    table.string('ip', 45).nullable();

    table.foreign('listing_id').references('listings.id').withKeyName('fk_lsh_listing');
  });

  await knex.schema.table('listing_status_history', (table) => {
    table.index(['listing_id'], 'idx_lsh_listing');
    table.index(['created_at'], 'idx_lsh_created');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('listing_status_history');
}
