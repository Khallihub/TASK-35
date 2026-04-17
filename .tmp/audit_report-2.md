# HarborStone Listings Operations Suite Static Audit

## 1. Verdict

- Overall conclusion: Partial Pass
- Summary: The repository is a real end-to-end full-stack delivery with substantial prompt alignment, clear module boundaries, migrations, jobs, tests, and a usable Vue workspace. Acceptance should be blocked on one High-severity security defect and several Medium-severity role-boundary, response-shaping, and test-evidence gaps.

## 2. Scope and Static Verification Boundary

- What was reviewed:
  README, package manifests, CI workflow, test runner script, API entry points and route registration, auth/session/middleware, listing/attachment/promo/analytics/admin services and routes, storage and audit modules, web router/store/API client, major Vue views/components, and representative API/web tests.
- What was not reviewed:
  Runtime behavior under real Docker/MySQL/nginx/browser execution, actual TLS certificate installation/trust, network behavior, real filesystem permissions, real upload throughput, and any external environment behavior.
- What was intentionally not executed:
  The project itself, Docker, tests, browser flows, and external services.
- Claims that require manual verification:
  HTTPS certificate installation and browser trust, Docker Compose startup health, real offline browser behavior and IndexedDB persistence, real promo visibility changes over wall-clock time, large-file upload behavior, and backup/restore execution.

## 3. Repository / Requirement Mapping Summary

- Core business goal mapped:
  Offline-capable internal listing catalog and publishing workflow for four roles, with listing drafting/editing, multi-stage approval/publish flow, attachments, promotions, analytics, retention/purge, audit logging, and risk controls.
- Main implementation areas mapped:
  Koa API route suites in apps/api/src/routes, business services in apps/api/src/services, DB migrations/seeds/jobs in apps/api/src/db and apps/api/src/jobs, Vue role-based workspace in apps/web/src/views and apps/web/src/components, and test coverage in apps/api/tests and apps/web/tests.
- Static-only boundary applied:
  All runtime-sensitive conclusions below are marked either Partial Pass, Cannot Confirm Statistically, or include a manual verification note when source inspection alone is insufficient.

## 4. Section-by-section Review

### 4.1 Hard Gates

#### 1.1 Documentation and static verifiability

- Conclusion: Partial Pass
- Rationale: The delivery includes clear quickstart, local development, testing, environment, API, and structure documentation, plus matching workspace/package scripts. A reviewer can statically identify entry points and verification commands. However, the documented opt-in workflow_dispatch E2E path is not actually registered in the CI workflow, so one verification path is documented inconsistently.
- Evidence: README.md:80, README.md:85, README.md:389, README.md:405, README.md:415, README.md:418, package.json:1, apps/api/package.json:1, apps/web/package.json:1, .github/workflows/ci.yml:11, .github/workflows/ci.yml:14, .github/workflows/ci.yml:70, .github/workflows/ci.yml:72
- Manual verification note: Docker/HTTPS/browser claims remain manual-only.

#### 1.2 Whether the delivered project materially deviates from the Prompt

- Conclusion: Partial Pass
- Rationale: The implementation is clearly centered on the prompt: listing lifecycle, attachments, promos, analytics, consent, audit log, retention, and risk controls are all present. The main prompt-fit deviation found statically is role semantics for analytics: both the backend and frontend allow merchant access to analytics and export features even though the prompt assigns KPI monitoring/export capability to Operations.
- Evidence: README.md:3, apps/api/src/routes/listings.ts:30, apps/api/src/routes/attachments.ts:30, apps/api/src/routes/promo.ts:40, apps/api/src/routes/analytics.ts:42, apps/api/src/routes/analytics.ts:142, apps/web/src/router/index.ts:14
- Manual verification note: None.

### 4.2 Delivery Completeness

#### 2.1 Whether the delivered project fully covers the core requirements explicitly stated in the Prompt

