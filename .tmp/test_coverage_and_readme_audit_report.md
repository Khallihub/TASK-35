# Combined Test Coverage + README Audit Report

Date: 2026-04-16
Mode: Static inspection only (no test/code/script/container execution was performed).

## 1. Test Coverage Audit

### Backend Endpoint Inventory

Total endpoints discovered: 67.
Source of truth: route declarations in repo/apps/api/src/routes/*.ts mounted via mountRoutes() in repo/apps/api/src/routes/index.ts and createApp() in repo/apps/api/src/app.ts.

Full endpoint inventory:
- GET /healthz
- GET /api/v1/config/timezone
- GET /api/v1/auth/nonce/login
- POST /api/v1/auth/login
- POST /api/v1/auth/refresh
- POST /api/v1/auth/logout
- POST /api/v1/auth/consent
- POST /api/v1/auth/change-password
- GET /api/v1/auth/nonce/:purpose
- GET /api/v1/auth/me
- GET /api/v1/auth/consent-version
- GET /api/v1/auth/captcha-challenge
- POST /api/v1/users
- GET /api/v1/users
- GET /api/v1/users/:id
- PATCH /api/v1/users/:id
- POST /api/v1/users/:id/unlock
- POST /api/v1/users/:id/force-reset
- POST /api/v1/offices
- GET /api/v1/offices
- PATCH /api/v1/offices/:id
- POST /api/v1/listings
- GET /api/v1/listings
- GET /api/v1/listings/:id
- PATCH /api/v1/listings/:id
- POST /api/v1/listings/:id/submit
- POST /api/v1/listings/:id/approve
- POST /api/v1/listings/:id/reject
- POST /api/v1/listings/:id/publish
- POST /api/v1/listings/:id/archive
- POST /api/v1/listings/:id/reverse
- DELETE /api/v1/listings/:id
- POST /api/v1/listings/:id/restore
- POST /api/v1/listings/:id/favorite
- POST /api/v1/listings/:id/share
- GET /api/v1/listings/:id/revisions
- POST /api/v1/listings/:listingId/attachments
- GET /api/v1/listings/:listingId/attachments
- PUT /api/v1/listings/:listingId/attachments/:id
- DELETE /api/v1/listings/:listingId/attachments/:id
- GET /api/v1/listings/:listingId/attachments/:id/revisions
- POST /api/v1/listings/:listingId/attachments/:id/rollback
- GET /api/v1/listings/:listingId/attachments/rejections
- POST /api/v1/promo
- GET /api/v1/promo
- GET /api/v1/promo/:id
- PATCH /api/v1/promo/:id
- POST /api/v1/promo/:id/click
- POST /api/v1/promo/:id/activate
- POST /api/v1/promo/:id/cancel
- POST /api/v1/promo/:id/slots
- DELETE /api/v1/promo/:id/slots/:slotId
- PUT /api/v1/promo/:id/slots/reorder
- GET /api/v1/analytics/kpi
- GET /api/v1/analytics/funnel
- POST /api/v1/analytics/exports
- GET /api/v1/analytics/exports/:jobId
- GET /api/v1/analytics/exports/:jobId/download
- GET /api/v1/admin/risk/:userId
- POST /api/v1/admin/risk/:userId/penalty
- GET /api/v1/admin/blacklist
- POST /api/v1/admin/blacklist
- DELETE /api/v1/admin/blacklist/:id
- POST /api/v1/admin/purge/listing/:id
- POST /api/v1/admin/purge/user/:id
- GET /api/v1/admin/audit-chain
- GET /api/v1/admin/job-runs

### API Test Mapping Table

| Endpoint | Covered | Test Type | Test Files | Evidence |
|---|---|---|---|---|
| DELETE /api/v1/admin/blacklist/:id | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/admin.test.ts; repo/apps/api/tests/routes/coverage.admin.test.ts | repo/apps/api/tests/routes/coverage.admin.test.ts:244 (it: returns 400 on invalid id) |
| DELETE /api/v1/listings/:id | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.listings.test.ts; repo/apps/api/tests/routes/listings.test.ts | repo/apps/api/tests/routes/coverage.listings.test.ts:205 (it: returns 403 for regular_user) |
| DELETE /api/v1/listings/:listingId/attachments/:id | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/attachments.test.ts; repo/apps/api/tests/routes/coverage.attachments.test.ts | repo/apps/api/tests/routes/coverage.attachments.test.ts:437 (it: soft-deletes the attachment without removing the blob) |
| DELETE /api/v1/promo/:id/slots/:slotId | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.promo.test.ts; repo/apps/api/tests/routes/promo.test.ts | repo/apps/api/tests/routes/coverage.promo.test.ts:374 (it: returns 400 for non-numeric promo id) |
| GET /api/v1/admin/audit-chain | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/admin.test.ts; repo/apps/api/tests/routes/coverage.admin.test.ts | repo/apps/api/tests/routes/coverage.admin.test.ts:376 (it: returns 200 with valid boolean) |
| GET /api/v1/admin/blacklist | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.analytics.test.ts | repo/apps/api/tests/routes/coverage.analytics.test.ts:265 (it: returns 401 without auth) |
| GET /api/v1/admin/job-runs | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.analytics.test.ts | repo/apps/api/tests/routes/coverage.analytics.test.ts:401 (it: returns 401 without auth) |
| GET /api/v1/admin/risk/:userId | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/admin.test.ts; repo/apps/api/tests/routes/coverage.admin.test.ts | repo/apps/api/tests/routes/coverage.admin.test.ts:155 (it: returns 401 without auth) |
| GET /api/v1/analytics/exports/:jobId | yes | true no-mock HTTP | repo/apps/api/tests/routes/analytics.test.ts; repo/apps/api/tests/routes/coverage.analytics.test.ts | repo/apps/api/tests/routes/analytics.test.ts:290 (it: returns job status) |
| GET /api/v1/analytics/exports/:jobId/download | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.analytics.test.ts | repo/apps/api/tests/routes/coverage.analytics.test.ts:120 (it: returns 401 without auth) |
| GET /api/v1/analytics/funnel | yes | true no-mock HTTP | repo/apps/api/tests/routes/analytics.test.ts; repo/apps/api/tests/routes/coverage.analytics.test.ts | repo/apps/api/tests/routes/analytics.test.ts:232 (it: returns 403 for merchant on funnel endpoint too) |
| GET /api/v1/analytics/kpi | yes | true no-mock HTTP | repo/apps/api/tests/routes/analytics.test.ts; repo/apps/api/tests/routes/coverage.analytics.test.ts; repo/apps/api/tests/routes/crossBoundary.test.ts | repo/apps/api/tests/routes/analytics.test.ts:131 (it: returns KPI data for operations user) |
| GET /api/v1/auth/captcha-challenge | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.auth.test.ts | repo/apps/api/tests/routes/coverage.auth.test.ts:132 (it: returns a challenge token + question) |
| GET /api/v1/auth/consent-version | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.auth.test.ts | repo/apps/api/tests/routes/coverage.auth.test.ts:121 (it: returns seeded consent version when present) |
| GET /api/v1/auth/me | yes | true no-mock HTTP | repo/apps/api/tests/routes/auth.test.ts | repo/apps/api/tests/routes/auth.test.ts:275 (it: returns current user with valid token (after consent accepted)) |
| GET /api/v1/auth/nonce/:purpose | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/admin.test.ts; repo/apps/api/tests/routes/analytics.test.ts; repo/apps/api/tests/routes/attachments.test.ts; repo/apps/api/tests/routes/auth.test.ts; repo/apps/api/tests/routes/coverage.admin.test.ts; repo/apps/api/tests/routes/coverage.analytics.test.ts | repo/apps/api/tests/routes/analytics.test.ts:192 (it: returns 403 for merchant with null office_id) |
| GET /api/v1/auth/nonce/login | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/admin.test.ts; repo/apps/api/tests/routes/analytics.test.ts; repo/apps/api/tests/routes/attachments.test.ts; repo/apps/api/tests/routes/auth.test.ts; repo/apps/api/tests/routes/coverage.admin.test.ts; repo/apps/api/tests/routes/coverage.analytics.test.ts; repo/apps/api/tests/routes/coverage.attachments.test.ts | repo/apps/api/tests/routes/analytics.test.ts:192 (it: returns 403 for merchant with null office_id) |
| GET /api/v1/config/timezone | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.auth.test.ts | repo/apps/api/tests/routes/coverage.auth.test.ts:109 (it: returns timezone as public endpoint) |
| GET /api/v1/listings | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/csrf.test.ts; repo/apps/api/tests/routes/listings.test.ts; repo/apps/api/tests/routes/security.middleware.test.ts | repo/apps/api/tests/routes/csrf.test.ts:106 (it: returns CSRF token on authenticated GET request) |
| GET /api/v1/listings/:id | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.listings.test.ts; repo/apps/api/tests/routes/listings.test.ts; repo/apps/api/tests/routes/listings.workflow.test.ts; repo/apps/api/tests/services/engagement.integration.test.ts | repo/apps/api/tests/routes/coverage.listings.test.ts:279 (it: returns revisions for listing owner) |
| GET /api/v1/listings/:id/revisions | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.listings.test.ts | repo/apps/api/tests/routes/coverage.listings.test.ts:268 (it: returns 401 without auth) |
| GET /api/v1/listings/:listingId/attachments | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/attachments.test.ts; repo/apps/api/tests/routes/coverage.attachments.test.ts | repo/apps/api/tests/routes/coverage.attachments.test.ts:416 (it: returns the uploaded attachment without leaking storage metadata) |
| GET /api/v1/listings/:listingId/attachments/:id/revisions | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/attachments.test.ts; repo/apps/api/tests/routes/coverage.attachments.test.ts | repo/apps/api/tests/routes/coverage.attachments.test.ts:458 (it: returns revision history for merchant of same office) |
| GET /api/v1/listings/:listingId/attachments/rejections | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.attachments.test.ts | repo/apps/api/tests/routes/coverage.attachments.test.ts:295 (it: returns 401 without auth) |
| GET /api/v1/offices | yes | true no-mock HTTP | repo/apps/api/tests/routes/offices.test.ts | repo/apps/api/tests/routes/offices.test.ts:109 (it: returns 401 without auth) |
| GET /api/v1/promo | yes | true no-mock HTTP | repo/apps/api/tests/routes/promo.test.ts | repo/apps/api/tests/routes/promo.test.ts:195 (it: returns 200 list) |
| GET /api/v1/promo/:id | yes | true no-mock HTTP | repo/apps/api/tests/routes/promo.test.ts | repo/apps/api/tests/routes/promo.test.ts:224 (it: returns 200 with slots) |
| GET /api/v1/users | yes | true no-mock HTTP | repo/apps/api/tests/routes/users.test.ts | repo/apps/api/tests/routes/users.test.ts:185 (it: returns 401 without auth) |
| GET /api/v1/users/:id | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.users.test.ts | repo/apps/api/tests/routes/coverage.users.test.ts:276 (it: returns 401 without auth) |
| GET /healthz | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/health.test.ts; repo/apps/api/tests/routes/coverage.admin.test.ts | repo/apps/api/tests/routes/coverage.admin.test.ts:139 (it: returns 200 and a sane payload) |
| PATCH /api/v1/listings/:id | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.listings.test.ts; repo/apps/api/tests/routes/listings.test.ts | repo/apps/api/tests/routes/coverage.listings.test.ts:285 (it: returns revisions for listing owner) |
| PATCH /api/v1/offices/:id | yes | true no-mock HTTP | repo/apps/api/tests/routes/offices.test.ts | repo/apps/api/tests/routes/offices.test.ts:208 (it: administrator updates fields and audits the change) |
| PATCH /api/v1/promo/:id | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.promo.test.ts | repo/apps/api/tests/routes/coverage.promo.test.ts:121 (it: returns 401 without auth) |
| PATCH /api/v1/users/:id | yes | true no-mock HTTP | repo/apps/api/tests/routes/users.test.ts | repo/apps/api/tests/routes/users.test.ts:221 (it: rejects role change without nonce -> 400) |
| POST /api/v1/admin/blacklist | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/admin.test.ts; repo/apps/api/tests/routes/coverage.admin.test.ts | repo/apps/api/tests/routes/coverage.admin.test.ts:189 (it: returns 400 without subjectType) |
| POST /api/v1/admin/purge/listing/:id | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/admin.test.ts; repo/apps/api/tests/routes/coverage.admin.test.ts; repo/apps/api/tests/routes/security.middleware.test.ts | repo/apps/api/tests/routes/coverage.admin.test.ts:297 (it: returns 400 with wrong confirm text) |
| POST /api/v1/admin/purge/user/:id | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/admin.test.ts; repo/apps/api/tests/routes/crossBoundary.test.ts | repo/apps/api/tests/routes/crossBoundary.test.ts:421 (it: purging a user hard-deletes their listings and revokes their sessions) |
| POST /api/v1/admin/risk/:userId/penalty | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.analytics.test.ts | repo/apps/api/tests/routes/coverage.analytics.test.ts:216 (it: returns 401 without auth) |
| POST /api/v1/analytics/exports | yes | true no-mock HTTP | repo/apps/api/tests/routes/analytics.test.ts; repo/apps/api/tests/routes/coverage.analytics.test.ts | repo/apps/api/tests/routes/analytics.test.ts:241 (it: returns 403 for merchant on export creation) |
| POST /api/v1/auth/change-password | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.auth.test.ts | repo/apps/api/tests/routes/coverage.auth.test.ts:301 (it: returns 401 without auth) |
| POST /api/v1/auth/consent | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.auth.test.ts | repo/apps/api/tests/routes/coverage.auth.test.ts:145 (it: returns 401 without auth) |
| POST /api/v1/auth/login | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/admin.test.ts; repo/apps/api/tests/routes/analytics.test.ts; repo/apps/api/tests/routes/attachments.test.ts; repo/apps/api/tests/routes/auth.test.ts | repo/apps/api/tests/routes/analytics.test.ts:195 (it: returns 403 for merchant with null office_id) |
| POST /api/v1/auth/logout | yes | true no-mock HTTP | repo/apps/api/tests/routes/auth.test.ts | repo/apps/api/tests/routes/auth.test.ts:160 (it: requires auth - returns 401 without token) |
| POST /api/v1/auth/refresh | yes | true no-mock HTTP | repo/apps/api/tests/routes/auth.test.ts | repo/apps/api/tests/routes/auth.test.ts:213 (it: returns new tokens with a valid refresh token) |
| POST /api/v1/listings | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/coverage.listings.test.ts; repo/apps/api/tests/routes/crossBoundary.test.ts; repo/apps/api/tests/routes/csrf.test.ts | repo/apps/api/tests/routes/crossBoundary.test.ts:144 (it: publish → favorite → KPI rollup reflects engagement_actions for ops) |
| POST /api/v1/listings/:id/approve | yes | true no-mock HTTP | repo/apps/api/tests/routes/crossBoundary.test.ts; repo/apps/api/tests/routes/listings.workflow.test.ts | repo/apps/api/tests/routes/crossBoundary.test.ts:176 (it: publish → favorite → KPI rollup reflects engagement_actions for ops) |
| POST /api/v1/listings/:id/archive | yes | true no-mock HTTP | repo/apps/api/tests/routes/listings.workflow.test.ts | repo/apps/api/tests/routes/listings.workflow.test.ts:243 (it: create → submit → approve → publish → reverse → approve → archive) |
| POST /api/v1/listings/:id/favorite | yes | true no-mock HTTP | repo/apps/api/tests/routes/crossBoundary.test.ts; repo/apps/api/tests/services/engagement.integration.test.ts | repo/apps/api/tests/routes/crossBoundary.test.ts:202 (it: publish → favorite → KPI rollup reflects engagement_actions for ops) |
| POST /api/v1/listings/:id/publish | yes | true no-mock HTTP | repo/apps/api/tests/routes/crossBoundary.test.ts; repo/apps/api/tests/routes/listings.workflow.test.ts | repo/apps/api/tests/routes/crossBoundary.test.ts:189 (it: publish → favorite → KPI rollup reflects engagement_actions for ops) |
| POST /api/v1/listings/:id/reject | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.listings.test.ts | repo/apps/api/tests/routes/coverage.listings.test.ts:146 (it: returns 403 for regular_user) |
| POST /api/v1/listings/:id/restore | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.listings.test.ts | repo/apps/api/tests/routes/coverage.listings.test.ts:212 (it: returns 403 for regular_user) |
| POST /api/v1/listings/:id/reverse | yes | true no-mock HTTP | repo/apps/api/tests/routes/listings.workflow.test.ts | repo/apps/api/tests/routes/listings.workflow.test.ts:203 (it: create → submit → approve → publish → reverse → approve → archive) |
| POST /api/v1/listings/:id/share | yes | true no-mock HTTP | repo/apps/api/tests/routes/crossBoundary.test.ts; repo/apps/api/tests/services/engagement.integration.test.ts | repo/apps/api/tests/routes/crossBoundary.test.ts:209 (it: publish → favorite → KPI rollup reflects engagement_actions for ops) |
| POST /api/v1/listings/:id/submit | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.listings.test.ts; repo/apps/api/tests/routes/crossBoundary.test.ts; repo/apps/api/tests/routes/listings.test.ts; repo/apps/api/tests/routes/listings.workflow.test.ts | repo/apps/api/tests/routes/crossBoundary.test.ts:163 (it: publish → favorite → KPI rollup reflects engagement_actions for ops) |
| POST /api/v1/listings/:listingId/attachments | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/attachments.test.ts | repo/apps/api/tests/routes/attachments.test.ts:176 (it: returns 201 for a valid JPEG upload) |
| POST /api/v1/listings/:listingId/attachments/:id/rollback | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.attachments.test.ts | repo/apps/api/tests/routes/coverage.attachments.test.ts:221 (it: returns 403 for regular_user) |
| POST /api/v1/offices | yes | true no-mock HTTP | repo/apps/api/tests/routes/offices.test.ts | repo/apps/api/tests/routes/offices.test.ts:137 (it: denies non-admin roles with 403) |
| POST /api/v1/promo | yes | true no-mock HTTP (+mocked variants) | repo/apps/api/tests/routes/coverage.promo.test.ts; repo/apps/api/tests/routes/promo.test.ts | repo/apps/api/tests/routes/promo.test.ts:135 (it: returns 201 when operations user creates a promo) |
| POST /api/v1/promo/:id/activate | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.promo.test.ts; repo/apps/api/tests/routes/promo.test.ts | repo/apps/api/tests/routes/coverage.promo.test.ts:190 (it: returns 400 for non-draft promo) |
| POST /api/v1/promo/:id/cancel | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.promo.test.ts | repo/apps/api/tests/routes/coverage.promo.test.ts:425 (it: returns 401 without auth) |
| POST /api/v1/promo/:id/click | yes | true no-mock HTTP | repo/apps/api/tests/services/engagement.integration.test.ts | repo/apps/api/tests/services/engagement.integration.test.ts:170 (it: counts listing.view + listing.favorite + listing.share + promo.click in engagement_actions) |
| POST /api/v1/promo/:id/slots | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.promo.test.ts | repo/apps/api/tests/routes/coverage.promo.test.ts:234 (it: returns 400 when listingId missing) |
| POST /api/v1/users | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.users.test.ts | repo/apps/api/tests/routes/coverage.users.test.ts:138 (it: returns 401 without auth) |
| POST /api/v1/users/:id/force-reset | yes | true no-mock HTTP | repo/apps/api/tests/routes/users.test.ts | repo/apps/api/tests/routes/users.test.ts:409 (it: sets must_change_password and revokes sessions) |
| POST /api/v1/users/:id/unlock | yes | true no-mock HTTP | repo/apps/api/tests/routes/users.test.ts | repo/apps/api/tests/routes/users.test.ts:367 (it: returns 403 for non-admin) |
| PUT /api/v1/listings/:listingId/attachments/:id | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.attachments.test.ts | repo/apps/api/tests/routes/coverage.attachments.test.ts:164 (it: returns 401 without auth) |
| PUT /api/v1/promo/:id/slots/reorder | yes | true no-mock HTTP | repo/apps/api/tests/routes/coverage.promo.test.ts; repo/apps/api/tests/routes/promo.test.ts | repo/apps/api/tests/routes/coverage.promo.test.ts:400 (it: returns 400 when slots is not an array) |

### API Test Classification

Total *.test.ts files: 55
True no-mock HTTP files: 17
HTTP with mocking files: 4
Non-HTTP files: 34

## True No-Mock HTTP Files
repo/apps/api/tests/routes/analytics.test.ts
repo/apps/api/tests/routes/auth.test.ts
repo/apps/api/tests/routes/coverage.admin.test.ts
repo/apps/api/tests/routes/coverage.analytics.test.ts
repo/apps/api/tests/routes/coverage.attachments.test.ts
repo/apps/api/tests/routes/coverage.auth.test.ts
repo/apps/api/tests/routes/coverage.listings.test.ts
repo/apps/api/tests/routes/coverage.promo.test.ts
repo/apps/api/tests/routes/coverage.users.test.ts
repo/apps/api/tests/routes/crossBoundary.test.ts
repo/apps/api/tests/routes/csrf.test.ts
repo/apps/api/tests/routes/listings.test.ts
repo/apps/api/tests/routes/listings.workflow.test.ts
repo/apps/api/tests/routes/offices.test.ts
repo/apps/api/tests/routes/promo.test.ts
repo/apps/api/tests/routes/users.test.ts
repo/apps/api/tests/services/engagement.integration.test.ts

## HTTP With Mocking Files
repo/apps/api/tests/health.test.ts
repo/apps/api/tests/routes/admin.test.ts
repo/apps/api/tests/routes/attachments.test.ts
repo/apps/api/tests/routes/security.middleware.test.ts

## Non-HTTP Files
repo/apps/api/tests/audit.chain.test.ts
repo/apps/api/tests/auth/idempotency.test.ts
repo/apps/api/tests/auth/lockout.depth.test.ts
repo/apps/api/tests/auth/lockout.test.ts
repo/apps/api/tests/auth/nonce.test.ts
repo/apps/api/tests/auth/password.test.ts
repo/apps/api/tests/auth/session.test.ts
repo/apps/api/tests/config.test.ts
repo/apps/api/tests/db/migrations.purge.test.ts
repo/apps/api/tests/jobs/auditVerify.scheduler.test.ts
repo/apps/api/tests/jobs/retention.fk.test.ts
repo/apps/api/tests/jobs/retention.test.ts
repo/apps/api/tests/jobs/runner.test.ts
repo/apps/api/tests/logger.redaction.test.ts
repo/apps/api/tests/services/attachment.test.ts
repo/apps/api/tests/services/attachmentValidator.depth.test.ts
repo/apps/api/tests/services/attachmentValidator.test.ts
repo/apps/api/tests/services/captcha.test.ts
repo/apps/api/tests/services/cleansing.test.ts
repo/apps/api/tests/services/consent.test.ts
repo/apps/api/tests/services/exportService.test.ts
repo/apps/api/tests/services/imageProcessor.test.ts
repo/apps/api/tests/services/kpi.test.ts
repo/apps/api/tests/services/listing.test.ts
repo/apps/api/tests/services/listingStateMachine.depth.test.ts
repo/apps/api/tests/services/mimeDetect.test.ts
repo/apps/api/tests/services/promo.test.ts
repo/apps/api/tests/services/promoStateMachine.depth.test.ts
repo/apps/api/tests/services/promoStateMachine.test.ts
repo/apps/api/tests/services/promoStatus.test.ts
repo/apps/api/tests/services/risk.test.ts
repo/apps/api/tests/services/sha256.test.ts
repo/apps/api/tests/services/stateMachine.test.ts
repo/apps/api/tests/services/token.test.ts

### Mock Detection (Explicit Findings)

Detected explicit mocking that affects HTTP test execution paths:

1. jest.mock('../src/db/knex', ...) in repo/apps/api/tests/health.test.ts.
   - What is mocked: DB transport/provider (src/db/knex) before app import.
2. jest.mock('../../src/storage/repository', ...) in repo/apps/api/tests/routes/admin.test.ts.
   - What is mocked: storage provider (storageRepository) replaced with InMemoryRepository.
3. jest.mock('../../src/storage/repository', ...) in repo/apps/api/tests/routes/attachments.test.ts.
   - What is mocked: storage provider (storageRepository) replaced with InMemoryRepository.
4. jest.mock('../../src/storage/repository', ...) in repo/apps/api/tests/routes/security.middleware.test.ts.
   - What is mocked: storage provider (storageRepository) replaced with InMemoryRepository.

### Coverage Summary

- Total endpoints: 67
- Endpoints with HTTP tests: 67
- Endpoints with true no-mock HTTP tests: 67
- HTTP coverage: 100.0%
- True API coverage: 100.0%
- Endpoints that also have mocked HTTP variants: 17 / 67 (25.4%)

### Unit Test Summary

Non-HTTP test surface is broad (34 files), including:

- Auth services: repo/apps/api/tests/auth/session.test.ts, repo/apps/api/tests/auth/password.test.ts, repo/apps/api/tests/auth/lockout.test.ts, repo/apps/api/tests/auth/nonce.test.ts, repo/apps/api/tests/auth/idempotency.test.ts
- Domain/services: repo/apps/api/tests/services/listing.test.ts, repo/apps/api/tests/services/promo.test.ts, repo/apps/api/tests/services/risk.test.ts, repo/apps/api/tests/services/exportService.test.ts, repo/apps/api/tests/services/attachment.test.ts, repo/apps/api/tests/services/kpi.test.ts
- Jobs and data integrity: repo/apps/api/tests/jobs/*.test.ts, repo/apps/api/tests/db/migrations.purge.test.ts, repo/apps/api/tests/audit.chain.test.ts

Important modules not directly unit-tested by import/reference pattern:

1. repo/apps/api/src/services/eventLog.ts (no direct test import/reference under repo/apps/api/tests/**/*.ts; only indirect coverage via HTTP flows such as repo/apps/api/tests/services/engagement.integration.test.ts).
2. repo/apps/api/src/middleware/auth.ts has route-level coverage but no isolated middleware unit test file that imports this module directly.

