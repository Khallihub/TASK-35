# Required Document Description: HarborStone Assumptions Clarification Log

This document records the 14 key assumptions made during Phase 0 implementation using the Question, My Understanding, and Solution format.

## Database Engine and Collation
Question: The prompt did not explicitly define the production database engine or collation strategy.
My Understanding: Production should run on MySQL 8.0+ with InnoDB, and migrations should use utf8mb4_0900_ai_ci to support full Unicode.
Solution: Standardized the production schema and migration assumptions on MySQL 8.0+, InnoDB tables, and utf8mb4_0900_ai_ci collation.

## Timezone and DATETIME Storage
Question: The prompt did not specify a default business timezone or how DATETIME values should be persisted.
My Understanding: Business operations default to America/New_York, while all DATETIME values are stored in UTC and converted at the application layer.
Solution: Adopted a UTC-at-rest model with application-level timezone conversion and America/New_York as the default operating timezone.

## Audit Log Immutability with Retention Exception
Question: The prompt required auditability but did not define whether audit rows are mutable or removable.
My Understanding: The audit_log table is append-only in normal operation; application code must not update or delete rows except legal_hold flag management by privileged administrators. A retention janitor may hard-delete rows older than 365 days if not under legal_hold.
Solution: Enforced append-only audit behavior, limited mutation to legal_hold control, and implemented retention compaction for non-protected historical rows.

## Hash Chain Genesis and Post-Compaction Verification
Question: The prompt did not define the chain genesis value or expected behavior after old audit rows are compacted.
My Understanding: The genesis sentinel is prev_hash = 64 zeros. After retention compaction, verification should anchor on the first surviving row's prev_hash because its predecessor may no longer exist.
Solution: Defined a fixed genesis sentinel and implemented verifyChain logic that validates self-consistency from the first surviving row after compaction.

## Secret Redaction Policy
Question: The prompt required secure logging but did not enumerate all fields that must be redacted.
My Understanding: Sensitive keys such as password, token, authorization, cookie, secret, jwt, hash, nonce, and related variants must always be redacted from logs.
Solution: Established a minimum required redaction list and treated it as expandable for additional sensitive fields.

## JWT Session Strategy
Question: The prompt did not define token lifetime and session control behavior.
My Understanding: Access tokens are short-lived by default (30 minutes), while refresh token rotation and an 8-hour absolute session maximum are enforced.
Solution: Implemented runtime-tunable JWT controls through the settings table so security policy can be adjusted without redeployment.

## bcrypt Cost Configuration
Question: The prompt did not define the default bcrypt cost or whether it should be runtime-configurable.
My Understanding: Default cost is 12, with runtime override from settings.security.bcrypt_cost; cost increases should apply only to newly generated hashes.
Solution: Set default cost at 12, wired runtime lookup from the settings table, and preserved backward compatibility for existing password hashes.

## Configuration Hierarchy and Override Scope
Question: The prompt did not fully define precedence between compiled defaults, environment variables, and database settings.
My Understanding: Environment variables override compiled defaults, and the settings table overrides only values explicitly queried by services.
Solution: Adopted a layered configuration model where env plus defaults form the baseline and selective settings table reads provide runtime overrides for targeted keys.

## Test Database Compatibility Strategy
Question: The prompt did not specify whether tests must run against MySQL or an alternative database.
My Understanding: Tests should use SQLite :memory: with better-sqlite3 for speed and isolation, acknowledging DDL differences from MySQL.
Solution: Treated production MySQL DDL as authoritative and maintained a compatibility-oriented SQLite test schema for automated test execution.

## Concurrency Control for Audit Chain Appends
Question: The prompt did not define how concurrent audit inserts should avoid hash-chain race conditions.
My Understanding: MySQL should use transaction locking with SELECT ... FOR UPDATE on the latest audit row; SQLite tests should rely on serialized transaction semantics.
Solution: Applied row-level lock strategy in production and deterministic serialized semantics in SQLite tests to preserve append order integrity.

## Health Endpoint Authentication and Cost
Question: The prompt did not specify whether health checks require authentication or deep integrity verification.
My Understanding: /healthz must be unauthenticated for infrastructure probes and should expose only lightweight integrity metadata, not full chain verification per request.
Solution: Kept /healthz open for orchestrator and load balancer checks and limited response work to chain head hash reporting.

## Attachment Storage Location and Limits
Question: The prompt did not define storage backend selection or default attachment limits.
My Understanding: Attachments are stored locally at STORAGE_PATH (default ./data/attachments), with S3-compatible migration deferred. listing.max_attachments defaults to 25 and is enforced in application logic.
Solution: Implemented filesystem-backed storage as the current default and enforced attachment count limits at the service layer.

## Monorepo Workspace and Shared Package Strategy
Question: The prompt did not define monorepo package sharing strategy across backend and frontend surfaces.
My Understanding: npm workspaces should manage the monorepo, and packages/shared should provide shared TypeScript types and error codes.
Solution: Standardized on npm workspaces and shared package imports, with Jest moduleNameMapper support for cross-package resolution.

## API Error Envelope Contract
Question: The prompt did not define a strict API error response contract or environment-specific stack trace behavior.
My Understanding: Every API response follows { ok, data, error } shape, and stack traces are only exposed when NODE_ENV=development.
Solution: Adopted a consistent envelope contract for all responses and restricted stack trace exposure to development environments only.