- Conclusion: Partial Pass
- Rationale: Most explicit requirements have static implementations: local auth, password policy, nonce/idempotency, listing CRUD/workflow, attachment validation and rollback, promos with rank/slot caps, KPI queries, exports, consent, retention, blacklist/risk, and audit chain. The main gap is that prompt-required high-volume API throttling is not materially implemented because the global throttle middleware never increments its counters.
- Evidence: apps/api/src/services/password.ts:17, apps/api/src/services/nonce.ts:7, apps/api/src/services/session.ts:30, apps/api/src/services/cleansing.ts:74, apps/api/src/services/cleansing.ts:176, apps/api/src/services/attachment.ts:173, apps/api/src/services/attachment.ts:311, apps/api/src/services/promo.ts:487, apps/api/src/services/kpi.ts:8, apps/api/src/jobs/retention.ts:24, apps/api/src/middleware/ipRateLimit.ts:28, apps/api/src/middleware/ipRateLimit.ts:29, apps/api/src/middleware/ipRateLimit.ts:50, apps/api/src/middleware/ipRateLimit.ts:51
- Manual verification note: Offline behavior, HTTPS, and real upload/runtime timing remain manual-only.

#### 2.2 Whether the delivered project represents a basic end-to-end deliverable from 0 to 1

- Conclusion: Pass
- Rationale: This is not a fragment or demo. The repo contains a full monorepo structure, migrations/seeds, route registration, frontend views, storage abstraction, job runners, tests, CI, and operational scripts.
- Evidence: README.md:26, apps/api/src/app.ts:14, apps/api/src/routes/index.ts:11, apps/web/src/router/index.ts:4, apps/api/src/jobs/retention.ts:24, apps/api/src/storage/repository.ts:7, scripts/backup.sh:1, scripts/restore.sh:1
- Manual verification note: None.

### 4.3 Engineering and Architecture Quality

#### 3.1 Whether the project adopts a reasonable engineering structure and module decomposition

- Conclusion: Pass
- Rationale: The project is decomposed sensibly by route, middleware, service, job, storage, audit, and view/component/store concerns. The API entry point is small and route suites are mounted centrally instead of collapsing all behavior into a few files.
- Evidence: README.md:453, apps/api/src/app.ts:14, apps/api/src/routes/index.ts:11, apps/api/src/services/listing.ts:1, apps/api/src/services/attachment.ts:1, apps/web/src/views/AnalyticsView.vue:1, apps/web/src/components/listings/ListingForm.vue:1
- Manual verification note: None.

#### 3.2 Whether the project shows maintainability and extensibility rather than a stacked implementation

- Conclusion: Partial Pass
- Rationale: Most core logic is structured for extension, but security and authorization policy are not fully centralized. A clear example is attachment rollback: the route restricts rollback to merchant/administrator, while the service-level guard still admits operations, which creates a defense-in-depth gap and makes future internal reuse riskier. Test suites also commonly bypass the production security middleware stack, which reduces maintainability of security guarantees.
- Evidence: apps/api/src/routes/attachments.ts:235, apps/api/src/services/attachment.ts:419, apps/api/tests/helpers/testApp.ts:21, apps/api/tests/routes/auth.test.ts:65, apps/api/tests/routes/listings.workflow.test.ts:51, apps/api/tests/routes/attachments.test.ts:61
- Manual verification note: None.

### 4.4 Engineering Details and Professionalism

#### 4.1 Whether engineering details reflect professional software practice

- Conclusion: Partial Pass
- Rationale: The codebase shows professional patterns in password policy, nonce/session handling, consent, audit logging, event logging, structured error responses, and log redaction. The main counterexample is the broken global IP throttling path, plus unnecessary exposure of internal storage metadata in client-facing DTOs.
- Evidence: apps/api/src/services/password.ts:17, apps/api/src/services/password.ts:20, apps/api/src/services/session.ts:30, apps/api/src/services/nonce.ts:7, apps/api/src/logger/index.ts:4, apps/api/src/logger/index.ts:32, apps/api/src/errors/middleware.ts:6, apps/api/src/middleware/ipRateLimit.ts:28, apps/api/src/middleware/ipRateLimit.ts:29, apps/api/src/services/attachment.ts:61, apps/api/src/services/attachment.ts:62, apps/api/src/routes/analytics.ts:204
- Manual verification note: None.

#### 4.2 Whether the project is organized like a real product or service

- Conclusion: Pass
- Rationale: The repository includes a complete backend/frontend split, database migrations, operational jobs, CI, backup/restore scripts, authentication flows, and a role-based workspace. It does not read like a teaching sample.
- Evidence: README.md:26, apps/api/src/routes/admin.ts:31, apps/api/src/jobs/retention.ts:24, apps/web/src/components/layout/AppShell.vue:1, .github/workflows/ci.yml:1
- Manual verification note: None.

