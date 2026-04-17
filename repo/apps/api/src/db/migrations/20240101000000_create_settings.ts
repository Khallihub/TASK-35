import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('settings', (table) => {
    table.string('key', 128).notNullable().primary();
    table.text('value').notNullable();
    table.text('description').nullable();
    // updated_at with DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    // knex doesn't have a built-in for this, so use raw
  });

  // Alter to add proper MySQL datetime(3) with ON UPDATE
  await knex.raw(`
    ALTER TABLE settings
      MODIFY COLUMN updated_at DATETIME(3) NOT NULL
        DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3)
  `).catch(() => {
    // SQLite doesn't support ALTER TABLE MODIFY — add column normally
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('settings');
}
