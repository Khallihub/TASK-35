import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('listing_revisions', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('listing_id').unsigned().notNullable();
    table.integer('version').unsigned().notNullable();
    table.json('payload_json').notNullable();
    table.json('diff_json').nullable();
    table.bigInteger('actor_id').unsigned().notNullable();
    table.datetime('created_at', { precision: 3 }).notNullable();

    table.unique(['listing_id', 'version'], { indexName: 'uq_listing_version' });
    table.foreign('listing_id').references('listings.id').withKeyName('fk_lr_listing');
  });

  await knex.schema.table('listing_revisions', (table) => {
    table.index(['listing_id'], 'idx_lr_listing');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('listing_revisions');
}
