#!/usr/bin/env bash
# run_tests.sh — Run all test suites inside Docker containers.
#
# Stages (all run by default):
#   1. Backend (Jest)            — SQLite in-memory, no external deps
#   2. Backend MySQL integration — migration purge test against real MySQL
#   3. Frontend type-check       — vue-tsc --noEmit
#   4. Frontend unit (Vitest)    — happy-dom unit/integration tests
#   5. E2E (Playwright)          — Chromium against full docker-compose stack
#
# Usage:
#   ./run_tests.sh              # run ALL stages (default)
#   ./run_tests.sh --no-e2e     # skip E2E for faster local iteration
#   ./run_tests.sh --backend    # backend stages only (1+2)
#   ./run_tests.sh --frontend   # frontend stages only (3+4)
#   ./run_tests.sh --help
#
# Exits non-zero if any suite fails.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Git-bash / MSYS2 on Windows: prevent path mangling
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

# ── Argument parsing ──────────────────────────────────────────────────────────
RUN_BACKEND=true
RUN_FRONTEND=true
RUN_E2E=true

for arg in "$@"; do
  case "$arg" in
    --backend)  RUN_FRONTEND=false; RUN_E2E=false ;;
    --frontend) RUN_BACKEND=false; RUN_E2E=false ;;
    --no-e2e)   RUN_E2E=false ;;
    --help|-h)
      echo "Usage: $0 [--backend|--frontend] [--no-e2e] [--help]"
      echo ""
      echo "  (no flags)    Run ALL stages: backend + MySQL + typecheck + vitest + E2E"
      echo "  --backend     Backend stages only (Jest + MySQL integration)"
      echo "  --frontend    Frontend stages only (type-check + Vitest)"
      echo "  --no-e2e      Skip Playwright E2E stage"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg  (use --help)" >&2
      exit 1
      ;;
  esac
done

# ── Prerequisites ─────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "[error] docker is required but not found in PATH" >&2
  exit 1
fi

# ── Image names ──────────────────────────────────────────────────────────────
API_TEST_IMAGE="harborstone-api-test"
WEB_TEST_IMAGE="harborstone-web-test"
WEB_TC_IMAGE="harborstone-web-typecheck"
E2E_IMAGE="harborstone-e2e-test"

# ── Globals ──────────────────────────────────────────────────────────────────
FAIL=0
STACK_UP=0

BACKEND_TOTAL=0 BACKEND_PASS=0 BACKEND_FAIL_COUNT=0 BACKEND_SKIP=0
BACKEND_SUITES_TOTAL=0 BACKEND_SUITES_PASS=0
BACKEND_STATUS="SKIP"

MYSQL_STATUS="SKIP"
MYSQL_TOTAL=0 MYSQL_PASS=0 MYSQL_FAIL_COUNT=0

TYPECHECK_STATUS="SKIP"

FRONTEND_TOTAL=0 FRONTEND_PASS=0 FRONTEND_FAIL_COUNT=0 FRONTEND_SKIP=0
FRONTEND_STATUS="SKIP"

E2E_STATUS="SKIP"
E2E_TOTAL=0 E2E_PASS=0 E2E_FAIL_COUNT=0

# ── Helpers ──────────────────────────────────────────────────────────────────
hr()  { echo "────────────────────────────────────────────────────────────────"; }
hdr() { hr; printf "  %s\n" "$*"; hr; }

strip_ansi() { sed $'s/\033\\[[0-9;]*m//g'; }

# Extract number before a keyword, e.g. "257 passed" → 257
extract_num() { echo "$1" | grep -oE "[0-9]+ $2" | grep -oE '[0-9]+' | head -1; }

