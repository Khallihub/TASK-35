# HarborStone Previous Inspection Issues Recheck

Date: 2026-04-15  
Mode: Static-only verification (no app start, no Docker run, no test execution)

## Scope
This recheck verifies the previously reported issues from the prior inspection cycle:
1. Admin lock bypass risk when `status=locked` and `locked_until` is null.
2. Missing client wiring for `X-Device-Fingerprint` in authenticated requests.
3. Delivery/test-flow mismatch where documented orchestrated tests omitted frontend Vitest.

## Results Summary

| Previously Reported Issue | Current Status | Evidence |
|---|---|---|
| Admin lock bypass risk (`locked` + null `locked_until`) | Fixed | `repo/apps/api/src/services/lockout.ts:194` (permanent admin lock behavior), `repo/apps/api/tests/routes/auth.test.ts:365`, `repo/apps/api/tests/routes/auth.test.ts:384` |
| Missing device fingerprint header wiring in web client | Fixed | `repo/apps/web/src/api/client.ts:22`, `repo/apps/web/tests/api/client.test.ts:44`, `repo/apps/web/tests/api/client.test.ts:52`, `repo/apps/web/tests/api/client.test.ts:70` |
| Backend refresh not enforcing fingerprint mismatch/session binding | Fixed | `repo/apps/api/src/routes/auth.ts:249`, `repo/apps/api/src/routes/auth.ts:279`, `repo/apps/api/tests/routes/auth.test.ts:410`, `repo/apps/api/tests/routes/auth.test.ts:440` |
| README/script mismatch for frontend test coverage in orchestrated flow | Fixed | `repo/README.md:400`, `repo/README.md:426`, `repo/run_tests.sh:224`, `repo/run_tests.sh:243`, `repo/apps/web/package.json:10`, `repo/apps/web/vite.config.ts:17` |

## Detailed Notes

### 1) Admin lock bypass
- Current lockout logic explicitly treats missing `locked_until` as a permanent admin lock condition.
- The related auth tests verify login and refresh are rejected for admin-locked accounts and lock status remains locked.
- Recheck conclusion: fixed.

### 2) Device fingerprint propagation
- Request interceptor now sets `X-Device-Fingerprint` via `getDeviceFingerprint()`.
- Frontend tests verify header presence for GET/POST and stable fingerprint reuse.
- Recheck conclusion: fixed.

### 3) Refresh fingerprint enforcement
- Refresh endpoint rejects requests when refresh fingerprint mismatches stored session fingerprint and revokes session.
- Tests cover fingerprint-binding behavior and mismatch revocation.
- Recheck conclusion: fixed.

### 4) Test orchestration and docs alignment
- README now documents frontend unit tests as Vitest in `run_tests.sh` flow.
- `run_tests.sh` includes an explicit frontend Vitest stage and executes `npm run test --workspace=apps/web`.
- Web workspace test script and Vitest config are present.
- Recheck conclusion: fixed.

## Final Recheck Verdict
All previously listed issues are statically verified as fixed in the current repository snapshot.

## Static Boundary Reminder
This report confirms source and test/documentation alignment only. Runtime behavior and actual pass/fail execution were not evaluated in this recheck.
