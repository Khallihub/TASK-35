import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('listings', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('office_id').unsigned().notNullable();
    table.bigInteger('created_by').unsigned().notNullable();
    table.enu('status', ['draft', 'in_review', 'approved', 'published', 'archived', 'deleted']).notNullable().defaultTo('draft');
    table.bigInteger('price_usd_cents').unsigned().nullable();
    table.decimal('area_sqft', 10, 2).nullable();
    table.decimal('area_sqm', 10, 2).nullable();
    table.tinyint('beds').unsigned().nullable();
    table.smallint('baths').unsigned().nullable();
    table.smallint('floor_level').nullable();
    table.enu('orientation', ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']).nullable();
    table.decimal('latitude', 9, 6).nullable();
    table.decimal('longitude', 9, 6).nullable();
    table.string('address_line', 255).nullable();
    table.string('city', 128).nullable();
    table.specificType('state_code', 'CHAR(2)').nullable();
    table.string('postal_code', 10).nullable();
    table.string('layout_normalized', 64).nullable();
    table.json('anomaly_flags').nullable();
    table.datetime('soft_deleted_at', { precision: 3 }).nullable();
    table.datetime('published_at', { precision: 3 }).nullable();
    table.integer('version').unsigned().notNullable().defaultTo(1);
    table.datetime('created_at', { precision: 3 }).notNullable();
    table.datetime('updated_at', { precision: 3 }).notNullable();

    table.foreign('office_id').references('offices.id').withKeyName('fk_listing_office');
    table.foreign('created_by').references('users.id').withKeyName('fk_listing_creator');
  });

  await knex.raw('ALTER TABLE listings ADD FULLTEXT KEY ft_listing_search (address_line, city, layout_normalized)');
  await knex.schema.table('listings', (table) => {
    table.index(['office_id'], 'idx_listing_office');
    table.index(['status'], 'idx_listing_status');
    table.index(['created_by'], 'idx_listing_created_by');
    table.index(['published_at'], 'idx_listing_published');
    table.index(['updated_at'], 'idx_listing_updated');
    table.index(['soft_deleted_at'], 'idx_listing_soft_deleted');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('listings');
}
