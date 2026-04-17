import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('attachment_revisions', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('attachment_id').unsigned().notNullable();
    table.integer('revision_no').unsigned().notNullable();
    table.string('storage_key', 512).notNullable();
    table.string('sha256', 64).notNullable();
    table.bigInteger('bytes').unsigned().notNullable();
    table.integer('pruned').notNullable().defaultTo(0);
    table.bigInteger('created_by').unsigned().notNullable();
    table.dateTime('created_at', { precision: 3 }).notNullable();
    table.unique(['attachment_id', 'revision_no']);
    table.foreign('attachment_id').references('attachments.id');
  });

  await knex.schema.raw('CREATE INDEX idx_ar_attachment ON attachment_revisions (attachment_id)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('attachment_revisions');
}
