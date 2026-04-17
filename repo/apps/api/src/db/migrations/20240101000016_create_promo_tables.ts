import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('promo_collections', (table) => {
    table.bigIncrements('id').primary();
    table.string('title', 255).notNullable();
    table.date('theme_date').nullable();
    table.dateTime('starts_at', { precision: 3 }).notNullable();
    table.dateTime('ends_at', { precision: 3 }).notNullable();
    table
      .enu('status', ['draft', 'scheduled', 'active', 'ended', 'cancelled'])
      .notNullable()
      .defaultTo('draft');
    table.bigInteger('created_by').unsigned().notNullable();
    table.dateTime('created_at', { precision: 3 }).notNullable();
    table.dateTime('updated_at', { precision: 3 }).notNullable();
    table.foreign('created_by').references('users.id');
  });

  await knex.schema.raw('CREATE INDEX idx_promo_status ON promo_collections (status)');
  await knex.schema.raw('CREATE INDEX idx_promo_starts ON promo_collections (starts_at)');

  await knex.schema.createTable('promo_slots', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('collection_id').unsigned().notNullable();
    table.bigInteger('listing_id').unsigned().notNullable();
    table.tinyint('rank').unsigned().notNullable();
    table.bigInteger('added_by').unsigned().notNullable();
    table.dateTime('added_at', { precision: 3 }).notNullable();
    table.foreign('collection_id').references('promo_collections.id');
    table.foreign('listing_id').references('listings.id');
    table.foreign('added_by').references('users.id');
    table.unique(['collection_id', 'listing_id'], { indexName: 'uq_slot_listing' });
    table.unique(['collection_id', 'rank'], { indexName: 'uq_slot_rank' });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('promo_slots');
  await knex.schema.dropTableIfExists('promo_collections');
}