parse_jest_summary() {
  local log="$1" prefix="${2:-BACKEND}"

  local tests_line
  tests_line=$(cat "$log" | strip_ansi | grep -E 'Tests:' | grep -v 'Test Suites' | tail -1 || true)

  local total=0 fail=0 skip=0 todo=0 pass=0 suites_total=0 suites_pass=0

  if [[ -n "$tests_line" ]]; then
    total=$(extract_num "$tests_line" "total"); total=${total:-0}
    fail=$(extract_num "$tests_line" "failed"); fail=${fail:-0}
    skip=$(extract_num "$tests_line" "skipped"); skip=${skip:-0}
    todo=$(extract_num "$tests_line" "todo"); todo=${todo:-0}
    pass=$(( total - fail - skip - todo ))
  fi

  local suites_line
  suites_line=$(cat "$log" | strip_ansi | grep -E 'Test Suites:' | tail -1 || true)
  if [[ -n "$suites_line" ]]; then
    suites_total=$(extract_num "$suites_line" "total"); suites_total=${suites_total:-0}
    suites_pass=$(extract_num "$suites_line" "passed"); suites_pass=${suites_pass:-0}
  fi

  if [[ "$prefix" == "BACKEND" ]]; then
    BACKEND_TOTAL=$total; BACKEND_PASS=$pass; BACKEND_FAIL_COUNT=$fail; BACKEND_SKIP=$skip
    BACKEND_SUITES_TOTAL=$suites_total; BACKEND_SUITES_PASS=$suites_pass
  else
    MYSQL_TOTAL=$total; MYSQL_PASS=$pass; MYSQL_FAIL_COUNT=$fail
  fi
}

cleanup_stack() {
  if [[ ${STACK_UP} -eq 1 ]]; then
    echo ""
    echo "[teardown] Tearing down docker compose stack ..."
    (cd "${ROOT_DIR}" && COMPOSE_PROJECT_NAME="harborstone-test" docker compose down --timeout 20) 2>/dev/null || true
  fi
}
trap cleanup_stack EXIT

# Docker compose network name (used by E2E + MySQL integration)
COMPOSE_NETWORK="harborstone-test_default"

# ─────────────────────────────────────────────────────────────────────────────
# BUILD — Docker test images (layer-cached, fast rebuilds)
# ─────────────────────────────────────────────────────────────────────────────
echo ""
hdr "BUILD — Test images (Dockerfile.test)"

cd "${ROOT_DIR}"

if $RUN_BACKEND; then
  echo "[build] Building ${API_TEST_IMAGE} ..."
  docker build --target api-test -t "${API_TEST_IMAGE}" -f Dockerfile.test -q .
  echo "[build] ${API_TEST_IMAGE} ready."
fi

if $RUN_FRONTEND; then
  echo "[build] Building ${WEB_TEST_IMAGE} ..."
  docker build --target web-test -t "${WEB_TEST_IMAGE}" -f Dockerfile.test -q .
  echo "[build] ${WEB_TEST_IMAGE} ready."

  echo "[build] Building ${WEB_TC_IMAGE} ..."
  docker build --target web-typecheck -t "${WEB_TC_IMAGE}" -f Dockerfile.test -q .
  echo "[build] ${WEB_TC_IMAGE} ready."
fi

# Start the compose stack early if we need it (MySQL integration + E2E)
NEED_STACK=false
if $RUN_BACKEND || $RUN_E2E; then NEED_STACK=true; fi

if $NEED_STACK && docker compose version >/dev/null 2>&1; then
  echo ""
  echo "[stack] Starting docker compose stack (db + api + web) ..."

  # Use a unique project name so we don't collide with other compose projects
  # that happen to share the same "repo" directory basename.
  export COMPOSE_PROJECT_NAME="harborstone-test"

  # Use high ports to avoid conflicts with other running services.
  export WEB_PORT=19080
  export WEB_SSL_PORT=19443
  export DB_PORT_EXPOSED=19306

  # Stop any existing test stack first
  (cd "${ROOT_DIR}" && docker compose down --timeout 10 --remove-orphans) 2>/dev/null || true

  set +e
  (cd "${ROOT_DIR}" && docker compose up --build -d) 2>&1
  COMPOSE_EXIT=$?
  set -e

  if [[ ${COMPOSE_EXIT} -eq 0 ]]; then
    STACK_UP=1
    echo "[stack] Waiting for services to become healthy (up to 120 s) ..."
    APP_READY=0
    for i in $(seq 1 24); do
      if docker run --rm \
          --network "${COMPOSE_NETWORK}" \
          curlimages/curl:8.7.1 \
          curl -sfk --max-time 5 "https://web:443/healthz" >/dev/null 2>&1; then
        APP_READY=1
        echo "[stack] Stack ready (${i}x5 s)"
        break
      fi
      sleep 5
    done
    if [[ ${APP_READY} -eq 0 ]]; then
      echo "[stack] WARNING: Stack not ready in time — MySQL integration + E2E may skip"
    fi
  else
    echo "[stack] WARNING: docker compose up failed — MySQL integration + E2E will skip"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 1. BACKEND — Jest (SQLite in-memory)
