import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('offices', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.string('name', 255).notNullable();
    table.string('code', 32).notNullable();
    table.tinyint('active').notNullable().defaultTo(1);
    table.unique(['code'], { indexName: 'uq_office_code' });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('offices');
}
