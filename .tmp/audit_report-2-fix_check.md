# HarborStone Previous Inspection Recheck

## Scope

- Boundary: Static source review only. No project startup, Docker, test execution, or browser/runtime validation was performed.
- Source of issues rechecked: the findings listed in `audit_report-2.md`.
- Verdict: All six previously reported issues are fixed in the current source tree.

## Issue Status

| Previous issue | Prior severity | Current status | Current evidence | Notes |
|---|---|---|---|---|
| Global API/IP throttling was effectively disabled because the middleware never incremented counters | High | Fixed | `repo/apps/api/src/middleware/ipRateLimit.ts:50`, `repo/apps/api/src/middleware/ipRateLimit.ts:97`, `repo/apps/api/src/middleware/ipRateLimit.ts:110`, `repo/apps/api/tests/routes/security.middleware.test.ts:528`, `repo/apps/api/tests/routes/security.middleware.test.ts:560` | The middleware now increments both the general API bucket and the failed-request bucket, and the security suite now includes explicit `429` + `Retry-After` regression tests. |
| Internal storage metadata leaked through client-facing attachment and export-job APIs | Medium | Fixed | `repo/apps/api/src/services/attachment.ts:65`, `repo/apps/api/src/routes/attachments.ts:99`, `repo/apps/api/src/routes/attachments.ts:123`, `repo/apps/api/src/routes/attachments.ts:185`, `repo/apps/api/src/routes/attachments.ts:263`, `repo/apps/api/src/services/exportService.ts:48`, `repo/apps/api/src/routes/analytics.ts:202`, `repo/apps/api/src/routes/analytics.ts:204`, `repo/apps/api/tests/routes/attachments.test.ts:187`, `repo/apps/api/tests/routes/attachments.test.ts:281`, `repo/apps/api/tests/routes/analytics.test.ts:300` | Public projections now strip `storage_key`, `sha256`, `created_by`, `current_revision_id`, `file_key`, and related internal fields from the cited browser-facing responses. The download endpoint still emits `X-SHA256`, but that is a download integrity header rather than the previously reported status/list leakage. |
| Attachment rollback authorization was broader in the service layer than in the route layer | Medium | Fixed | `repo/apps/api/src/services/attachment.ts:456`, `repo/apps/api/src/routes/attachments.ts:240` | The service now enforces the same merchant-own-office/admin boundary as the route, closing the defense-in-depth gap. |
| Analytics access was broader than the prompt role model because merchants were allowed into analytics/export features | Medium | Fixed | `repo/apps/api/src/routes/analytics.ts:31`, `repo/apps/api/src/routes/analytics.ts:46`, `repo/apps/api/src/routes/analytics.ts:55`, `repo/apps/api/src/routes/analytics.ts:112`, `repo/apps/api/src/routes/analytics.ts:145`, `repo/apps/web/src/router/index.ts:17`, `repo/apps/api/tests/routes/analytics.test.ts:209`, `repo/apps/api/tests/routes/analytics.test.ts:228`, `repo/apps/api/tests/routes/analytics.test.ts:237` | Backend and frontend now gate analytics to `operations` and `administrator`, and tests assert merchants receive `403` on KPI, funnel, and export creation. |
| Major route suites bypassed the production security stack, and admin user purge lacked direct regression coverage | Medium | Fixed | `repo/apps/api/tests/helpers/testApp.ts:1`, `repo/apps/api/tests/helpers/testApp.ts:39`, `repo/apps/api/tests/routes/auth.test.ts:72`, `repo/apps/api/tests/routes/attachments.test.ts:74`, `repo/apps/api/tests/routes/analytics.test.ts:46`, `repo/apps/api/tests/routes/listings.workflow.test.ts:57`, `repo/apps/api/tests/routes/promo.test.ts:37`, `repo/apps/api/tests/routes/admin.test.ts:65`, `repo/apps/api/tests/routes/admin.test.ts:412`, `repo/apps/api/tests/routes/security.middleware.test.ts:528`, `repo/apps/api/tests/routes/security.middleware.test.ts:560` | Route suites now default to the full production middleware stack via `createProductionTestApp()`. The admin purge path now has a dedicated route-level suite. Narrow skip options still exist for isolated tests, but not as the default for the main route suites cited in the earlier report. |
| README and CI disagreed about the `workflow_dispatch` Playwright path | Low | Fixed | `repo/.github/workflows/ci.yml:19`, `repo/.github/workflows/ci.yml:76`, `repo/README.md:418` | The workflow now declares `workflow_dispatch`, matching the README. |

## Summary

- Rechecked issues: 6
- Fixed: 6
- Still open from the previous inspection: 0
- Static-only caveat: These results confirm the source and test definitions were updated. They do not prove runtime behavior without executing the project and test suite.