### 4.5 Prompt Understanding and Requirement Fit

#### 5.1 Whether the project accurately understands and responds to the business goal, usage scenario, and implicit constraints

- Conclusion: Partial Pass
- Rationale: The implementation strongly reflects the prompt’s workflow and data model, including listing authoring fields, attachment handling, promos, analytics, consent, retention, and risk scoring. The main prompt-fit problems are least-privilege drift around analytics access and internal-storage leakage through client DTOs, which undermine the stated role model and storage abstraction boundary.
- Evidence: apps/web/src/components/listings/ListingForm.vue:14, apps/web/src/views/AttachmentsView.vue:1, apps/web/src/views/AnalyticsView.vue:133, apps/web/src/components/promo/PromoStatusPill.vue:14, apps/web/src/router/index.ts:14, apps/api/src/routes/analytics.ts:42, apps/api/src/services/attachment.ts:55, apps/api/src/services/attachment.ts:110
- Manual verification note: Real offline UX quality and time-based promo transitions remain manual-only.

### 4.6 Aesthetics

#### 6.1 Whether the visual and interaction design fits the scenario and demonstrates reasonable visual quality

- Conclusion: Partial Pass
- Rationale: Statistically, the frontend shows coherent layout primitives, consistent forms/tables/cards, toasts, badges, modals, and a dashboard-style shell. Interaction feedback exists for buttons, drag-and-drop upload, modal confirmation, and loading states. The design is serviceable but visually conservative, and static inspection cannot prove actual rendering quality across desktop/mobile browsers.
- Evidence: apps/web/src/views/LoginView.vue:77, apps/web/src/components/layout/AppShell.vue:10, apps/web/src/assets/styles/components.css:1, apps/web/src/components/attachments/AttachmentUploader.vue:80, apps/web/src/views/AnalyticsView.vue:111
- Manual verification note: Browser rendering, responsive layout, and real interaction polish require manual verification.

## 5. Issues / Suggestions (Severity-Rated)

### High

#### 1. Global API/IP throttling is effectively disabled

- Severity: High
- Conclusion: Fail
- Evidence: apps/api/src/middleware/ipRateLimit.ts:28, apps/api/src/middleware/ipRateLimit.ts:29, apps/api/src/middleware/ipRateLimit.ts:50, apps/api/src/middleware/ipRateLimit.ts:51, apps/api/src/services/rateLimit.ts:38
- Impact: The prompt requires throttling of high-volume APIs and additional protection for repeated failed requests. The middleware checks counters but never increments them, so the advertised general API throttle and middleware-level failed-request throttle never activate. Non-login API abuse can proceed without the documented 429 behavior.
- Minimum actionable fix: Increment the relevant counters inside ipRateLimitMiddleware for both the general API bucket and the failed-request bucket, then add regression tests that assert 429 and Retry-After after repeated requests.

### Medium

#### 2. Internal storage metadata is exposed in client-facing APIs

- Severity: Medium
- Conclusion: Fail
- Evidence: apps/api/src/services/attachment.ts:55, apps/api/src/services/attachment.ts:61, apps/api/src/services/attachment.ts:62, apps/api/src/services/attachment.ts:71, apps/api/src/services/attachment.ts:73, apps/api/src/services/attachment.ts:110, apps/api/src/services/attachment.ts:311, apps/api/src/services/attachment.ts:327, apps/api/src/routes/attachments.ts:108, apps/api/src/routes/analytics.ts:204, apps/web/src/api/attachments.ts:5, apps/web/src/api/analytics.ts:14
- Impact: Attachment list responses include storage_key, sha256, created_by, and current_revision_id, and export job responses include file_key and sha256. For attachments, published listings are readable by broad authenticated users, so internal storage details leak beyond privileged operators. This weakens the storage abstraction and exposes implementation details that the UI does not need.
- Minimum actionable fix: Introduce explicit public DTOs for attachments and export jobs that omit storage keys, hashes, revision IDs, and creator IDs unless a specific endpoint truly requires them.

#### 3. Function-level authorization for attachment rollback is broader than the route policy

