# HarborStone Listings Operations Suite
## Delivery Acceptance and Project Architecture Audit (Static-Only, New Iteration)

Date: 2026-04-15
Mode: Static-only review. No project start, no Docker run, no automated test execution, no code modification.
Iteration note: This pass revalidated prior High findings against current source and test files; previously reported High defects were fixed in code.

## 1. Verdict
Overall conclusion: Partial Pass

Primary reason: security-critical defects previously identified in auth/fingerprint paths are now statically resolved, but delivery/testing documentation and orchestrated test flow are out of sync with the repository's current frontend test suite, reducing static verifiability confidence for full-stack regression checks.

## 2. Scope and Static Verification Boundary
Reviewed (static only):
- Prompt and PRD anchors: `docs/prompt.md:1`, `docs/prompt.md:3`, `docs/prd.md:292`, `docs/prd.md:304`
- API app wiring and auth/security: `repo/apps/api/src/app.ts:17`, `repo/apps/api/src/app.ts:22`, `repo/apps/api/src/routes/index.ts:13`, `repo/apps/api/src/routes/index.ts:29`, `repo/apps/api/src/routes/auth.ts:247`, `repo/apps/api/src/middleware/auth.ts:47`, `repo/apps/api/src/routes/users.ts:192`, `repo/apps/api/src/services/lockout.ts:194`
- Business authorization flows: `repo/apps/api/src/routes/analytics.ts:62`, `repo/apps/api/src/services/attachment.ts:108`, `repo/apps/api/src/routes/admin.ts:28`, `repo/apps/api/src/routes/admin.ts:253`
- Web client/offline/promo/test harness: `repo/apps/web/src/api/client.ts:22`, `repo/apps/web/src/api/fingerprint.ts:8`, `repo/apps/web/src/components/promo/PromoStatusPill.vue:22`, `repo/apps/web/package.json:10`, `repo/apps/web/vite.config.ts:15`
- Static test evidence (backend + frontend): `repo/apps/api/tests/routes/auth.test.ts:365`, `repo/apps/api/tests/routes/auth.test.ts:410`, `repo/apps/api/tests/routes/users.test.ts:402`, `repo/apps/api/tests/routes/analytics.test.ts:144`, `repo/apps/api/tests/routes/attachments.test.ts:265`, `repo/apps/web/tests/api/client.test.ts:44`, `repo/apps/web/tests/stores/offline.test.ts:25`
- Documentation/test scripts: `repo/README.md:391`, `repo/README.md:398`, `repo/README.md:399`, `repo/run_tests.sh:144`, `repo/run_tests.sh:196`, `repo/package.json:8`

Not reviewed exhaustively:
- Every endpoint and all UI style branches
- Runtime behavior of storage/media processing pipeline and browser rendering

Intentionally not executed:
- App startup, Docker stack, automated tests, and any external integrations

Manual verification required:
- Browser rendering/accessibility/responsiveness
- Runtime behavior under real network transitions and storage constraints

## 3. Repository / Requirement Mapping Summary
Prompt core goal:
- Offline-capable brokerage operations suite with strict role controls, listing/attachment workflows, KPI/export analytics, promo scheduling, and security/risk/audit controls. Evidence: `docs/prompt.md:1`, `docs/prompt.md:3`

Mapped implementation areas:
- Auth/session/risk/admin controls: `repo/apps/api/src/routes/auth.ts:247`, `repo/apps/api/src/services/lockout.ts:194`, `repo/apps/api/src/routes/users.ts:192`, `repo/apps/api/src/routes/admin.ts:28`
- Listing/attachment/analytics/promo: `repo/apps/api/src/routes/index.ts:25`, `repo/apps/api/src/routes/index.ts:27`, `repo/apps/api/src/services/attachment.ts:108`
- Offline and client security headers: `repo/apps/web/src/api/client.ts:22`, `repo/apps/web/src/api/fingerprint.ts:8`

Fit summary:
- Business and security architecture are now strongly aligned to the prompt in reviewed scope; remaining gap is delivery/test verifiability consistency in docs/scripts.

