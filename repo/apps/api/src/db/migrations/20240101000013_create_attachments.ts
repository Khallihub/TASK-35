import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('attachments', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('listing_id').unsigned().notNullable();
    table.enu('kind', ['image', 'video', 'pdf']).notNullable();
    table.string('original_filename', 255).notNullable();
    table.string('storage_key', 512).notNullable();
    table.string('sha256', 64).notNullable();
    table.bigInteger('bytes').unsigned().notNullable();
    table.string('mime', 128).notNullable();
    table.integer('width').unsigned().nullable();
    table.integer('height').unsigned().nullable();
    table.integer('duration_seconds').unsigned().nullable();
    table.bigInteger('created_by').unsigned().notNullable();
    table.dateTime('created_at', { precision: 3 }).notNullable();
    table.bigInteger('current_revision_id').unsigned().nullable();
    table.dateTime('soft_deleted_at', { precision: 3 }).nullable();
    table.foreign('listing_id').references('listings.id');
    table.foreign('created_by').references('users.id');
  });

  await knex.schema.raw('CREATE INDEX idx_att_listing ON attachments (listing_id)');
  await knex.schema.raw('CREATE INDEX idx_att_sha256 ON attachments (listing_id, sha256)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('attachments');
}