- Severity: Medium
- Conclusion: Fail
- Evidence: apps/api/src/services/attachment.ts:419, apps/api/src/services/attachment.ts:421, apps/api/src/routes/attachments.ts:235
- Impact: The route correctly blocks operations users from rollback, but the service-level guard still permits them. Any future internal caller or refactor that bypasses the route check can accidentally grant operations a merchant/admin-only capability.
- Minimum actionable fix: Align rollbackAttachment with the route policy by denying operations at the service layer and add a direct regression test for the service or a route-level test that would fail if the service regresses.

#### 4. Analytics access is broader than the prompt-defined role model

- Severity: Medium
- Conclusion: Partial Fail
- Evidence: apps/web/src/router/index.ts:14, apps/api/src/routes/analytics.ts:29, apps/api/src/routes/analytics.ts:42, apps/api/src/routes/analytics.ts:103, apps/api/src/routes/analytics.ts:142, apps/api/tests/routes/analytics.test.ts:203
- Impact: The prompt assigns KPI monitoring and exports to Operations, but the current frontend and backend allow merchants into the analytics dashboard and export APIs. Even though merchant scope is reduced to their office, the least-privilege boundary has still been widened without documentation.
- Minimum actionable fix: Restrict analytics UI/routes to operations and administrator, or explicitly document and justify the merchant analytics expansion in the README/assumptions.

#### 5. Major route suites bypass the production security stack, and user purge lacks direct regression coverage

- Severity: Medium
- Conclusion: Partial Fail
- Evidence: apps/api/tests/helpers/testApp.ts:21, apps/api/tests/helpers/testApp.ts:39, apps/api/tests/routes/auth.test.ts:65, apps/api/tests/routes/listings.workflow.test.ts:51, apps/api/tests/routes/attachments.test.ts:61, apps/api/tests/routes/analytics.test.ts:45, apps/api/tests/routes/admin.test.ts:57, apps/api/tests/routes/security.middleware.test.ts:4, apps/api/tests/routes/security.middleware.test.ts:164, apps/api/tests/routes/security.middleware.test.ts:397, apps/api/tests/routes/admin.test.ts:217, apps/api/tests/routes/admin.test.ts:367, apps/api/src/routes/admin.ts:182
- Impact: Core feature suites can pass while CSRF/idempotency/IP-throttle interactions fail on routes that are not covered by the representative security suite. The irreversible admin user-purge route exists, but there is no direct route-level regression evidence for it.
- Minimum actionable fix: Move more route suites onto the full production test app where feasible, add explicit rate-limit assertions, and add a dedicated POST /api/v1/admin/purge/user/:id regression suite.

### Low

#### 6. README and CI disagree about the documented workflow_dispatch E2E path

- Severity: Low
- Conclusion: Fail
- Evidence: README.md:415, README.md:418, .github/workflows/ci.yml:11, .github/workflows/ci.yml:14, .github/workflows/ci.yml:70, .github/workflows/ci.yml:72
- Impact: Reviewers following the documented CI path cannot actually trigger the promised workflow_dispatch Playwright job from the current workflow definition.
- Minimum actionable fix: Add workflow_dispatch to the workflow trigger list or remove the workflow_dispatch claim from the README and CI comments.

## 6. Security Review Summary

### Authentication entry points

- Conclusion: Pass
- Evidence: apps/api/src/routes/auth.ts:53, apps/api/src/routes/auth.ts:269, apps/api/src/routes/auth.ts:277, apps/api/src/routes/auth.ts:517, apps/api/src/services/password.ts:17, apps/api/src/services/password.ts:20, apps/api/src/services/session.ts:30, apps/api/src/services/nonce.ts:7
- Reasoning: Local username/password auth, password policy, refresh handling, device-fingerprint binding on refresh, CAPTCHA challenge endpoint, 30-minute inactivity timeout, and 5-minute nonces are all implemented.

### Route-level authorization

- Conclusion: Partial Pass
- Evidence: apps/api/src/routes/admin.ts:31, apps/api/src/routes/users.ts:43, apps/api/src/routes/offices.ts:24, apps/api/src/routes/promo.ts:40, apps/api/src/routes/analytics.ts:42, apps/api/src/routes/analytics.ts:142, apps/web/src/router/index.ts:14
- Reasoning: Admin, user-management, office-management, and promo mutation routes are guarded appropriately. The main least-privilege concern is that analytics is granted to merchants in both backend and frontend despite the prompt assigning analytics to Operations.