# ─────────────────────────────────────────────────────────────────────────────
if $RUN_BACKEND; then
  echo ""
  hdr "1/5  BACKEND — Jest (SQLite)"

  BACKEND_LOG="$(mktemp)"

  set +e
  docker run --rm \
    --name "harborstone-test-backend-$$" \
    -e CI=true \
    -e NODE_ENV=test \
    "${API_TEST_IMAGE}" \
    npx jest --runInBand --forceExit --testPathIgnorePatterns='migrations.purge' 2>&1 | tee "${BACKEND_LOG}"
  BACKEND_EXIT=$?
  set -e

  parse_jest_summary "${BACKEND_LOG}" "BACKEND" || true

  if [[ ${BACKEND_EXIT} -eq 0 ]]; then
    BACKEND_STATUS="PASS"
  else
    BACKEND_STATUS="FAIL"
    FAIL=1
  fi

  echo ""
  echo "[backend] Suites : ${BACKEND_SUITES_PASS}/${BACKEND_SUITES_TOTAL} passed"
  echo "[backend] Tests  : ${BACKEND_TOTAL} total | ${BACKEND_PASS} passed | ${BACKEND_FAIL_COUNT} failed | ${BACKEND_SKIP} skipped"
  echo "[backend] Status : ${BACKEND_STATUS}"

  if [[ "${BACKEND_STATUS}" == "FAIL" ]]; then
    echo ""
    echo "[backend] ── FAILURE DETAILS ──────────────────────"
    grep -E 'FAIL |● |✕|✗' "${BACKEND_LOG}" | head -60 || true
  fi

  rm -f "${BACKEND_LOG}"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. BACKEND — MySQL integration (migration purge FK test)
# ─────────────────────────────────────────────────────────────────────────────
if $RUN_BACKEND; then
  echo ""
  hdr "2/5  BACKEND — MySQL integration (migration purge)"

  if [[ ${STACK_UP} -eq 1 ]]; then
    MYSQL_LOG="$(mktemp)"
    MYSQL_URL="mysql://harborstone:harborstone_pass@db:3306/harborstone"

    set +e
    docker run --rm \
      --name "harborstone-test-mysql-$$" \
      --network "${COMPOSE_NETWORK}" \
      -e CI=true \
      -e NODE_ENV=test \
      -e HARBORSTONE_TEST_MYSQL_URL="${MYSQL_URL}" \
      "${API_TEST_IMAGE}" \
      npx jest --runInBand --forceExit tests/db/migrations.purge.test.ts 2>&1 | tee "${MYSQL_LOG}"
    MYSQL_EXIT=$?
    set -e

    parse_jest_summary "${MYSQL_LOG}" "MYSQL" || true

    if [[ ${MYSQL_EXIT} -eq 0 ]]; then
      MYSQL_STATUS="PASS"
    else
      MYSQL_STATUS="FAIL"
      FAIL=1
    fi

    echo ""
    echo "[mysql] Tests  : ${MYSQL_TOTAL} total | ${MYSQL_PASS} passed | ${MYSQL_FAIL_COUNT} failed"
    echo "[mysql] Status : ${MYSQL_STATUS}"

    rm -f "${MYSQL_LOG}"
  else
    echo "[mysql] Skipped — docker compose stack not available"
    MYSQL_STATUS="SKIP"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. FRONTEND — vue-tsc type-check
# ─────────────────────────────────────────────────────────────────────────────
if $RUN_FRONTEND; then
  echo ""
  hdr "3/5  FRONTEND — TypeScript type-check (vue-tsc)"

  set +e
  docker run --rm \
    --name "harborstone-test-typecheck-$$" \
    -e CI=true \
    "${WEB_TC_IMAGE}" 2>&1
  TYPECHECK_EXIT=$?
  set -e

  if [[ ${TYPECHECK_EXIT} -eq 0 ]]; then
    TYPECHECK_STATUS="PASS"
    echo "[frontend:typecheck] Status : PASS"
  else
    TYPECHECK_STATUS="FAIL"
    FAIL=1
    echo "[frontend:typecheck] Status : FAIL"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. FRONTEND — Vitest unit tests
