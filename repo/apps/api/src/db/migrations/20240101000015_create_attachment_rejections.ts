import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('attachment_rejections', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('listing_id').unsigned().notNullable();
    table.string('filename', 255).notNullable();
    table.string('reason_code', 64).notNullable();
    table.string('reason_detail', 512).nullable();
    table.bigInteger('actor_id').unsigned().nullable();
    table.dateTime('created_at', { precision: 3 }).notNullable();
    table.foreign('listing_id').references('listings.id');
  });

  await knex.schema.raw('CREATE INDEX idx_rej_listing ON attachment_rejections (listing_id)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('attachment_rejections');
}
