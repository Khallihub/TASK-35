import { Knex } from 'knex';

/**
 * Fix promo_collections status enum: rename 'active' → 'live' to match
 * the PRD-defined vocabulary (draft|scheduled|live|ended|cancelled) and
 * the application type PromoStatus used in services/types.
 */
export async function up(knex: Knex): Promise<void> {
  // Update any existing rows that have 'active' to 'live'
  await knex('promo_collections').where({ status: 'active' }).update({ status: 'live' });

  // For MySQL: alter the ENUM column to use 'live' instead of 'active'
  if (knex.client.config.client === 'mysql' || knex.client.config.client === 'mysql2') {
    await knex.schema.raw(
      "ALTER TABLE promo_collections MODIFY COLUMN status ENUM('draft','scheduled','live','ended','cancelled') NOT NULL DEFAULT 'draft'"
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex('promo_collections').where({ status: 'live' }).update({ status: 'active' });

  if (knex.client.config.client === 'mysql' || knex.client.config.client === 'mysql2') {
    await knex.schema.raw(
      "ALTER TABLE promo_collections MODIFY COLUMN status ENUM('draft','scheduled','active','ended','cancelled') NOT NULL DEFAULT 'draft'"
    );
  }
}
