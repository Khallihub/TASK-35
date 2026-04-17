import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE audit_log (
      id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      prev_hash     CHAR(64) NOT NULL,
      row_hash      CHAR(64) NOT NULL,
      actor_id      BIGINT UNSIGNED,
      actor_role    VARCHAR(32),
      action        VARCHAR(64) NOT NULL,
      entity_type   VARCHAR(64),
      entity_id     VARCHAR(64),
      before_json   JSON,
      after_json    JSON,
      ip            VARCHAR(45),
      user_agent    VARCHAR(512),
      legal_hold    TINYINT(1) NOT NULL DEFAULT 0,
      created_at    DATETIME(3) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await knex.raw(`CREATE INDEX idx_audit_actor ON audit_log (actor_id)`);
  await knex.raw(`CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id)`);
  await knex.raw(`CREATE INDEX idx_audit_created ON audit_log (created_at)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_log');
}