### Object-level authorization

- Conclusion: Pass
- Evidence: apps/api/src/services/listing.ts:134, apps/api/src/services/listing.ts:138, apps/api/src/services/listing.ts:143, apps/api/src/services/attachment.ts:108, apps/api/src/services/attachment.ts:110, apps/api/src/services/attachment.ts:317, apps/api/tests/routes/attachments.test.ts:357, apps/api/tests/routes/attachments.test.ts:380
- Reasoning: Listing visibility and attachment access are scoped by listing status, creator, and office. Cross-office merchant access to attachment revisions is explicitly denied in tests.

### Function-level authorization

- Conclusion: Fail
- Evidence: apps/api/src/services/attachment.ts:419, apps/api/src/services/attachment.ts:421, apps/api/src/routes/attachments.ts:235
- Reasoning: The rollback service permits operations while the route denies them. The route currently protects callers, but the function-level policy is inconsistent.

### Tenant / user data isolation

- Conclusion: Pass
- Evidence: apps/api/src/services/listing.ts:134, apps/api/src/services/listing.ts:143, apps/api/src/routes/analytics.ts:72, apps/api/src/routes/analytics.ts:124, apps/api/tests/routes/analytics.test.ts:203
- Reasoning: Merchant analytics are forced to the merchant’s office, and listing visibility is scoped by creator/office plus published status.

### Admin / internal / debug protection

- Conclusion: Pass
- Evidence: apps/api/src/routes/admin.ts:31, apps/api/src/routes/health.ts:8, apps/api/src/routes/health.ts:26
- Reasoning: Admin endpoints are grouped behind auth, consent, and administrator role checks. The public endpoints are limited to health and timezone/config-style information.

## 7. Tests and Logging Review

### Unit tests

- Conclusion: Partial Pass
- Rationale: API and web unit/service tests exist for auth, attachments, listings workflow, promos, analytics, audit chain, retention, offline store, and API client behavior. However, most main route suites disable CSRF, idempotency, and IP throttling, so their passing results do not fully prove production-path security behavior.
- Evidence: apps/api/tests/routes/auth.test.ts:65, apps/api/tests/routes/listings.workflow.test.ts:51, apps/api/tests/routes/attachments.test.ts:61, apps/api/tests/routes/promo.test.ts:24, apps/web/tests/stores/offline.test.ts:26, apps/web/tests/api/client.test.ts:44

### API / integration tests

- Conclusion: Partial Pass
- Rationale: There is meaningful Supertest coverage, and the dedicated security.middleware suite exercises the full middleware stack on representative routes. The main gaps are missing 429 assertions and no direct route-level regression test for admin user purge.
- Evidence: apps/api/tests/routes/security.middleware.test.ts:4, apps/api/tests/routes/security.middleware.test.ts:164, apps/api/tests/routes/security.middleware.test.ts:292, apps/api/tests/routes/admin.test.ts:217, apps/api/src/routes/admin.ts:182

### Logging categories / observability

- Conclusion: Pass
- Rationale: The codebase uses Pino with explicit redaction, separate event_log/audit_log flows, and job-run visibility. Error middleware emits structured responses instead of random console output.
- Evidence: apps/api/src/logger/index.ts:4, apps/api/src/logger/index.ts:32, apps/api/src/errors/middleware.ts:6, apps/api/src/routes/admin.ts:316

### Sensitive-data leakage risk in logs / responses

- Conclusion: Partial Pass
- Rationale: Log redaction covers passwords, tokens, authorization headers, hashes, and nonces. The residual leakage risk is in responses, not logs: attachment and export APIs still expose internal storage metadata.
- Evidence: apps/api/src/logger/index.ts:6, apps/api/src/logger/index.ts:9, apps/api/src/logger/index.ts:15, apps/api/src/services/attachment.ts:61, apps/api/src/routes/analytics.ts:204

## 8. Test Coverage Assessment (Static Audit)

### 8.1 Test Overview