## 4. Section-by-section Review

### 4.1 Hard Gates

#### 1.1 Documentation and static verifiability
- Conclusion: Partial Pass
- Rationale: core startup and API/test instructions exist, but documented Docker test flow still omits frontend Vitest suite now present in the repository.
- Evidence: `repo/README.md:391`, `repo/README.md:398`, `repo/README.md:399`, `repo/run_tests.sh:196`, `repo/apps/web/package.json:10`, `repo/apps/web/vite.config.ts:15`

#### 1.2 Material deviation from Prompt
- Conclusion: Pass
- Rationale: reviewed implementation remains centered on the prompt’s roles, offline behavior, security controls, and operations workflows.
- Evidence: `docs/prompt.md:1`, `repo/apps/api/src/routes/auth.ts:247`, `repo/apps/web/src/api/client.ts:22`, `repo/apps/api/src/routes/analytics.ts:62`

### 4.2 Delivery Completeness

#### 2.1 Core explicit requirements coverage
- Conclusion: Pass
- Rationale: reviewed requirements for auth lock/refresh controls, analytics scoping, attachment draft write constraints, and local promo visibility behavior are implemented and statically evidenced.
- Evidence: `repo/apps/api/src/services/lockout.ts:194`, `repo/apps/api/src/routes/analytics.ts:62`, `repo/apps/api/src/services/attachment.ts:108`, `repo/apps/web/src/components/promo/PromoStatusPill.vue:22`, `repo/apps/web/src/api/client.ts:22`

#### 2.2 End-to-end 0-to-1 delivery shape
- Conclusion: Pass
- Rationale: monorepo includes backend, frontend, shared package, docs, route composition, and test suites.
- Evidence: `repo/package.json:3`, `repo/apps/api/src/routes/index.ts:13`, `repo/apps/web/package.json:10`, `repo/apps/web/vite.config.ts:15`

### 4.3 Engineering and Architecture Quality

#### 3.1 Structure and module decomposition
- Conclusion: Pass
- Rationale: clean separation of routes/middleware/services/jobs/storage and frontend API/composables/views/tests.
- Evidence: `repo/apps/api/src/routes/index.ts:13`, `repo/apps/api/src/routes/admin.ts:28`, `repo/apps/web/src/api/client.ts:15`, `repo/apps/web/tests/stores/offline.test.ts:25`

#### 3.2 Maintainability and extensibility
- Conclusion: Pass
- Rationale: previously inconsistent security contracts were corrected (permanent admin lock handling and device fingerprint propagation), and regression tests were added.
- Evidence: `repo/apps/api/src/services/lockout.ts:194`, `repo/apps/web/src/api/client.ts:22`, `repo/apps/api/tests/routes/auth.test.ts:365`, `repo/apps/api/tests/routes/auth.test.ts:410`

### 4.4 Engineering Details and Professionalism

#### 4.1 Error handling/logging/validation/API practice
- Conclusion: Pass
- Rationale: structured middleware and security checks remain consistent, with targeted security test additions.
- Evidence: `repo/apps/api/src/app.ts:17`, `repo/apps/api/src/middleware/auth.ts:47`, `repo/apps/api/tests/routes/auth.test.ts:365`, `repo/apps/api/tests/routes/auth.test.ts:410`, `repo/apps/web/tests/api/client.test.ts:44`

#### 4.2 Product-like service organization
- Conclusion: Pass
- Rationale: deliverable remains product-grade rather than demo-only.
- Evidence: `repo/apps/api/src/routes/admin.ts:253`, `repo/apps/web/src/api/fingerprint.ts:8`, `repo/apps/web/tests/stores/offline.test.ts:25`

### 4.5 Prompt Understanding and Requirement Fit

#### 5.1 Business goal/scenario/constraints fit
- Conclusion: Pass
- Rationale: reviewed constraints for lockouts, refresh fingerprint binding, analytics scope isolation, and attachment draft-gating align with prompt/PRD intent.
- Evidence: `docs/prd.md:304`, `repo/apps/api/src/services/lockout.ts:194`, `repo/apps/web/src/api/client.ts:22`, `repo/apps/api/src/routes/analytics.ts:62`, `repo/apps/api/src/services/attachment.ts:108`