# ─────────────────────────────────────────────────────────────────────────────
if $RUN_FRONTEND; then
  echo ""
  hdr "4/5  FRONTEND — Vitest unit tests (happy-dom)"

  FRONTEND_LOG="$(mktemp)"

  set +e
  docker run --rm \
    --name "harborstone-test-frontend-$$" \
    -e CI=true \
    -e NODE_ENV=test \
    "${WEB_TEST_IMAGE}" 2>&1 | tee "${FRONTEND_LOG}"
  FRONTEND_EXIT=$?
  set -e

  {
    VITEST_SUMMARY=$(cat "${FRONTEND_LOG}" | strip_ansi | grep -E 'Tests' | grep -v 'Test Files' | tail -1 || true)
    if [[ -n "$VITEST_SUMMARY" ]]; then
      FRONTEND_PASS=$(extract_num "$VITEST_SUMMARY" "passed")
      FRONTEND_FAIL_COUNT=$(extract_num "$VITEST_SUMMARY" "failed")
      FRONTEND_SKIP=$(extract_num "$VITEST_SUMMARY" "skipped")
      FRONTEND_TOTAL=$(echo "$VITEST_SUMMARY" | grep -oE '\([0-9]+\)' | grep -oE '[0-9]+' | head -1)
    fi
  } || true
  FRONTEND_PASS=${FRONTEND_PASS:-0}
  FRONTEND_FAIL_COUNT=${FRONTEND_FAIL_COUNT:-0}
  FRONTEND_SKIP=${FRONTEND_SKIP:-0}
  FRONTEND_TOTAL=${FRONTEND_TOTAL:-0}

  if [[ ${FRONTEND_EXIT} -eq 0 ]]; then
    FRONTEND_STATUS="PASS"
  else
    FRONTEND_STATUS="FAIL"
    FAIL=1
  fi

  echo ""
  echo "[frontend:vitest] Tests  : ${FRONTEND_TOTAL} total | ${FRONTEND_PASS} passed | ${FRONTEND_FAIL_COUNT} failed | ${FRONTEND_SKIP} skipped"
  echo "[frontend:vitest] Status : ${FRONTEND_STATUS}"

  if [[ "${FRONTEND_STATUS}" == "FAIL" ]]; then
    echo ""
    echo "[frontend:vitest] ── FAILURE DETAILS ──────────────────────"
    grep -E 'FAIL |✕|✗|AssertionError|Error:' "${FRONTEND_LOG}" | head -60 || true
  fi

  rm -f "${FRONTEND_LOG}"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. E2E — Playwright (Chromium against docker compose stack)
