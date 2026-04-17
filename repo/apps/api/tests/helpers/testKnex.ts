import Knex, { Knex as KnexType } from 'knex';

/**
 * Create an in-memory SQLite knex instance for testing.
 * SQLite-compatible schema: uses INTEGER PRIMARY KEY AUTOINCREMENT
 * instead of BIGINT UNSIGNED AUTO_INCREMENT.
 */
export function createTestKnex(): KnexType {
  return Knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

/**
 * Run test migrations for the audit_log table using SQLite-compatible DDL.
 */
export async function runTestMigrations(knex: KnexType): Promise<void> {
  // Settings table (SQLite-compatible)
  const hasSettings = await knex.schema.hasTable('settings');
  if (!hasSettings) {
    await knex.schema.createTable('settings', (table) => {
      table.string('key', 128).notNullable().primary();
      table.text('value').notNullable();
      table.text('description').nullable();
      table.datetime('updated_at').defaultTo(knex.fn.now());
    });
  }

  // Audit log table (SQLite-compatible)
  // SQLite uses INTEGER PRIMARY KEY AUTOINCREMENT, not BIGINT UNSIGNED AUTO_INCREMENT
  const hasAuditLog = await knex.schema.hasTable('audit_log');
  if (!hasAuditLog) {
    await knex.schema.createTable('audit_log', (table) => {
      table.increments('id').primary();
      table.string('prev_hash', 64).notNullable();
      table.string('row_hash', 64).notNullable();
      table.bigInteger('actor_id').nullable();
      table.string('actor_role', 32).nullable();
      table.string('action', 64).notNullable();
      table.string('entity_type', 64).nullable();
      table.string('entity_id', 64).nullable();
      table.text('before_json').nullable();
      table.text('after_json').nullable();
      table.string('ip', 45).nullable();
      table.string('user_agent', 512).nullable();
      table.integer('legal_hold').notNullable().defaultTo(0);
      table.datetime('created_at').notNullable();
    });
  }

  // Phase 1 tables
  const hasOffices = await knex.schema.hasTable('offices');
  if (!hasOffices) {
    await knex.schema.createTable('offices', (table) => {
      table.increments('id').primary();
      table.string('name', 255).notNullable();
      table.string('code', 32).notNullable();
      table.integer('active').notNullable().defaultTo(1);
      table.unique(['code']);
    });
  }

  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) {
    await knex.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('username', 32).notNullable();
      table.string('password_hash', 255).notNullable();
      table.string('role', 32).notNullable();
      table.integer('office_id').nullable();
      table.string('status', 16).notNullable().defaultTo('active');
      table.integer('failed_login_count').notNullable().defaultTo(0);
      table.datetime('locked_until').nullable();
      table.integer('consent_version_accepted').nullable();
      table.datetime('consent_accepted_at').nullable();
      table.datetime('last_password_change_at').nullable();
      table.integer('must_change_password').notNullable().defaultTo(0);
      table.datetime('created_at').notNullable();
      table.datetime('updated_at').notNullable();
      table.unique(['username']);
    });
  }

  const hasLoginAttempts = await knex.schema.hasTable('login_attempts');
  if (!hasLoginAttempts) {
    await knex.schema.createTable('login_attempts', (table) => {
      table.increments('id').primary();
      table.integer('user_id').notNullable();
      table.datetime('attempted_at').notNullable();
      table.index(['user_id', 'attempted_at']);
    });
  }

  const hasSessions = await knex.schema.hasTable('sessions');
  if (!hasSessions) {
    await knex.schema.createTable('sessions', (table) => {
      table.increments('id').primary();
      table.integer('user_id').notNullable();
      table.string('jti', 36).notNullable();
      table.datetime('issued_at').notNullable();
      table.datetime('last_activity_at').notNullable();
      table.datetime('expires_at').notNullable();
      table.string('ip', 45).nullable();
      table.string('user_agent', 512).nullable();
      table.string('device_fingerprint', 64).nullable();
      table.datetime('revoked_at').nullable();
      table.string('revoke_reason', 64).nullable();
      table.unique(['jti']);
    });
  }

  const hasNonces = await knex.schema.hasTable('nonces');
  if (!hasNonces) {
    await knex.schema.createTable('nonces', (table) => {
      table.increments('id').primary();
      table.string('value', 64).notNullable();
      table.string('purpose', 64).notNullable();
      table.integer('user_id').nullable();
      table.datetime('created_at').notNullable();
      table.datetime('expires_at').notNullable();
      table.datetime('consumed_at').nullable();
      table.unique(['value']);
    });
  }

  const hasIdempotencyKeys = await knex.schema.hasTable('idempotency_keys');
  if (!hasIdempotencyKeys) {
    await knex.schema.createTable('idempotency_keys', (table) => {
      table.string('key_value', 36).notNullable().primary();
      table.integer('user_id').notNullable();
      table.string('route', 128).notNullable();
      table.string('request_hash', 64).notNullable();
      table.text('response_snapshot').nullable();
      table.integer('status_code').notNullable().defaultTo(200);
      table.datetime('created_at').notNullable();
      table.datetime('expires_at').notNullable();
    });
  }

  const hasConsentVersions = await knex.schema.hasTable('consent_versions');
  if (!hasConsentVersions) {
    await knex.schema.createTable('consent_versions', (table) => {
      table.increments('id').primary();
      table.string('version', 16).notNullable();
      table.text('body_md').notNullable();
      table.datetime('effective_from').notNullable();
      table.unique(['version']);
    });
  }

  const hasConsentRecords = await knex.schema.hasTable('consent_records');
  if (!hasConsentRecords) {
    await knex.schema.createTable('consent_records', (table) => {
      table.increments('id').primary();
      table.integer('user_id').notNullable();
      table.integer('consent_version_id').notNullable();
      table.datetime('accepted_at').notNullable();
      table.string('ip', 45).nullable();
    });
  }

  const hasPasswordHistory = await knex.schema.hasTable('password_history');
  if (!hasPasswordHistory) {
    await knex.schema.createTable('password_history', (table) => {
      table.increments('id').primary();
      table.integer('user_id').notNullable();
      table.string('password_hash', 255).notNullable();
      table.datetime('created_at').notNullable();
    });
  }

  // Phase 2 tables

  const hasListings = await knex.schema.hasTable('listings');
  if (!hasListings) {
    await knex.schema.createTable('listings', (table) => {
      table.increments('id').primary();
      table.integer('office_id').notNullable();
      table.integer('created_by').notNullable();
      table.text('status').notNullable().defaultTo('draft');
      table.integer('price_usd_cents').nullable();
      table.text('area_sqft').nullable();
      table.text('area_sqm').nullable();
      table.integer('beds').nullable();
      table.integer('baths').nullable();
      table.integer('floor_level').nullable();
      table.text('orientation').nullable();
      table.text('latitude').nullable();
      table.text('longitude').nullable();
      table.text('address_line').nullable();
      table.text('city').nullable();
      table.text('state_code').nullable();
      table.text('postal_code').nullable();
      table.text('layout_normalized').nullable();
      table.text('anomaly_flags').nullable();
      table.datetime('soft_deleted_at').nullable();
      table.datetime('published_at').nullable();
      table.integer('version').notNullable().defaultTo(1);
      table.datetime('created_at').notNullable();
      table.datetime('updated_at').notNullable();
    });
  }

  const hasListingRevisions = await knex.schema.hasTable('listing_revisions');
  if (!hasListingRevisions) {
    await knex.schema.createTable('listing_revisions', (table) => {
      table.increments('id').primary();
      table.integer('listing_id').notNullable();
      table.integer('version').notNullable();
      table.text('payload_json').notNullable();
      table.text('diff_json').nullable();
      table.integer('actor_id').notNullable();
      table.datetime('created_at').notNullable();
    });
    await knex.schema.raw(
      'CREATE UNIQUE INDEX uq_listing_version ON listing_revisions (listing_id, version)',
    );
  }

  const hasListingStatusHistory = await knex.schema.hasTable('listing_status_history');
  if (!hasListingStatusHistory) {
    await knex.schema.createTable('listing_status_history', (table) => {
      table.increments('id').primary();
      table.integer('listing_id').notNullable();
      table.text('from_status').nullable();
      table.text('to_status').notNullable();
      table.integer('actor_id').notNullable();
      table.text('reason').nullable();
      table.datetime('created_at').notNullable();
      table.text('ip').nullable();
    });
  }

  const hasEventLog = await knex.schema.hasTable('event_log');
  if (!hasEventLog) {
    await knex.schema.createTable('event_log', (table) => {
      table.increments('id').primary();
      table.integer('user_id').nullable();
      table.text('event_type').notNullable();
      table.text('entity_type').nullable();
      table.integer('entity_id').nullable();
      table.integer('office_id').nullable();
      table.text('payload_json').nullable();
      table.text('ip').nullable();
      table.datetime('created_at').notNullable();
    });
  }

  // Phase 3 tables

  const hasAttachments = await knex.schema.hasTable('attachments');
  if (!hasAttachments) {
    await knex.schema.createTable('attachments', (table) => {
      table.increments('id').primary();
      table.integer('listing_id').notNullable();
      table.text('kind').notNullable();
      table.text('original_filename').notNullable();
      table.text('storage_key').notNullable();
      table.text('sha256').notNullable();
      table.integer('bytes').notNullable();
      table.text('mime').notNullable();
      table.integer('width').nullable();
      table.integer('height').nullable();
      table.integer('duration_seconds').nullable();
      table.integer('created_by').notNullable();
      table.datetime('created_at').notNullable();
      table.integer('current_revision_id').nullable();
      table.datetime('soft_deleted_at').nullable();
    });
  }

  const hasAttachmentRevisions = await knex.schema.hasTable('attachment_revisions');
  if (!hasAttachmentRevisions) {
    await knex.schema.createTable('attachment_revisions', (table) => {
      table.increments('id').primary();
      table.integer('attachment_id').notNullable();
      table.integer('revision_no').notNullable();
      table.text('storage_key').notNullable();
      table.text('sha256').notNullable();
      table.integer('bytes').notNullable();
      table.integer('pruned').notNullable().defaultTo(0);
      table.integer('created_by').notNullable();
      table.datetime('created_at').notNullable();
    });
    await knex.schema.raw(
      'CREATE UNIQUE INDEX uq_att_rev ON attachment_revisions (attachment_id, revision_no)',
    );
  }

  const hasAttachmentRejections = await knex.schema.hasTable('attachment_rejections');
  if (!hasAttachmentRejections) {
    await knex.schema.createTable('attachment_rejections', (table) => {
      table.increments('id').primary();
      table.integer('listing_id').notNullable();
      table.text('filename').notNullable();
      table.text('reason_code').notNullable();
      table.text('reason_detail').nullable();
      table.integer('actor_id').nullable();
      table.datetime('created_at').notNullable();
    });
  }

  // Phase 4 tables

  const hasPromoCollections = await knex.schema.hasTable('promo_collections');
  if (!hasPromoCollections) {
    await knex.schema.createTable('promo_collections', (table) => {
      table.increments('id').primary();
      table.string('title', 255).notNullable();
      table.text('theme_date').nullable();
      table.datetime('starts_at').notNullable();
      table.datetime('ends_at').notNullable();
      // SQLite: use TEXT with CHECK to mirror MySQL ENUM
      table.text('status').notNullable().defaultTo('draft');
      table.integer('created_by').notNullable();
      table.datetime('created_at').notNullable();
      table.datetime('updated_at').notNullable();
    });
    // Enforce valid promo statuses matching PRD: draft|scheduled|live|ended|cancelled
    await knex.schema.raw(
      "CREATE TRIGGER trg_promo_status_insert BEFORE INSERT ON promo_collections BEGIN SELECT CASE WHEN NEW.status NOT IN ('draft','scheduled','live','ended','cancelled') THEN RAISE(ABORT, 'invalid promo status') END; END"
    );
    await knex.schema.raw(
      "CREATE TRIGGER trg_promo_status_update BEFORE UPDATE ON promo_collections BEGIN SELECT CASE WHEN NEW.status NOT IN ('draft','scheduled','live','ended','cancelled') THEN RAISE(ABORT, 'invalid promo status') END; END"
    );
  }

  const hasPromoSlots = await knex.schema.hasTable('promo_slots');
  if (!hasPromoSlots) {
    await knex.schema.createTable('promo_slots', (table) => {
      table.increments('id').primary();
      table.integer('collection_id').notNullable();
      table.integer('listing_id').notNullable();
      table.integer('rank').notNullable();
      table.integer('added_by').notNullable();
      table.datetime('added_at').notNullable();
      // No FOREIGN KEY constraints for SQLite compatibility
      // UNIQUE constraints: (collection_id, listing_id) and (collection_id, rank)
    });
    await knex.schema.raw(
      'CREATE UNIQUE INDEX uq_slot_listing ON promo_slots (collection_id, listing_id)',
    );
    await knex.schema.raw(
      'CREATE UNIQUE INDEX uq_slot_rank ON promo_slots (collection_id, rank)',
    );
  }

  // Phase 5 tables

  const hasKpiDaily = await knex.schema.hasTable('kpi_daily');
  if (!hasKpiDaily) {
    await knex.schema.createTable('kpi_daily', (table) => {
      table.increments('id').primary();
      table.text('grain_date').notNullable();
      table.integer('office_id').nullable();
      table.integer('agent_id').nullable();
      table.string('metric', 64).notNullable();
      table.integer('value').notNullable().defaultTo(0);
    });
    await knex.schema.raw(
      'CREATE UNIQUE INDEX uq_kpi_daily ON kpi_daily (grain_date, office_id, agent_id, metric)',
    );
  }

  const hasKpiMonthly = await knex.schema.hasTable('kpi_monthly');
  if (!hasKpiMonthly) {
    await knex.schema.createTable('kpi_monthly', (table) => {
      table.increments('id').primary();
      table.text('grain_date').notNullable();
      table.integer('office_id').nullable();
      table.integer('agent_id').nullable();
      table.string('metric', 64).notNullable();
      table.integer('value').notNullable().defaultTo(0);
    });
    await knex.schema.raw(
      'CREATE UNIQUE INDEX uq_kpi_monthly ON kpi_monthly (grain_date, office_id, agent_id, metric)',
    );
  }

  const hasExportJobs = await knex.schema.hasTable('export_jobs');
  if (!hasExportJobs) {
    await knex.schema.createTable('export_jobs', (table) => {
      table.increments('id').primary();
      table.integer('requested_by').notNullable();
      table.text('params_json').notNullable();
      // SQLite: TEXT instead of ENUM
      table.text('status').notNullable().defaultTo('queued');
      table.text('file_key').nullable();
      table.text('sha256').nullable();
      table.integer('bytes').nullable();
      table.integer('attempt_count').notNullable().defaultTo(0);
      table.text('last_error').nullable();
      table.datetime('requested_at').notNullable();
      table.datetime('completed_at').nullable();
      table.datetime('expires_at').notNullable();
      table.datetime('next_attempt_at').nullable();
    });
  }

  const hasRiskProfiles = await knex.schema.hasTable('risk_profiles');
  if (!hasRiskProfiles) {
    await knex.schema.createTable('risk_profiles', (table) => {
      table.increments('id').primary();
      table.integer('user_id').notNullable();
      table.integer('credit_score').notNullable().defaultTo(100);
      table.datetime('last_decay_at').nullable();
      table.text('flags').nullable();
    });
    await knex.schema.raw(
      'CREATE UNIQUE INDEX uq_rp_user ON risk_profiles (user_id)',
    );
  }

  const hasBlacklistEntries = await knex.schema.hasTable('blacklist_entries');
  if (!hasBlacklistEntries) {
    await knex.schema.createTable('blacklist_entries', (table) => {
      table.increments('id').primary();
      // SQLite: TEXT instead of ENUM
      table.text('subject_type').notNullable();
      table.string('subject_value', 255).notNullable();
      table.string('reason', 512).notNullable();
      table.datetime('expires_at').nullable();
      table.integer('created_by').nullable();
      table.datetime('created_at').notNullable();
    });
    await knex.schema.raw(
      'CREATE UNIQUE INDEX uq_bl ON blacklist_entries (subject_type, subject_value)',
    );
  }

  const hasRiskEvents = await knex.schema.hasTable('risk_events');
  if (!hasRiskEvents) {
    await knex.schema.createTable('risk_events', (table) => {
      table.increments('id').primary();
      table.integer('user_id').notNullable();
      table.string('event_type', 64).notNullable();
      table.integer('delta').notNullable();
      table.integer('new_score').notNullable();
      table.text('detail_json').nullable();
      table.datetime('created_at').notNullable();
    });
  }

  const hasJobRuns = await knex.schema.hasTable('job_runs');
  if (!hasJobRuns) {
    await knex.schema.createTable('job_runs', (table) => {
      table.increments('id').primary();
      table.string('job_name', 64).notNullable();
      // SQLite: TEXT instead of ENUM
      table.text('status').notNullable().defaultTo('running');
      table.datetime('started_at').notNullable();
      table.datetime('finished_at').nullable();
      table.integer('records_processed').defaultTo(0);
      table.text('error_detail').nullable();
    });
  }
}