### 4.6 Aesthetics (frontend)

#### 6.1 Visual and interaction quality
- Conclusion: Partial Pass
- Rationale: static evidence shows role-aware navigation and live/scheduled status UI logic, but rendering quality and interaction feel require browser execution.
- Evidence: `repo/apps/web/src/components/promo/PromoStatusPill.vue:22`, `repo/apps/web/src/components/promo/PromoStatusPill.vue:23`, `repo/apps/web/src/composables/useClock.ts:5`
- Manual verification note: browser validation required.

## 5. Issues / Suggestions (Severity-Rated)

### Medium

Issue: Documented/orchestrated test flow does not include frontend Vitest suite now present in repository
- Severity: Medium
- Conclusion: Partial Fail
- Evidence: `repo/apps/web/package.json:10`, `repo/apps/web/vite.config.ts:15`, `repo/apps/web/tests/api/client.test.ts:44`, `repo/apps/web/tests/stores/offline.test.ts:25`, `repo/README.md:398`, `repo/README.md:399`, `repo/run_tests.sh:196`
- Impact: Delivery acceptance can report frontend checks as successful while frontend unit/integration-style tests are not executed in the documented Docker script path.
- Minimum actionable fix: update `run_tests.sh` and README testing section to include `npm run test --workspace=apps/web` (or clearly document why omitted and provide equivalent CI coverage).

## 6. Security Review Summary

Authentication entry points
- Conclusion: Pass
- Evidence: `repo/apps/api/src/routes/auth.ts:247`, `repo/apps/api/src/services/lockout.ts:194`, `repo/apps/api/tests/routes/auth.test.ts:365`, `repo/apps/api/tests/routes/auth.test.ts:410`
- Reasoning: admin-lock and fingerprint refresh controls now have explicit code paths and tests.

Route-level authorization
- Conclusion: Pass
- Evidence: `repo/apps/api/src/routes/admin.ts:28`, `repo/apps/api/src/routes/analytics.ts:62`

Object-level authorization
- Conclusion: Pass
- Evidence: `repo/apps/api/src/services/attachment.ts:108`, `repo/apps/api/tests/routes/attachments.test.ts:265`

Function-level authorization
- Conclusion: Pass
- Evidence: `repo/apps/api/src/services/lockout.ts:194`, `repo/apps/api/src/routes/users.ts:195`

Tenant / user isolation
- Conclusion: Pass
- Evidence: `repo/apps/api/src/routes/analytics.ts:62`, `repo/apps/api/tests/routes/analytics.test.ts:144`

Admin / internal / debug protection
- Conclusion: Pass
- Evidence: `repo/apps/api/src/routes/admin.ts:28`, `repo/apps/api/src/routes/admin.ts:253`

## 7. Tests and Logging Review

Unit tests
- Conclusion: Pass
- Evidence: `repo/apps/api/tests/routes/users.test.ts:402`, `repo/apps/web/tests/api/fingerprint.test.ts:5`, `repo/apps/web/tests/stores/offline.test.ts:25`

API / integration tests
- Conclusion: Pass
- Evidence: `repo/apps/api/tests/routes/auth.test.ts:365`, `repo/apps/api/tests/routes/auth.test.ts:410`, `repo/apps/api/tests/routes/analytics.test.ts:144`, `repo/apps/api/tests/routes/attachments.test.ts:265`

Logging categories / observability
- Conclusion: Pass
- Evidence: `repo/apps/api/src/app.ts:17`, `repo/apps/api/tests/logger.redaction.test.ts:54`

Sensitive-data leakage risk in logs / responses
- Conclusion: Partial Pass
- Evidence: `repo/apps/api/tests/logger.redaction.test.ts:21`, `repo/apps/api/tests/logger.redaction.test.ts:65`
- Manual verification note: full runtime sink coverage cannot be proven statically.

## 8. Test Coverage Assessment (Static Audit)