# ─────────────────────────────────────────────────────────────────────────────
if $RUN_E2E; then
  echo ""
  hdr "5/5  E2E — Playwright (docker compose stack)"

  if [[ ${STACK_UP} -eq 0 ]]; then
    echo "[e2e] Skipped — docker compose stack not available"
    E2E_STATUS="SKIP"
  elif [[ ! -d "${ROOT_DIR}/apps/web/e2e" ]]; then
    echo "[e2e] No e2e/ directory — skipping"
    E2E_STATUS="SKIP"
  else
    # Reset DB to clean state before E2E — previous runs may have locked
    # accounts or mutated data. Drop + recreate the database volume so
    # migrations and seeds re-run on API startup.
    echo "[e2e] Resetting database for clean E2E run ..."
    (cd "${ROOT_DIR}" && docker compose down -v --timeout 10) 2>/dev/null || true
    (cd "${ROOT_DIR}" && docker compose up -d) 2>&1
    # Wait for API to become healthy after fresh DB
    for i in $(seq 1 24); do
      if docker run --rm \
          --network "${COMPOSE_NETWORK}" \
          curlimages/curl:8.7.1 \
          curl -sfk --max-time 5 "https://web:443/healthz" >/dev/null 2>&1; then
        echo "[e2e] Fresh stack ready (${i}x5 s)"
        break
      fi
      sleep 5
    done

    echo "[e2e] Building E2E test image ..."
    docker build --target e2e -t "${E2E_IMAGE}" -f Dockerfile.test -q .
    echo "[e2e] ${E2E_IMAGE} ready."

    E2E_LOG="$(mktemp)"

    set +e
    docker run --rm \
      --name "harborstone-test-e2e-$$" \
      --network "${COMPOSE_NETWORK}" \
      -e CI=true \
      -e BASE_URL="https://web:443" \
      -e NODE_TLS_REJECT_UNAUTHORIZED=0 \
      "${E2E_IMAGE}" \
      npx playwright test --reporter=list 2>&1 | tee "${E2E_LOG}"
    E2E_EXIT=$?
    set -e

    {
      # Playwright summary is near the end: "X passed (Xs)" and optionally "X failed"
      E2E_SUMMARY=$(cat "${E2E_LOG}" | strip_ansi | grep -E '[0-9]+ (passed|failed)' | tail -3)
      E2E_PASS=$(extract_num "$E2E_SUMMARY" "passed")
      E2E_FAIL_COUNT=$(extract_num "$E2E_SUMMARY" "failed")
    } || true
    E2E_PASS=${E2E_PASS:-0}
    E2E_FAIL_COUNT=${E2E_FAIL_COUNT:-0}
    E2E_TOTAL=$(( E2E_PASS + E2E_FAIL_COUNT ))

    if [[ ${E2E_EXIT} -eq 0 ]]; then
      E2E_STATUS="PASS"
    else
      E2E_STATUS="FAIL"
      FAIL=1
    fi

    echo ""
    echo "[e2e] Tests  : ${E2E_TOTAL} total | ${E2E_PASS} passed | ${E2E_FAIL_COUNT} failed"
    echo "[e2e] Status : ${E2E_STATUS}"

    rm -f "${E2E_LOG}"
  fi
else
  echo ""
  hdr "5/5  E2E — Playwright (skipped: --no-e2e)"
  E2E_STATUS="SKIP"
fi

# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  HARBORSTONE — TEST SUMMARY"
echo "════════════════════════════════════════════════════════════════"
printf "  %-26s %s\n" "Backend (Jest/SQLite)" \
  "${BACKEND_STATUS}$(  [[ "$BACKEND_STATUS" != "SKIP" ]] && echo "  — ${BACKEND_TOTAL} tests, ${BACKEND_PASS} passed, ${BACKEND_FAIL_COUNT} failed, ${BACKEND_SKIP} skipped" || true )"
printf "  %-26s %s\n" "Backend (MySQL integration)" \
  "${MYSQL_STATUS}$(  [[ "$MYSQL_STATUS" != "SKIP" ]] && echo "  — ${MYSQL_TOTAL} tests, ${MYSQL_PASS} passed, ${MYSQL_FAIL_COUNT} failed" || true )"
printf "  %-26s %s\n" "Frontend (vue-tsc)" "${TYPECHECK_STATUS}"
printf "  %-26s %s\n" "Frontend (Vitest)" \
  "${FRONTEND_STATUS}$(  [[ "$FRONTEND_STATUS" != "SKIP" ]] && echo "  — ${FRONTEND_TOTAL} tests, ${FRONTEND_PASS} passed, ${FRONTEND_FAIL_COUNT} failed, ${FRONTEND_SKIP} skipped" || true )"
printf "  %-26s %s\n" "E2E (Playwright)" \
  "${E2E_STATUS}$(  [[ "$E2E_STATUS" != "SKIP" ]] && echo "  — ${E2E_TOTAL} tests, ${E2E_PASS} passed, ${E2E_FAIL_COUNT} failed" || true )"
echo "────────────────────────────────────────────────────────────────"

if [[ ${FAIL} -ne 0 ]]; then
  echo "  RESULT: ✗ FAILED"
  echo "════════════════════════════════════════════════════════════════"
  exit 1
else
  echo "  RESULT: ✓ ALL TESTS PASSED"
  echo "════════════════════════════════════════════════════════════════"
  exit 0
fi