- Unit tests exist: Yes
- API / integration tests exist: Yes
- Frontend unit tests exist: Yes
- E2E entry point exists: Yes, statically only
- Test frameworks: Jest, Supertest, Vitest, happy-dom, Playwright
- Test entry points: package.json:6, apps/api/package.json:6, apps/web/package.json:10, README.md:389, README.md:405, run_tests.sh:1, .github/workflows/ci.yml:1
- Documentation provides test commands: Yes
- Boundary: None of these tests were executed during this audit.

### 8.2 Coverage Mapping Table

| Requirement / Risk Point | Mapped Test Case(s) | Key Assertion / Fixture / Mock | Coverage Assessment | Gap | Minimum Test Addition |
|---|---|---|---|---|---|
| Local auth happy path, lockout, refresh rotation, fingerprint binding | apps/api/tests/routes/auth.test.ts:85; apps/api/tests/routes/auth.test.ts:114; apps/api/tests/routes/auth.test.ts:177; apps/api/tests/routes/auth.test.ts:447 | Successful token issuance, lockout after 10 failures, refresh token rotation, fingerprint mismatch revokes session | Basically covered | Main auth suite skips idempotency and IP throttling; no 429 threshold assertions | Add full-stack repeated-login tests that assert 429 and Retry-After with middleware enabled |
| CSRF and idempotency on representative mutating routes | apps/api/tests/routes/security.middleware.test.ts:164; apps/api/tests/routes/security.middleware.test.ts:199; apps/api/tests/routes/security.middleware.test.ts:230; apps/api/tests/routes/security.middleware.test.ts:292; apps/api/tests/routes/security.middleware.test.ts:343; apps/api/tests/routes/security.middleware.test.ts:397 | Missing CSRF and missing Idempotency-Key are rejected; replayed Idempotency-Key returns cached response | Sufficient for representative coverage | No rate-limit assertions; not every major route is exercised through full stack | Add repeated-request 429 tests and extend full-stack coverage to more routes |
| Listing workflow from draft through publish/archive | apps/api/tests/routes/listings.workflow.test.ts:173; apps/api/tests/routes/listings.workflow.test.ts:226 | Published then archived state asserted through API responses | Basically covered | Workflow suite skips CSRF/idempotency/IP throttling | Add one full-stack workflow regression with real security middleware enabled |
| Publish gate rejects incomplete listings | apps/api/tests/routes/listings.workflow.test.ts:239; apps/api/tests/routes/listings.workflow.test.ts:280 | Publish attempt on missing required fields returns 400 | Basically covered | Security middleware path still skipped | Add a full-stack publish-gate regression |
| Anomaly override required for approval | apps/api/tests/routes/listings.workflow.test.ts:287; apps/api/tests/routes/listings.workflow.test.ts:336; apps/api/tests/routes/listings.workflow.test.ts:378 | Approval without overrideReason fails; approval with overrideReason succeeds | Basically covered | Does not prove nonce/CSRF/idempotency interaction on approve | Add a full-stack approve test with nonce, CSRF, and Idempotency-Key |
| Attachment dedup and 25-file cap | apps/api/tests/services/attachment.test.ts:134; apps/api/tests/services/attachment.test.ts:198 | Duplicate upload returns duplicate=true; 25-upload quota is enforced | Basically covered | Service-level only for quota/dedup; attachment list response shaping is not asserted | Add route-level DTO assertions for GET attachments |
| Attachment rollback retains five revisions and reprocesses images | apps/api/tests/services/attachment.test.ts:296; apps/api/tests/services/attachment.test.ts:358 | Rollback creates new revision, prunes older revisions, and reprocesses image metadata | Basically covered | No full-stack rollback middleware/authorization regression; service auth inconsistency untested | Add route-level rollback auth and middleware tests |
| Attachment revision authorization | apps/api/tests/routes/attachments.test.ts:357; apps/api/tests/routes/attachments.test.ts:370; apps/api/tests/routes/attachments.test.ts:380; apps/api/tests/routes/attachments.test.ts:400 | Regular user, operations, and cross-office merchant get 403; same-office merchant gets 200 and trimmed revision DTO | Sufficient | Does not cover attachment list metadata leakage | Add GET attachments assertions that storage_key/sha256 are absent |
| Promo create, activate, slot CRUD, reorder | apps/api/tests/routes/promo.test.ts:117; apps/api/tests/routes/promo.test.ts:224; apps/api/tests/routes/promo.test.ts:251; apps/api/tests/routes/promo.test.ts:315 | Create returns 201, activate returns 200, slot add/delete/reorder succeed | Basically covered | No explicit test for max-20 slot limit or time-window boundary transitions | Add slot-cap and boundary-time tests |
| Analytics KPI, export job, engagement KPI card | apps/api/tests/routes/analytics.test.ts:117; apps/api/tests/routes/analytics.test.ts:221; apps/api/tests/routes/analytics.test.ts:242; apps/web/tests/components/AnalyticsView.test.ts:71 | KPI route returns rows/funnel; export job creation/status covered; engagement card rendered in web test | Basically covered | No full-stack security-path coverage; merchant analytics behavior is tested as allowed rather than challenged | Add least-privilege tests after role decision is finalized |
| Audit chain tamper detection and post-compaction verification | apps/api/tests/audit.chain.test.ts:28; apps/api/tests/audit.chain.test.ts:39; apps/api/tests/audit.chain.test.ts:70 | verifyChain returns valid on clean chain, invalid on tamper, valid after compaction | Sufficient | None material statically | None urgent |
| 90-day listing purge and FK parity | apps/api/tests/jobs/retention.test.ts:80; apps/api/tests/jobs/retention.fk.test.ts:300; apps/api/tests/jobs/retention.fk.test.ts:326 | Old soft-deleted listings are purged; FK-protected children removed under FK-enforcing schema | Sufficient | User-purge parity is not covered | Add analogous FK-enforcing regression for admin user purge |
| Immediate admin user purge | None found in apps/api/tests | None found | Missing | Route exists but there is no direct regression evidence for the irreversible user purge path | Add POST /api/v1/admin/purge/user/:id route test covering FK cleanup, session revoke, and blob deletion |