### 8.1 Test Overview
- Backend tests: Jest/ts-jest configured and present. Evidence: `repo/apps/api/package.json:8`, `repo/apps/api/jest.config.cjs:2`, `repo/apps/api/jest.config.cjs:3`
- Frontend tests: Vitest configured and present. Evidence: `repo/apps/web/package.json:10`, `repo/apps/web/vite.config.ts:15`, `repo/apps/web/tests/api/client.test.ts:44`
- Documentation mismatch: Docker test script path still runs frontend typecheck but not frontend Vitest. Evidence: `repo/README.md:399`, `repo/run_tests.sh:196`

### 8.2 Coverage Mapping Table

| Requirement / Risk Point | Mapped Test Case(s) | Key Assertion / Fixture / Mock | Coverage Assessment | Gap | Minimum Test Addition |
|---|---|---|---|---|---|
| Auth lockout (including admin lock without `locked_until`) | `repo/apps/api/tests/routes/auth.test.ts:365`, `repo/apps/api/tests/routes/users.test.ts:402` | Admin-locked login denied; lock persists. | basically covered | Not executed in this static audit. | Ensure CI path executes these tests consistently. |
| Refresh fingerprint binding and mismatch revocation | `repo/apps/api/tests/routes/auth.test.ts:410`, `repo/apps/web/tests/api/client.test.ts:44` | Backend mismatch rejection + client fingerprint header assertions. | basically covered | Runtime/browser-only edge behavior not proven statically. | Add end-to-end browser scenario in CI for refresh mismatch. |
| Merchant office isolation | `repo/apps/api/tests/routes/analytics.test.ts:144` | Null office merchant receives 403. | sufficient | None material in reviewed scope. | Maintain regression coverage. |
| Regular-user attachment draft-only write | `repo/apps/api/tests/routes/attachments.test.ts:265` | Non-draft attachment mutations denied. | sufficient | None material in reviewed scope. | Maintain regression coverage. |
| Offline queue store behavior | `repo/apps/web/tests/stores/offline.test.ts:25` | enqueue/fail/retry/pending semantics validated with mocked idb. | basically covered | Real browser/network integration not statically proven. | Add integration test with mocked transport errors and queue flush. |
| Sensitive log redaction | `repo/apps/api/tests/logger.redaction.test.ts:54`, `repo/apps/api/tests/logger.redaction.test.ts:65` | Password and authorization token redaction assertions. | sufficient | Full runtime sink inventory not proven statically. | Extend tests when new log fields are introduced. |

### 8.3 Security Coverage Audit

Authentication
- Conclusion: Basically covered
- Evidence: `repo/apps/api/tests/routes/auth.test.ts:365`, `repo/apps/api/tests/routes/auth.test.ts:410`

Route authorization
- Conclusion: Basically covered
- Evidence: `repo/apps/api/tests/routes/analytics.test.ts:144`

Object-level authorization
- Conclusion: Sufficient
- Evidence: `repo/apps/api/tests/routes/attachments.test.ts:265`

Tenant / data isolation
- Conclusion: Sufficient
- Evidence: `repo/apps/api/tests/routes/analytics.test.ts:144`

Admin / internal protection
- Conclusion: Basically covered
- Evidence: `repo/apps/api/src/routes/admin.ts:28`, `repo/apps/api/tests/routes/users.test.ts:402`

### 8.4 Final Coverage Judgment
Partial Pass

Covered major risks:
- Auth lockout semantics, including admin-lock edge
- Fingerprint header composition and refresh mismatch behavior
- Merchant office isolation
- Attachment draft-status write controls
- Sensitive log redaction

Residual boundary:
- Reviewed tests were not executed in this static audit
- The documented Docker test path does not yet run frontend Vitest, so severe frontend regressions could still be missed in that path

## 9. Final Notes
- New iteration revalidation found that prior High findings are fixed in current source: permanent admin lock handling and web client fingerprint propagation are now implemented and statically tested.
- Remaining material finding is delivery/test-verifiability mismatch, not a currently observed prompt-critical security logic break.
- Conclusions remain static-only; runtime behavior claims are intentionally bounded.