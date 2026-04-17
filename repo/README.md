# HarborStone Listings Operations Suite

Full-stack real-estate listing catalog and publishing workflow platform for US brokerage teams. Supports offline drafting, multi-stage listing approval, attachment pipelines, promo collections, analytics, and a tamper-evident audit trail.

---

## Strict Compliance Summary

This project is operated **Docker-only**. No local Node/npm installation or manual host setup is required — or supported — for running the application. Every supported workflow (startup, verification, testing, teardown) runs through `docker compose` or `./run_tests.sh` inside containers.

- **Runtime**: `docker compose up --build` boots the entire stack (MySQL + API + web).
- **Tests**: `./run_tests.sh` runs backend Jest, frontend Vitest, and Playwright E2E inside Docker.
- **Verification**: deterministic `curl` + UI login playbook below.
- **Reset**: `docker compose down -v` wipes all state.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Architecture](#architecture)
- [Startup](#startup)
- [Verification](#verification)
- [Default Credentials](#default-credentials)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Testing](#testing)
- [Teardown](#teardown)
- [Project Structure](#project-structure)

---

## Prerequisites

| Tool | Version |
|------|---------|
| Docker Engine | 24+ |
| Docker Compose | v2 (plugin) |

No host-side Node.js, npm, MySQL, or build tooling is required. All runtime and build dependencies are containerized.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser                                        │
│  Vue 3 SPA  (Pinia · vue-router · IndexedDB)    │
└───────────────────┬─────────────────────────────┘
                    │ HTTP / nginx proxy (:80)
┌───────────────────▼─────────────────────────────┐
│  nginx:1.27-alpine                              │
│  • serves /usr/share/nginx/html (Vite bundle)   │
│  • proxies /api/* → api:3000                    │
│  • proxies /healthz → api:3000                  │
└───────────────────┬─────────────────────────────┘
                    │ :3000 (internal)
┌───────────────────▼─────────────────────────────┐
│  Koa API  (Node 20 · TypeScript · ts-node)      │
│  • Knex migrations + seeds on every startup     │
│  • JWT HS256 auth · bcrypt passwords            │
│  • SHA-256 hash-chain audit log                 │
│  • DB-backed job scheduler (60 s polling)       │
│  • sharp image pipeline · file-type MIME guard  │
└───────────────────┬─────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────┐
│  MySQL 8.0                                      │
│  Named volume: db_data                          │
└─────────────────────────────────────────────────┘
```

Monorepo layout:

```
repo/
├── apps/
│   ├── api/          Koa REST API
│   └── web/          Vue 3 frontend
├── packages/
│   └── shared/       Shared TypeScript types & error codes
├── docker-compose.yml
├── Dockerfile.api
├── Dockerfile.web
├── nginx.conf
└── run_tests.sh
```

---

## Startup

Single command boots the full stack:

```bash
docker compose up --build
```

First run performs:

1. Start MySQL 8 and wait until healthy
2. Build and start the Koa API (runs migrations + seeds on startup)
3. Build the Vue frontend and serve it via nginx

Access point: **http://localhost** (redirects to HTTPS on 443 by default; see [HTTPS / SSL](#https--ssl)).

For HTTP-only mode:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

---

## Verification

Run this checklist immediately after `docker compose up --build` reports all services healthy. Every step is deterministic — exact status code and response shape listed.

### 1. Container health

```bash
docker compose ps
```

Expected: `db`, `api`, `web` containers in `running` state, each with `healthy` under STATUS.

### 2. API liveness probe

```bash
curl -fsS http://localhost/healthz
```

Expected HTTP `200`, JSON body:

```json
{"ok":true,"data":{"version":"<semver>","status":"ok","chainHead":"<hash-or-null>"}}
```

Fail condition: non-200 status, `ok:false`, or connection refused.

### 3. Timezone config probe

```bash
curl -fsS http://localhost/api/v1/config/timezone
```

Expected HTTP `200`, body shape: `{"ok":true,"data":{"timezone":"America/New_York"}}`.

### 4. Public consent version

```bash
curl -fsS http://localhost/api/v1/auth/consent-version
```

Expected HTTP `200`, `data.version` and `data.body_md` present as strings.

### 5. Demo login — administrator

```bash
NONCE=$(curl -fsS http://localhost/api/v1/auth/nonce/login | jq -r '.data.nonce')
curl -fsS -X POST http://localhost/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{\"username\":\"admin\",\"password\":\"Admin@harborstone1\",\"nonce\":\"$NONCE\"}"
```

Expected HTTP `200`, body contains `data.accessToken`, `data.refreshToken`, `data.user.role == "administrator"`, and `data.mustChangePassword == true` on first login.

### 6. Authenticated probe

Using the `accessToken` from step 5:

```bash
curl -fsS http://localhost/api/v1/auth/me \
  -H "Authorization: Bearer <accessToken>"
```

Expected HTTP `200`, `data.username == "admin"`, `data.role == "administrator"`, `data.password_hash` absent.

### 7. Audit chain integrity

```bash
curl -fsS http://localhost/api/v1/admin/audit-chain \
  -H "Authorization: Bearer <accessToken>"
```

Expected HTTP `200`, `data.valid == true`.

### 8. UI smoke

1. Browse **http://localhost** (accept self-signed cert on 443 if prompted).
2. Sign in as `admin` / `Admin@harborstone1`.
3. Complete the forced password change screen.
4. Verify the main dashboard loads with the navigation bar (Listings, Promo, Analytics, Admin).

Any failed step above indicates the stack is not usable — stop, collect logs (`docker compose logs`), and re-run `docker compose down -v && docker compose up --build` from a clean state.

---

## Default Credentials

Four demo accounts are seeded automatically on first startup. Passwords come from environment variables; defaults shown below.

> **Change these before any internet-facing deployment.** The `admin` account has `must_change_password = true` and will prompt for a new password on first login.

| Username | Role | Default Password | Notes |
|---|---|---|---|
| `admin` | `administrator` | `Admin@harborstone1` | Full access; must change password on first login |
| `ops_user` | `operations` | `Ops@harborstone1` | Promo management, KPI analytics, CSV exports |
| `merchant_user` | `merchant` | `Merchant@harborstone1` | Approve/publish own-office listings, manage inventory |
| `agent_user` | `regular_user` | `Agent@harborstone1` | Drafts/edits own listings, uploads attachments |

Override passwords via a `.env` file at the repo root (consumed by Docker Compose):

```dotenv
SEED_ADMIN_PASSWORD=MySecureAdmin!99
SEED_OPS_PASSWORD=MySecureOps!99
SEED_MERCHANT_PASSWORD=MySecureMerchant!99
SEED_AGENT_PASSWORD=MySecureAgent!99
```

Seeds are idempotent — re-running never overwrites an existing user.

---

## Environment Variables

All variables have defaults in `docker-compose.yml`. Override via a `.env` file at the repo root.

### Database

| Variable | Default | Description |
|---|---|---|
| `MYSQL_ROOT_PASSWORD` | `harborstone_root` | MySQL root password |
| `DB_NAME` | `harborstone` | Database name |
| `DB_USER` | `harborstone` | Database user |
| `DB_PASSWORD` | `harborstone_pass` | Database password |
| `DB_PORT_EXPOSED` | `3306` | Host port for MySQL (direct access) |

### API

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | `CHANGE_ME_BEFORE_GOING_LIVE_32chars` | HS256 signing secret — **must be changed** |
| `BCRYPT_COST` | `12` | bcrypt work factor (10–14 recommended) |
| `LOG_LEVEL` | `info` | Pino log level (`trace` `debug` `info` `warn` `error`) |
| `TZ_IANA` | `America/New_York` | Server timezone |

### Seed Users

| Variable | Default | Description |
|---|---|---|
| `SEED_ADMIN_PASSWORD` | `Admin@harborstone1` | Password for `admin` (administrator) |
| `SEED_OPS_PASSWORD` | `Ops@harborstone1` | Password for `ops_user` (operations) |
| `SEED_MERCHANT_PASSWORD` | `Merchant@harborstone1` | Password for `merchant_user` (merchant) |
| `SEED_AGENT_PASSWORD` | `Agent@harborstone1` | Password for `agent_user` (regular_user) |

### Ports

| Variable | Default | Description |
|---|---|---|
| `WEB_PORT` | `80` | Host port for HTTP (redirects to HTTPS by default) |
| `WEB_SSL_PORT` | `443` | Host port for HTTPS |

### HTTPS / SSL

Default `docker compose up --build` starts with **HTTPS enabled**. On first startup, a self-signed TLS certificate is auto-generated inside the web container. HTTP on port 80 redirects to HTTPS on port 443.

To trust the auto-generated certificate, install it in your browser/OS trust store. The cert is logged at startup: `/etc/ssl/certs/harborstone.crt`.

Using your own CA-signed certificate:

```bash
# Place cert files in ./certs/ and use the SSL overlay
mkdir -p certs
cp /path/to/your/cert.crt certs/harborstone.crt
cp /path/to/your/cert.key certs/harborstone.key
docker compose -f docker-compose.yml -f docker-compose.ssl.yml up --build
```

HTTP-only development mode (no TLS):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

---

## API Reference

All API routes are prefixed with `/api/v1`. Responses follow the envelope:

```json
{ "ok": true,  "data": { ... } }
{ "ok": false, "error": { "code": "ERR_CODE", "message": "..." } }
```

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/healthz` | — | Liveness check; returns version and audit chain head |
| `GET` | `/api/v1/config/timezone` | — | Server IANA timezone |

### Authentication (`/api/v1/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/auth/captcha-challenge` | — | Fetch offline CAPTCHA challenge |
| `GET` | `/api/v1/auth/consent-version` | — | Current consent version and body |
| `GET` | `/api/v1/auth/nonce/login` | — | Issue a single-use login nonce |
| `POST` | `/api/v1/auth/login` | — | Authenticate; returns `accessToken` + `refreshToken` |
| `POST` | `/api/v1/auth/refresh` | — | Exchange refresh token for new access token |
| `POST` | `/api/v1/auth/logout` | Bearer | Invalidate current session |
| `POST` | `/api/v1/auth/consent` | Bearer | Record user consent acceptance |
| `POST` | `/api/v1/auth/change-password` | Bearer + consent | Change own password |
| `GET` | `/api/v1/auth/nonce/:purpose` | Bearer | Issue a single-use nonce |
| `GET` | `/api/v1/auth/me` | Bearer + consent | Current user profile |

### Users (`/api/v1/users`) — administrator only

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/users` | Create a new user |
| `GET` | `/api/v1/users` | List users (paginated) |
| `GET` | `/api/v1/users/:id` | Get user by ID |
| `PATCH` | `/api/v1/users/:id` | Update user (role, status, office) |
| `POST` | `/api/v1/users/:id/unlock` | Clear lockout on a user account |
| `POST` | `/api/v1/users/:id/force-reset` | Force password reset on next login |

### Offices (`/api/v1/offices`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/offices` | Bearer | List all offices |
| `POST` | `/api/v1/offices` | Bearer + admin | Create office |
| `PATCH` | `/api/v1/offices/:id` | Bearer + admin | Update office |

### Listings (`/api/v1/listings`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/listings` | Create listing (draft) |
| `GET` | `/api/v1/listings` | List listings (filterable by status, office, agent) |
| `GET` | `/api/v1/listings/:id` | Get listing detail |
| `PATCH` | `/api/v1/listings/:id` | Update listing fields |
| `GET` | `/api/v1/listings/:id/revisions` | Revision history |
| `POST` | `/api/v1/listings/:id/submit` | Submit draft for review |
| `POST` | `/api/v1/listings/:id/approve` | Approve listing (merchant/administrator) |
| `POST` | `/api/v1/listings/:id/reject` | Reject listing with reason |
| `POST` | `/api/v1/listings/:id/publish` | Publish approved listing |
| `POST` | `/api/v1/listings/:id/archive` | Archive published listing |
| `POST` | `/api/v1/listings/:id/reverse` | Reverse last state transition |
| `DELETE` | `/api/v1/listings/:id` | Soft-delete listing |
| `POST` | `/api/v1/listings/:id/restore` | Restore soft-deleted listing |
| `POST` | `/api/v1/listings/:id/favorite` | Record favorite engagement event |
| `POST` | `/api/v1/listings/:id/share` | Record share engagement event |

### Attachments (`/api/v1/listings/:listingId/attachments`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/listings/:listingId/attachments` | Upload file (multipart/form-data; images stripped of EXIF and resized) |
| `GET` | `/api/v1/listings/:listingId/attachments` | List attachments |
| `PUT` | `/api/v1/listings/:listingId/attachments/:id` | Replace attachment content (new revision) |
| `DELETE` | `/api/v1/listings/:listingId/attachments/:id` | Delete attachment |
| `GET` | `/api/v1/listings/:listingId/attachments/:id/revisions` | Attachment revision history |
| `POST` | `/api/v1/listings/:listingId/attachments/:id/rollback` | Roll back to a previous revision |
| `GET` | `/api/v1/listings/:listingId/attachments/rejections` | List rejected files |

### Promo Collections (`/api/v1/promo`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/promo` | ops/admin | Create promo collection |
| `GET` | `/api/v1/promo` | Bearer | List collections |
| `GET` | `/api/v1/promo/:id` | Bearer | Get collection detail |
| `PATCH` | `/api/v1/promo/:id` | ops/admin | Update collection |
| `POST` | `/api/v1/promo/:id/click` | Bearer | Record click engagement event |
| `POST` | `/api/v1/promo/:id/activate` | ops/admin | Activate collection |
| `POST` | `/api/v1/promo/:id/cancel` | ops/admin | Cancel collection |
| `POST` | `/api/v1/promo/:id/slots` | ops/admin | Add listing to collection |
| `DELETE` | `/api/v1/promo/:id/slots/:slotId` | ops/admin | Remove slot |
| `PUT` | `/api/v1/promo/:id/slots/reorder` | ops/admin | Reorder slots |

### Analytics (`/api/v1/analytics`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/analytics/kpi` | KPI snapshot (listings by status, attach counts, promo stats) |
| `GET` | `/api/v1/analytics/funnel` | Listing state-transition funnel |
| `POST` | `/api/v1/analytics/exports` | Queue a CSV export job |
| `GET` | `/api/v1/analytics/exports/:jobId` | Poll export job status |
| `GET` | `/api/v1/analytics/exports/:jobId/download` | Download completed export |

### Admin (`/api/v1/admin`) — administrator only

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/admin/risk/:userId` | Get user risk score |
| `POST` | `/api/v1/admin/risk/:userId/penalty` | Apply manual risk penalty |
| `GET` | `/api/v1/admin/blacklist` | List IP blacklist entries |
| `POST` | `/api/v1/admin/blacklist` | Add IP to blacklist |
| `DELETE` | `/api/v1/admin/blacklist/:id` | Remove IP from blacklist |
| `POST` | `/api/v1/admin/purge/listing/:id` | Hard-purge a listing and all related data |
| `POST` | `/api/v1/admin/purge/user/:id` | Hard-purge user and all associated data (irreversible) |
| `GET` | `/api/v1/admin/audit-chain` | Verify audit chain integrity |
| `GET` | `/api/v1/admin/job-runs` | List scheduled job run history |

---

## Testing

All tests run inside Docker — no host-side Node/npm required.

```bash
./run_tests.sh
```

Runs by default:

1. **Backend** — Jest suite (SQLite in-memory, no MySQL needed)
2. **Frontend type-check** — vue-tsc `--noEmit` (compile-time correctness)
3. **Frontend unit** — Vitest suite (API client, stores, views, happy-dom)
4. **Frontend E2E** — Playwright against the full `docker compose` stack

Skip E2E for faster iteration:

```bash
./run_tests.sh --no-e2e
```

The Playwright suite lives at [`apps/web/e2e/`](apps/web/e2e/) (configured by [`apps/web/playwright.config.ts`](apps/web/playwright.config.ts)).

### Continuous integration

Merges to `main` are gated by the GitHub Actions workflow at [`.github/workflows/ci.yml`](.github/workflows/ci.yml), which runs typecheck, unit tests, and production builds for both the API and the web app on every pull request. The Playwright suite is opt-in via `workflow_dispatch` so regular PRs stay fast.

### Backup and restore

Point-in-time backup + restore of the MySQL database and attachment volume live in [`scripts/backup.sh`](scripts/backup.sh) and [`scripts/restore.sh`](scripts/restore.sh). Backup produces a timestamped `db.sql.gz`, `attachments.tar.gz`, and a `manifest.txt` with sha256 checksums; restore verifies the manifest before applying.

---

## Teardown

Stop containers, preserve data:

```bash
docker compose down
```

Stop and wipe all data volumes (full reset):

```bash
docker compose down -v
```

---

## Project Structure

```
apps/api/src/
├── audit/          SHA-256 hash-chain audit log
├── clock/          Clock abstraction (system + test implementations)
├── config/         Environment variable loader
├── db/
│   ├── knex.ts     Knex instance (dual ts-node/compiled mode)
│   ├── migrations/ 21 Knex migration files
│   └── seeds/      Settings, consent, and default users
├── errors/         Error types and Koa error-handling middleware
├── jobs/           DB-backed scheduler (8 jobs, 60 s polling)
├── logger/         Pino structured logger with secret redaction
├── middleware/     Auth, CSRF, idempotency, IP rate-limit
├── routes/         Koa routers (health, auth, users, listings, ...)
└── services/       Business logic (listing, attachment, risk, export, ...)

apps/web/src/
├── api/            Axios client with JWT interceptors
├── components/     Shared Vue components
├── composables/    Composition API hooks
├── router/         vue-router configuration
├── stores/         Pinia stores (auth, listings, offline outbox, ...)
└── views/          Page-level Vue components

packages/shared/src/
├── errors.ts       Shared error code constants
└── types.ts        Shared TypeScript interfaces
```