### 8.3 Security Coverage Audit

- Authentication: Basically covered
  Evidence: apps/api/tests/routes/auth.test.ts:85, apps/api/tests/routes/auth.test.ts:114, apps/api/tests/routes/auth.test.ts:177, apps/api/tests/routes/auth.test.ts:447
  Notes: Happy path, lockout, refresh, and fingerprint binding are covered. Severe rate-limit regressions could still remain undetected because there are no 429 assertions.

- Route authorization: Partial Pass
  Evidence: apps/api/tests/routes/analytics.test.ts:135, apps/api/tests/routes/promo.test.ts:117, apps/api/tests/routes/security.middleware.test.ts:343
  Notes: Some role-gated routes are covered, but many primary route suites skip the real middleware stack, so authorization plus middleware interaction is not broadly proven.

- Object-level authorization: Partial Pass
  Evidence: apps/api/tests/routes/attachments.test.ts:357, apps/api/tests/routes/attachments.test.ts:380, apps/api/tests/routes/attachments.test.ts:400
  Notes: Attachment revision object-level authorization is meaningfully tested. Coverage is thinner for listing and promo cross-office scenarios.

- Tenant / data isolation: Partial Pass
  Evidence: apps/api/tests/routes/analytics.test.ts:203, apps/api/tests/routes/attachments.test.ts:380
  Notes: Merchant-own-office analytics and cross-office merchant denial are covered in selected places, but not exhaustively across all resource types.

- Admin / internal protection: Partial Pass
  Evidence: apps/api/tests/routes/admin.test.ts:217, apps/api/tests/routes/security.middleware.test.ts:343
  Notes: Admin listing purge and admin route security are covered. The user-purge route remains untested, so severe defects in that path could still ship unnoticed.

### 8.4 Final Coverage Judgment

- Conclusion: Partial Pass
- Boundary explanation: The test suite gives good static confidence in the core auth flow, listing workflow, attachment processing, promo CRUD, analytics basics, audit-chain integrity, and listing retention. The main reasons coverage is not a full pass are: missing 429/rate-limit assertions, broad reliance on helper flags that skip CSRF/idempotency/IP-throttle in major route suites, no direct regression for admin user purge, and limited full-stack coverage for some high-risk authorization paths. Those gaps are large enough that severe security or irreversible-admin-flow defects could still pass the current suite.

## 9. Final Notes

- This audit was static-only. No runtime success claims are made for Docker, browser flows, TLS, IndexedDB persistence, or time-based behavior.
- The strongest current acceptance risk is the broken global throttling path, followed by least-privilege/response-shaping issues and incomplete production-path test evidence.