/**
 * Drop test tables.
 */
export async function dropTestTables(knex: KnexType): Promise<void> {
  await knex.schema.dropTableIfExists('job_runs');
  await knex.schema.dropTableIfExists('risk_events');
  await knex.schema.dropTableIfExists('blacklist_entries');
  await knex.schema.dropTableIfExists('risk_profiles');
  await knex.schema.dropTableIfExists('export_jobs');
  await knex.schema.dropTableIfExists('kpi_monthly');
  await knex.schema.dropTableIfExists('kpi_daily');
  await knex.schema.dropTableIfExists('promo_slots');
  await knex.schema.dropTableIfExists('promo_collections');
  await knex.schema.dropTableIfExists('attachment_rejections');
  await knex.schema.dropTableIfExists('attachment_revisions');
  await knex.schema.dropTableIfExists('attachments');
  await knex.schema.dropTableIfExists('event_log');
  await knex.schema.dropTableIfExists('listing_status_history');
  await knex.schema.dropTableIfExists('listing_revisions');
  await knex.schema.dropTableIfExists('listings');
  await knex.schema.dropTableIfExists('password_history');
  await knex.schema.dropTableIfExists('consent_records');
  await knex.schema.dropTableIfExists('consent_versions');
  await knex.schema.dropTableIfExists('idempotency_keys');
  await knex.schema.dropTableIfExists('nonces');
  await knex.schema.dropTableIfExists('sessions');
  await knex.schema.dropTableIfExists('login_attempts');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('offices');
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.dropTableIfExists('settings');
}