### API Observability Check

Overall status: mostly strong, with some weak pockets.

Strong evidence patterns:

- Tests generally show explicit method/path, concrete inputs, and response assertions (for example: repo/apps/api/tests/routes/coverage.auth.test.ts, repo/apps/api/tests/routes/coverage.listings.test.ts, repo/apps/api/tests/routes/coverage.promo.test.ts).
- Route-level integration tests commonly assert both status and selected payload fields.

Weak patterns (flagged):

- A subset of coverage tests assert status-only (401/403/400) without validating detailed response payload semantics.
- Some endpoint mappings rely on shared auth helper flows where endpoint intent is implied by setup calls rather than a dedicated endpoint-focused assertion.

### Tests Check

- Success/failure/validation/auth/permission paths: present and extensive across route suites (repo/apps/api/tests/routes/*.test.ts).
- Edge cases and boundaries: present in specialized files such as repo/apps/api/tests/routes/security.middleware.test.ts, repo/apps/api/tests/routes/crossBoundary.test.ts, and repo/apps/api/tests/routes/listings.workflow.test.ts.
- Assertion depth: generally meaningful; however, some negative-path tests are shallow status checks.
- run_tests.sh execution model: Docker-based (containerized docker run plus docker compose orchestration), no mandatory host package manager steps for running the stack/tests.
  - Evidence: repo/run_tests.sh stages invoke Docker images/compose and execute npm commands inside containers.

### End-to-End Expectations (Fullstack)

Fullstack expectation: real FE to BE tests should exist.

Status: satisfied.

Evidence:

- Playwright suite present under repo/apps/web/e2e/*.spec.ts.
- Browser-driven workflow coverage exists (for example: repo/apps/web/e2e/workflow.spec.ts).
- Test runner includes E2E stage by default in repo/run_tests.sh (unless --no-e2e is explicitly passed).

### Test Coverage Score (0-100)

90 / 100

### Score Rationale

- Full endpoint inventory coverage with HTTP tests (67/67).
- True no-mock HTTP path exists for every endpoint (67/67).
- Broad non-HTTP unit/integration test surface (34 files) across auth/services/jobs/audit.
- 17 endpoints still have mocked HTTP variants in parallel, increasing divergence risk if mocked suites are over-relied on.
- Some endpoint checks remain status-centric with limited payload-contract depth.
- src/services/eventLog.ts lacks direct unit-level tests.

### Key Gaps

1. Direct unit test gap for repo/apps/api/src/services/eventLog.ts (indirectly covered, not directly unit-asserted).
2. Mixed strategy on 17 endpoints (both mocked and no-mock HTTP paths), which can obscure regressions if mocked suites become primary.
3. A subset of route tests emphasize status assertions over richer response-shape/content assertions.

### Confidence and Assumptions

- Confidence: high for endpoint inventory and HTTP mapping, based on deterministic static extraction from routes and HTTP test calls.
- Confidence: medium for assertion-depth judgment (qualitative static review).
- Assumption: route declarations in repo/apps/api/src/routes/*.ts are authoritative; no runtime-only dynamic route registration exists outside this set.

### Test Coverage Verdict

PASS (with caveats).

---

## 2. README Audit

### Project Type Detection

Detected project type: fullstack.

Evidence:

- README opening description states Full-stack in repo/README.md.
- Repository structure includes both repo/apps/api and repo/apps/web.

### README Location

- Required location repo/README.md: present.

### Hard Gate Check

| Gate | Status | Evidence |
|---|---|---|
| Clean markdown/readable structure | PASS | repo/README.md has structured sections, tables, command blocks, and stable sectioning. |
| Startup instructions include docker compose | PASS | Startup section includes docker compose up --build and overlay variants. |
| Access method (URL + port) | PASS | Access path documented (http://localhost, 80/443 details). |
| Verification method | PASS | Deterministic verification checklist with expected outcomes is provided. |
| Docker-contained environment rules | PASS | README explicitly states Docker-only operation and no host npm/node/mysql requirement. |
| Demo credentials with all roles | PASS | admin, ops_user, merchant_user, agent_user with passwords and role notes are documented. |
| Auth clarity | PASS | Auth is clearly present and credentialed; no ambiguity. |

### Engineering Quality Notes

Strengths:

- Strong operational onboarding quality (startup, verification, teardown, env vars, API reference).
- Good role/security context and default credential documentation.
- Testing section clearly documents Docker-contained test workflow and E2E presence.

Potential improvements:

- Verification commands use jq and uuidgen, but these host CLI dependencies are not called out in the prerequisites table.

### High Priority Issues

- None.

### Medium Priority Issues

1. repo/README.md verification commands rely on jq and uuidgen without listing them under prerequisites, which may reduce reproducibility on minimal host setups.

### Low Priority Issues

- None.

### Hard Gate Failures

- None.

### README Verdict

PASS

---

## Final Verdicts

- Test Coverage Audit: PASS (90/100, with caveats)
- README Audit: PASS
