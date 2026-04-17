# HarborStone Listings Operations Suite API Specification

Generated: 2026-04-16

## Table of Contents

1. [Overview](#overview)
2. [Global Conventions](#global-conventions)
3. [Common Schemas](#common-schemas)
4. [System Endpoints](#system-endpoints)
5. [Authentication Endpoints](#authentication-endpoints)
6. [User Management Endpoints](#user-management-endpoints)
7. [Office Endpoints](#office-endpoints)
8. [Listing Endpoints](#listing-endpoints)
9. [Attachment Endpoints](#attachment-endpoints)
10. [Promo Endpoints](#promo-endpoints)
11. [Analytics Endpoints](#analytics-endpoints)
12. [Admin Endpoints](#admin-endpoints)
13. [Assumptions](#assumptions)

## Overview

- API style: REST over HTTP (Koa + koa-router).
- API version prefix: `/api/v1` (except `/healthz`).
- GraphQL/RPC/WebSocket endpoints: none detected.
- Route registration: static registration via route modules; no dynamic route discovery at runtime.

## Global Conventions

### Base URL

- Local default: `http://localhost:3000`

### Content Types

- JSON endpoints:
  - Request: `Content-Type: application/json`
  - Response: `Content-Type: application/json`
- Attachment upload/replace:
  - Request: `multipart/form-data`

### Success Envelope

```json
{
  "ok": true,
  "data": {}
}
```

Some success responses return only:

```json
{
  "ok": true
}
```

### Error Envelope

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable error",
    "details": {}
  }
}
```

### Authentication and Authorization

- Auth mechanism: `Authorization: Bearer <accessToken>`.
- Access token claims: `sub`, `role`, `officeId`, `jti`, `type=access`.
- Session enforcement:
  - Session must be active and unrevoked.
  - Absolute expiry: 8 hours.
  - Inactivity timeout: 30 minutes sliding.
- Role values:
  - `regular_user`
  - `merchant`
  - `operations`
  - `administrator`
- Consent gate: endpoints using `requireConsent()` return `403 CONSENT_REQUIRED` if latest consent not accepted.

### Header Profiles

- Profile P1 (Public GET): no auth header required.
- Profile P2 (Authenticated GET):
  - `Authorization: Bearer <accessToken>`
- Profile P3 (Authenticated mutating `/api/*`):
  - `Authorization: Bearer <accessToken>`
  - `Idempotency-Key: <uuidv4>`
  - `X-CSRF-Token: <token>`
- Profile P4 (Public mutating auth bootstrap paths):
  - `Idempotency-Key: <uuidv4>`
  - CSRF is skipped for `/api/v1/auth/login` and `/api/v1/auth/refresh`

### CSRF

- Applied to all mutating `/api/*` requests when bearer auth context exists.
- CSRF token source:
  - Response header `X-CSRF-Token` on authenticated GET requests.
  - Also returned from login and refresh.

### Idempotency

- Required on all `POST`, `PUT`, `PATCH`, `DELETE` under `/api/*`.
- Header: `Idempotency-Key` UUIDv4.
- Reuse semantics:
  - Same key + same user scope + same route + same payload hash returns stored response snapshot.
  - Reuse with different route/user/payload returns `409 CONFLICT`.
- TTL: 24 hours.

### Rate Limiting

- Global API throttle (`/api/*`): 300 requests/min/IP.
- Failed-auth throttle (401/403 outcomes): 30 failed requests/15 min/IP.
- Login-specific throttles:
  - Burst throttle: 120 requests/min/IP.
  - Failed-login throttle: 30 failed attempts/15 min/IP.
- Throttled responses return `429` and `Retry-After` header.

### Common Status Codes

- `200` OK
- `201` Created
- `202` Accepted
- `400` Validation error
- `401` Unauthorized / invalid credentials / nonce issues
- `403` Forbidden / consent required / role mismatch / CSRF invalid
- `404` Not found
- `409` Conflict / optimistic lock / idempotency collision
- `422` Illegal transition / attachment rejected
- `429` Rate limited
- `500` Internal server error

### Allowed Methods Behavior

- Router `allowedMethods()` is enabled; unsupported method on known route may return `405`.

## Common Schemas

### User (safe response)

```json
{
  "id": 1,
  "username": "admin",
  "role": "administrator",
  "office_id": 1,
  "status": "active",
  "failed_login_count": 0,
  "locked_until": null,
  "must_change_password": 1,
  "consent_version_accepted": 1,
  "consent_accepted_at": "2026-04-16T00:00:00.000Z",
  "last_password_change_at": "2026-04-16T00:00:00.000Z",
  "created_at": "2026-04-16T00:00:00.000Z",
  "updated_at": "2026-04-16T00:00:00.000Z"
}
```

### Office

```json
{
  "id": 1,
  "name": "Main Office",
  "code": "MAIN",
  "active": 1
}
```

### Listing

```json
{
  "id": 10,
  "office_id": 1,
  "created_by": 4,
  "status": "draft",
  "price_usd_cents": 45000000,
  "area_sqft": 1200,
  "area_sqm": 111.48,
  "beds": 2,
  "baths": 1.5,
  "floor_level": 8,
  "orientation": "SE",
  "latitude": 40.712345,
  "longitude": -74.012345,
  "address_line": "123 Main St",
  "city": "New York",
  "state_code": "NY",
  "postal_code": "10001",
  "layout_normalized": "2 bed 1.5 bath",
  "anomaly_flags": [],
  "soft_deleted_at": null,
  "published_at": null,
  "version": 1,
  "created_at": "2026-04-16T00:00:00.000Z",
  "updated_at": "2026-04-16T00:00:00.000Z"
}
```

### AttachmentPublic

```json
{
  "id": 7,
  "listing_id": 10,
  "kind": "image",
  "original_filename": "front.jpg",
  "bytes": 234567,
  "mime": "image/jpeg",
  "width": 1600,
  "height": 900,
  "duration_seconds": null,
  "created_at": "2026-04-16T00:00:00.000Z"
}
```

### PromoCollection

```json
{
  "id": 3,
  "title": "Spring Deals",
  "theme_date": "2026-04-20",
  "starts_at": "2026-04-20T00:00:00.000Z",
  "ends_at": "2026-04-27T00:00:00.000Z",
  "status": "scheduled",
  "created_by": 2,
  "created_at": "2026-04-16T00:00:00.000Z",
  "updated_at": "2026-04-16T00:00:00.000Z"
}
```

### ExportJobPublic

```json
{
  "id": 12,
  "status": "completed",
  "bytes": 14523,
  "requested_at": "2026-04-16 12:00:00.000",
  "completed_at": "2026-04-16 12:00:04.000",
  "expires_at": "2026-04-23 12:00:00.000"
}
```

## System Endpoints

### GET /healthz

- Description: Health check with package version and current audit-chain head hash.
- Auth: P1.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Path | None | No | - |
| Query | None | No | - |
| Headers | None | No | - |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Health payload | `{ ok: true, data: { version, status, chainHead } }` |
| 500 | Unexpected error | Error envelope |

Validation rules:

- None.

Example request:

```bash
curl -X GET http://localhost:3000/healthz
```

Example response:

```json
{
  "ok": true,
  "data": {
    "version": "1.0.0",
    "status": "ok",
    "chainHead": "9a4f..."
  }
}
```

### GET /api/v1/config/timezone

- Description: Returns install-configured timezone value.
- Auth: P1.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Path | None | No | - |
| Query | None | No | - |
| Headers | None | No | - |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Timezone payload | `{ ok: true, data: { timezone: string } }` |
| 500 | Unexpected error | Error envelope |

Validation rules:

- None.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/config/timezone
```

Example response:

```json
{
  "ok": true,
  "data": {
    "timezone": "America/New_York"
  }
}
```

## Authentication Endpoints

### GET /api/v1/auth/nonce/login

- Description: Issues one-time nonce for login replay protection.
- Auth: P1.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Path | None | No | - |
| Query | None | No | - |
| Headers | None | No | - |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Nonce issued | `{ ok: true, data: { nonce: string } }` |
| 500 | Unexpected error | Error envelope |

Validation rules:

- Nonce expires in 5 minutes.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/auth/nonce/login
```

Example response:

```json
{
  "ok": true,
  "data": {
    "nonce": "kJm0Qd..."
  }
}
```

### POST /api/v1/auth/login

- Description: Authenticates user and creates session; returns access/refresh tokens.
- Auth: P4.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Path | None | No | - |
| Query | None | No | - |
| Headers | Idempotency-Key | Yes | UUIDv4 |
| Headers | X-Device-Fingerprint | No | string |
| Body | username | Yes | string |
| Body | password | Yes | string |
| Body | nonce | Yes | string |
| Body | captchaToken | Conditional | string |
| Body | captchaAnswer | Conditional | number |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Login success | `{ ok: true, data: { accessToken, refreshToken, user, requiresConsent, mustChangePassword } }` + `X-CSRF-Token` header |
| 400 | Missing/invalid required fields | Error envelope |
| 401 | Invalid credentials / CAPTCHA required / blacklist deny | Error envelope |
| 409 | Idempotency key collision | Error envelope |
| 429 | Login/IP rate limit exceeded | Error envelope + `Retry-After` |
| 500 | Unexpected error | Error envelope |

Validation rules:

- `username` and `password` are required.
- `nonce` is required and must be valid for purpose `login`.
- If offline CAPTCHA is enabled and user failure count >= 5, `captchaToken` and `captchaAnswer` are required.
- Disabled/locked/blacklisted principals are denied.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 11111111-1111-4111-8111-111111111111" \
  -H "X-Device-Fingerprint: browser-abc" \
  -d '{"username":"admin","password":"Admin@harborstone1","nonce":"kJm0Qd..."}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "user": {
      "id": 1,
      "username": "admin",
      "role": "administrator",
      "officeId": 1
    },
    "requiresConsent": false,
    "mustChangePassword": true
  }
}
```

### POST /api/v1/auth/refresh

- Description: Rotates refresh token and issues new access token.
- Auth: P4.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Idempotency-Key | Yes | UUIDv4 |
| Headers | X-Device-Fingerprint | Conditional | string |
| Body | refreshToken | Yes | JWT string |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Token refresh success | `{ ok: true, data: { accessToken, refreshToken } }` + `X-CSRF-Token` header |
| 400 | Missing refreshToken | Error envelope |
| 401 | Invalid/expired token, revoked session, fingerprint mismatch | Error envelope |
| 409 | Idempotency key collision | Error envelope |
| 429 | Rate-limited | Error envelope + `Retry-After` |
| 500 | Unexpected error | Error envelope |

Validation rules:

- `refreshToken` required.
- If session was created with `device_fingerprint`, caller must provide identical `X-Device-Fingerprint`.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 22222222-2222-4222-8222-222222222222" \
  -H "X-Device-Fingerprint: browser-abc" \
  -d '{"refreshToken":"eyJ..."}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

### POST /api/v1/auth/logout

- Description: Revokes current session.
- Auth: P3.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Headers | X-CSRF-Token | Yes | string |
| Headers | Idempotency-Key | Yes | UUIDv4 |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Logout success | `{ ok: true }` |
| 401 | Missing/invalid auth | Error envelope |
| 403 | CSRF invalid | Error envelope |
| 409 | Idempotency collision | Error envelope |

Validation rules:

- Session JTI from token must be active.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 33333333-3333-4333-8333-333333333333"
```

Example response:

```json
{
  "ok": true
}
```

### POST /api/v1/auth/consent

- Description: Records consent acceptance for a specific consent version.
- Auth: P3 (no explicit `requireConsent` gate).

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Headers | X-CSRF-Token | Yes | string |
| Headers | Idempotency-Key | Yes | UUIDv4 |
| Body | versionId | Yes | integer |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Consent recorded | `{ ok: true }` |
| 400 | Missing versionId | Error envelope |
| 401 | Unauthorized | Error envelope |
| 404 | Consent version not found | Error envelope |
| 403 | CSRF invalid | Error envelope |

Validation rules:

- `versionId` must exist in `consent_versions`.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/auth/consent \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 44444444-4444-4444-8444-444444444444" \
  -H "Content-Type: application/json" \
  -d '{"versionId":1}'
```

Example response:

```json
{
  "ok": true
}
```

### POST /api/v1/auth/change-password

- Description: Changes password, revokes all sessions, issues new session tokens.
- Auth: P3 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Headers | X-CSRF-Token | Yes | string |
| Headers | Idempotency-Key | Yes | UUIDv4 |
| Body | currentPassword | Yes | string |
| Body | newPassword | Yes | string |
| Body | nonce | Yes | string (purpose `change_password`) |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Password changed | `{ ok: true, data: { accessToken, refreshToken } }` |
| 400 | Validation/policy/history failure | Error envelope |
| 401 | Invalid current password / nonce invalid | Error envelope |
| 403 | Consent required / CSRF invalid | Error envelope |
| 404 | User not found | Error envelope |

Validation rules:

- Password policy:
  - min 12 chars
  - uppercase, lowercase, digit
  - symbol from `!@#$%^&*()_+-=[]{};':,.?/\\|~`
- New password cannot match last 5 password hashes.
- Nonce required and actor-bound.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/auth/change-password \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 55555555-5555-4555-8555-555555555555" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"OldPass@123","newPassword":"NewPass@12345","nonce":"abc..."}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

### GET /api/v1/auth/nonce/:purpose

- Description: Issues authenticated nonce for sensitive actions.
- Auth: P2.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Path | purpose | Yes | enum: `change_password`, `publish`, `approve`, `role_change`, `purge` |
| Headers | Authorization | Yes | Bearer token |
| Query | None | No | - |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Nonce issued | `{ ok: true, data: { nonce: string } }` |
| 400 | Invalid purpose | Error envelope |
| 401 | Unauthorized | Error envelope |

Validation rules:

- Purpose must be in allowed set above.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/auth/nonce/publish \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": {
    "nonce": "xYz..."
  }
}
```

### GET /api/v1/auth/me

- Description: Returns current authenticated user profile (without password hash).
- Auth: P2 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Path/Query/Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | User profile | `{ ok: true, data: User }` |
| 401 | Unauthorized | Error envelope |
| 403 | Consent required | Error envelope |
| 404 | User not found | Error envelope |

Validation rules:

- Active authenticated session required.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 1,
    "username": "admin",
    "role": "administrator",
    "office_id": 1,
    "status": "active"
  }
}
```

### GET /api/v1/auth/consent-version

- Description: Returns latest consent version (public endpoint).
- Auth: P1.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Path/Query/Headers/Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Consent document | `{ ok: true, data: { id, version, body_md } }` |

Validation rules:

- If no version exists, returns fallback `id=0`, `version=1.0` body text.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/auth/consent-version
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 1,
    "version": "1.0",
    "body_md": "# Privacy Consent and Terms of Use..."
  }
}
```

### GET /api/v1/auth/captcha-challenge

- Description: Returns offline arithmetic CAPTCHA challenge and token.
- Auth: P1.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Path/Query/Headers/Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | CAPTCHA challenge | `{ ok: true, data: { question, token } }` |

Validation rules:

- Token TTL: 5 minutes.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/auth/captcha-challenge
```

Example response:

```json
{
  "ok": true,
  "data": {
    "question": "What is 7 + 13?",
    "token": "d36f...:1713222222222"
  }
}
```

## User Management Endpoints

### POST /api/v1/users

- Description: Creates a user (admin only).
- Auth: P3 + role `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Headers | X-CSRF-Token | Yes | string |
| Headers | Idempotency-Key | Yes | UUIDv4 |
| Body | username | Yes | string |
| Body | password | Yes | string |
| Body | role | Yes | enum user role |
| Body | office_id | Conditional | integer (`merchant`/`regular_user` required) |
| Body | status | No | enum: `active`, `locked`, `disabled` |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 201 | Created | `{ ok: true, data: User }` |
| 400 | Validation/policy failure | Error envelope |
| 401 | Unauthorized | Error envelope |
| 403 | Forbidden role/CSRF | Error envelope |
| 409 | Username conflict | Error envelope |

Validation rules:

- Password policy same as change-password endpoint.
- Role must be valid enum.
- `office_id` mandatory for `merchant` and `regular_user`.
- Username uniqueness is case-insensitive.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/users \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 66666666-6666-4666-8666-666666666666" \
  -H "Content-Type: application/json" \
  -d '{"username":"agent2","password":"Agent2@pass123","role":"regular_user","office_id":1}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 9,
    "username": "agent2",
    "role": "regular_user",
    "office_id": 1,
    "status": "active"
  }
}
```

### GET /api/v1/users

- Description: Lists users with cursor pagination and optional username search (admin only).
- Auth: P2 + role `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Query | limit | No | integer (default 20, max 100) |
| Query | cursor | No | integer user id |
| Query | search | No | string (case-insensitive username match) |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | User list | `{ ok: true, data: { items: UserWithSessionInfo[], nextCursor } }` |
| 401 | Unauthorized | Error envelope |
| 403 | Forbidden role | Error envelope |

Validation rules:

- `limit` capped at 100.

Example request:

```bash
curl -X GET "http://localhost:3000/api/v1/users?limit=20&search=agent" \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": 4,
        "username": "agent_user",
        "role": "regular_user",
        "last_ip": "127.0.0.1",
        "last_device_fingerprint": "browser-abc",
        "session_last_activity_at": "2026-04-16T12:03:00.000Z"
      }
    ],
    "nextCursor": null
  }
}
```

### GET /api/v1/users/:id

- Description: Fetches single user by id (admin only).
- Auth: P2 + role `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Path | id | Yes | integer |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | User found | `{ ok: true, data: User }` |
| 401 | Unauthorized | Error envelope |
| 403 | Forbidden role | Error envelope |
| 404 | User not found | Error envelope |

Validation rules:

- `id` must refer to existing user row.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/users/4 \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 4,
    "username": "agent_user",
    "role": "regular_user",
    "office_id": 1,
    "status": "active"
  }
}
```

### PATCH /api/v1/users/:id

- Description: Updates user role/status/office/password-reset flag (admin only).
- Auth: P3 + role `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Headers | X-CSRF-Token | Yes | string |
| Headers | Idempotency-Key | Yes | UUIDv4 |
| Path | id | Yes | integer |
| Body | role | No | enum role |
| Body | status | No | enum: `active`,`locked`,`disabled` |
| Body | office_id | No | integer or null |
| Body | must_change_password | No | boolean |
| Body | nonce | Conditional | string (required for role change) |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Updated | `{ ok: true, data: User }` |
| 400 | Validation/no fields/nonce missing | Error envelope |
| 401 | Unauthorized/nonce invalid | Error envelope |
| 403 | Forbidden role/CSRF | Error envelope |
| 404 | User not found | Error envelope |

Validation rules:

- At least one updatable field required.
- Role change requires nonce purpose `role_change` bound to admin actor.
- Role/status values validated against enums.

Example request:

```bash
curl -X PATCH http://localhost:3000/api/v1/users/4 \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 77777777-7777-4777-8777-777777777777" \
  -H "Content-Type: application/json" \
  -d '{"status":"locked"}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 4,
    "username": "agent_user",
    "status": "locked"
  }
}
```

### POST /api/v1/users/:id/unlock

- Description: Unlocks user and resets failed counters (admin only).
- Auth: P3 + role `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Headers | X-CSRF-Token | Yes | string |
| Headers | Idempotency-Key | Yes | UUIDv4 |
| Path | id | Yes | integer |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Unlocked | `{ ok: true }` |
| 404 | User not found | Error envelope |
| 401/403 | Unauthorized/forbidden | Error envelope |

Validation rules:

- Existing user required.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/users/4/unlock \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 88888888-8888-4888-8888-888888888888"
```

Example response:

```json
{
  "ok": true
}
```

### POST /api/v1/users/:id/force-reset

- Description: Forces password reset on next login and revokes sessions (admin only).
- Auth: P3 + role `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Headers | X-CSRF-Token | Yes | string |
| Headers | Idempotency-Key | Yes | UUIDv4 |
| Path | id | Yes | integer |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Force reset applied | `{ ok: true }` |
| 404 | User not found | Error envelope |
| 401/403 | Unauthorized/forbidden | Error envelope |

Validation rules:

- Existing user required.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/users/4/force-reset \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 99999999-9999-4999-8999-999999999999"
```

Example response:

```json
{
  "ok": true
}
```

## Office Endpoints

### POST /api/v1/offices

- Description: Creates office (admin only).
- Auth: P3 + role `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Headers | X-CSRF-Token | Yes | string |
| Headers | Idempotency-Key | Yes | UUIDv4 |
| Body | name | Yes | string |
| Body | code | Yes | string |
| Body | active | No | integer (0 or 1) |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 201 | Created | `{ ok: true, data: Office }` |
| 400 | Missing fields | Error envelope |
| 409 | Office code conflict | Error envelope |
| 401/403 | Unauthorized/forbidden | Error envelope |

Validation rules:

- `code` unique; stored uppercase.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/offices \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" \
  -H "Content-Type: application/json" \
  -d '{"name":"Downtown","code":"dt"}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 2,
    "name": "Downtown",
    "code": "DT",
    "active": 1
  }
}
```

### GET /api/v1/offices

- Description: Lists offices (any authenticated user).
- Auth: P2.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Path/Query/Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Office list | `{ ok: true, data: Office[] }` |
| 401 | Unauthorized | Error envelope |

Validation rules:

- None.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/offices \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": [
    { "id": 1, "name": "Main Office", "code": "MAIN", "active": 1 }
  ]
}
```

### PATCH /api/v1/offices/:id

- Description: Updates office fields (admin only).
- Auth: P3 + role `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Headers | X-CSRF-Token | Yes | string |
| Headers | Idempotency-Key | Yes | UUIDv4 |
| Path | id | Yes | integer |
| Body | name | No | string |
| Body | code | No | string |
| Body | active | No | integer (0 or 1) |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Updated | `{ ok: true, data: Office }` |
| 400 | No fields provided | Error envelope |
| 404 | Office not found | Error envelope |
| 409 | Code conflict | Error envelope |
| 401/403 | Unauthorized/forbidden | Error envelope |

Validation rules:

- At least one field required.
- `code` uniqueness enforced if changed.

Example request:

```bash
curl -X PATCH http://localhost:3000/api/v1/offices/2 \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" \
  -H "Content-Type: application/json" \
  -d '{"active":0}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 2,
    "name": "Downtown",
    "code": "DT",
    "active": 0
  }
}
```

## Listing Endpoints

### POST /api/v1/listings

- Description: Creates listing draft.
- Auth: P3 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Headers | X-CSRF-Token | Yes | string |
| Headers | Idempotency-Key | Yes | UUIDv4 |
| Body | price_usd_cents | No | integer |
| Body | area_sqft | No | number |
| Body | area_sqm | No | number |
| Body | beds | No | integer |
| Body | baths | No | number (0.5 increments) |
| Body | floor_level | No | integer |
| Body | orientation | No | enum `N,NE,E,SE,S,SW,W,NW` |
| Body | latitude | No | number |
| Body | longitude | No | number |
| Body | address_line | No | string |
| Body | city | No | string |
| Body | state_code | No | string (2-char US/territory code) |
| Body | postal_code | No | string (`12345` or `12345-6789`) |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 201 | Created | `{ ok: true, data: Listing }` |
| 400 | Validation failure / missing office assignment | Error envelope |
| 403 | Operations role forbidden / consent/CSRF | Error envelope |
| 401 | Unauthorized | Error envelope |

Validation rules:

- Operations cannot create listings.
- User must have `officeId` assigned.
- Cleansing/normalization:
  - `state_code` uppercase + whitelist.
  - `area_sqft`/`area_sqm` auto-converted counterpart.
  - `layout_normalized` inferred when beds+baths provided.
  - anomaly flag `price_per_sqft_out_of_range` computed from settings.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/listings \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: cccccccc-cccc-4ccc-8ccc-cccccccccccc" \
  -H "Content-Type: application/json" \
  -d '{"price_usd_cents":45000000,"area_sqft":1200,"beds":2,"baths":1.5,"state_code":"ny","postal_code":"10001"}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 10,
    "status": "draft",
    "version": 1,
    "state_code": "NY",
    "layout_normalized": "2 bed 1.5 bath"
  }
}
```

### GET /api/v1/listings

- Description: Lists scoped listings with filters and cursor pagination.
- Auth: P2 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Query | office_id | No | integer |
| Query | agent_id | No | integer |
| Query | status | No | string |
| Query | beds_min | No | number |
| Query | beds_max | No | number |
| Query | price_min | No | number |
| Query | price_max | No | number |
| Query | area_min | No | number |
| Query | area_max | No | number |
| Query | city | No | string |
| Query | state_code | No | string |
| Query | updated_since | No | datetime string |
| Query | q | No | string |
| Query | cursor | No | base64 cursor |
| Query | limit | No | integer (default 25, max 100) |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Listing page | `{ ok: true, data: { items: Listing[], nextCursor } }` |
| 401 | Unauthorized | Error envelope |
| 403 | Consent required | Error envelope |

Validation rules:

- Role-based listing scope applies automatically.
- Invalid cursor is ignored (falls back to first page).

Example request:

```bash
curl -X GET "http://localhost:3000/api/v1/listings?status=published&limit=25" \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": {
    "items": [
      { "id": 10, "status": "published", "price_usd_cents": 45000000 }
    ],
    "nextCursor": null
  }
}
```

### GET /api/v1/listings/:id

- Description: Reads one listing by id (with role-based visibility and coordinate masking).
- Auth: P2 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Path | id | Yes | integer |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Listing found | `{ ok: true, data: Listing }` |
| 400 | Invalid id | Error envelope |
| 401 | Unauthorized | Error envelope |
| 403 | Consent required | Error envelope |
| 404 | Not found or not visible | Error envelope |

Validation rules:

- `id` must parse as integer.
- Soft-deleted listings are not returned.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/listings/10 \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 10,
    "status": "published",
    "latitude": 40.71,
    "longitude": -74.01
  }
}
```

### PATCH /api/v1/listings/:id

- Description: Updates listing content with optimistic lock.
- Auth: P3 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Headers | X-CSRF-Token | Yes | string |
| Headers | Idempotency-Key | Yes | UUIDv4 |
| Headers | If-Match | Yes | integer listing version |
| Path | id | Yes | integer |
| Body | Any CreateListingInput field | No | partial listing payload |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Updated | `{ ok: true, data: Listing }` |
| 400 | Invalid id/If-Match or field validation | Error envelope |
| 401 | Unauthorized | Error envelope |
| 403 | Forbidden role/status/consent/CSRF | Error envelope |
| 404 | Not found/not visible | Error envelope |
| 409 | Version conflict | Error envelope |

Validation rules:

- `If-Match` header required and must be integer.
- Regular/merchant can edit only `draft`; admin broader; operations forbidden.

Example request:

```bash
curl -X PATCH http://localhost:3000/api/v1/listings/10 \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: dddddddd-dddd-4ddd-8ddd-dddddddddddd" \
  -H "If-Match: 1" \
  -H "Content-Type: application/json" \
  -d '{"price_usd_cents":45500000}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 10,
    "version": 2,
    "price_usd_cents": 45500000
  }
}
```

### POST /api/v1/listings/:id/submit

- Description: Transitions listing to `in_review`.
- Auth: P3 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Transition success | `{ ok: true, data: Listing }` |
| 400 | Invalid id | Error envelope |
| 403 | Transition forbidden / consent/CSRF | Error envelope |
| 404 | Not found/not visible | Error envelope |
| 422 | Illegal transition | Error envelope |

Validation rules:

- State machine and ownership/office rules applied.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/listings/10/submit \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
```

Example response:

```json
{
  "ok": true,
  "data": { "id": 10, "status": "in_review" }
}
```

### POST /api/v1/listings/:id/approve

- Description: Approves listing.
- Auth: P3 + consent required + role `merchant`(own office) or `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Headers | X-Nonce | Yes | nonce purpose `approve` |
| Path | id | Yes | integer |
| Body | overrideReason | Conditional | string (min 10 chars when anomaly flags present) |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Approved | `{ ok: true, data: Listing }` |
| 400 | Invalid id / missing nonce | Error envelope |
| 401 | Nonce invalid/expired | Error envelope |
| 403 | Role forbidden / consent/CSRF | Error envelope |
| 422 | Illegal transition | Error envelope |

Validation rules:

- `X-Nonce` required and consumed.
- `overrideReason` required if listing has anomaly flags.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/listings/10/approve \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: ffffffff-ffff-4fff-8fff-ffffffffffff" \
  -H "X-Nonce: nnn..." \
  -H "Content-Type: application/json" \
  -d '{"overrideReason":"Manual review confirmed data accuracy"}'
```

Example response:

```json
{
  "ok": true,
  "data": { "id": 10, "status": "approved" }
}
```

### POST /api/v1/listings/:id/reject

- Description: Rejects listing (logical rejection, stored as draft transition).
- Auth: P3 + consent required + role `merchant`(own office) or `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer |
| Body | reason | Yes | string (min 10 chars) |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Rejected | `{ ok: true, data: Listing }` |
| 400 | Invalid id/reason | Error envelope |
| 403 | Forbidden / consent/CSRF | Error envelope |
| 422 | Illegal transition | Error envelope |

Validation rules:

- `reason` minimum length 10.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/listings/10/reject \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 10101010-1010-4010-8010-101010101010" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Missing required utility disclosure."}'
```

Example response:

```json
{
  "ok": true,
  "data": { "id": 10, "status": "draft" }
}
```

### POST /api/v1/listings/:id/publish

- Description: Publishes approved listing.
- Auth: P3 + consent required + role `merchant`(own office) or `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Headers | X-Nonce | Yes | nonce purpose `publish` |
| Path | id | Yes | integer |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Published | `{ ok: true, data: Listing }` |
| 400 | Invalid id / missing nonce / missing publish-required fields | Error envelope |
| 401 | Nonce invalid/expired | Error envelope |
| 403 | Forbidden / consent/CSRF | Error envelope |
| 422 | Illegal transition | Error envelope |

Validation rules:

- Publish gate requires listing fields:
  - `price_usd_cents`, `area_sqft`, `beds`, `baths`, `address_line`, `state_code`, `postal_code`.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/listings/10/publish \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 20202020-2020-4020-8020-202020202020" \
  -H "X-Nonce: nnn..."
```

Example response:

```json
{
  "ok": true,
  "data": { "id": 10, "status": "published" }
}
```

### POST /api/v1/listings/:id/archive

- Description: Archives a published listing.
- Auth: P3 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer |
| Body | reason | Yes | non-empty string |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Archived | `{ ok: true, data: Listing }` |
| 400 | Invalid id or empty reason | Error envelope |
| 403 | Forbidden / consent/CSRF | Error envelope |
| 422 | Illegal transition | Error envelope |

Validation rules:

- Archive allowed from `published` only.
- `reason` required.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/listings/10/archive \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 30303030-3030-4030-8030-303030303030" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Seasonal campaign ended"}'
```

Example response:

```json
{
  "ok": true,
  "data": { "id": 10, "status": "archived" }
}
```

### POST /api/v1/listings/:id/reverse

- Description: Reverses a published listing back to in_review.
- Auth: P3 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer |
| Body | reason | Yes | string (min 10 chars) |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Reversed | `{ ok: true, data: Listing }` |
| 400 | Invalid id/reason | Error envelope |
| 403 | Forbidden / consent/CSRF | Error envelope |
| 422 | Illegal transition | Error envelope |

Validation rules:

- Reason min length 10.
- Additional non-blocking risk penalty may be applied to approver if no-show pattern detected.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/listings/10/reverse \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 40404040-4040-4040-8040-404040404040" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Buyer financing failed after approval"}'
```

Example response:

```json
{
  "ok": true,
  "data": { "id": 10, "status": "in_review" }
}
```

### DELETE /api/v1/listings/:id

- Description: Soft-deletes listing (status -> deleted).
- Auth: P3 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Deleted | `{ ok: true }` |
| 400 | Invalid id | Error envelope |
| 403 | Forbidden / consent/CSRF | Error envelope |
| 404 | Not found/not visible | Error envelope |
| 422 | Illegal transition | Error envelope |

Validation rules:

- State machine permissions apply.

Example request:

```bash
curl -X DELETE http://localhost:3000/api/v1/listings/10 \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 50505050-5050-4050-8050-505050505050"
```

Example response:

```json
{
  "ok": true
}
```

### POST /api/v1/listings/:id/restore

- Description: Restores soft-deleted listing to draft.
- Auth: P3 + consent required + role `merchant`(own office) or `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Restored | `{ ok: true, data: Listing }` |
| 400 | Invalid id / not deleted / >90 days old | Error envelope |
| 403 | Forbidden / consent/CSRF | Error envelope |
| 404 | Listing not found | Error envelope |

Validation rules:

- Restore window: within 90 days from soft delete.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/listings/10/restore \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 60606060-6060-4060-8060-606060606060"
```

Example response:

```json
{
  "ok": true,
  "data": { "id": 10, "status": "draft" }
}
```

### POST /api/v1/listings/:id/favorite

- Description: Records listing favorite engagement event.
- Auth: P3 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Event recorded | `{ ok: true }` |
| 400 | Invalid id | Error envelope |
| 403 | Consent/CSRF denied | Error envelope |
| 404 | Listing not visible/not found | Error envelope |

Validation rules:

- Listing must be readable by actor.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/listings/10/favorite \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 70707070-7070-4070-8070-707070707070"
```

Example response:

```json
{
  "ok": true
}
```

### POST /api/v1/listings/:id/share

- Description: Records listing share engagement event.
- Auth: P3 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Event recorded | `{ ok: true }` |
| 400 | Invalid id | Error envelope |
| 403 | Consent/CSRF denied | Error envelope |
| 404 | Listing not visible/not found | Error envelope |

Validation rules:

- Listing must be readable by actor.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/listings/10/share \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 80808080-8080-4080-8080-808080808080"
```

Example response:

```json
{
  "ok": true
}
```

### GET /api/v1/listings/:id/revisions

- Description: Returns unified revision/status timeline.
- Auth: P2 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Path | id | Yes | integer |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Revision timeline | `{ ok: true, data: RevisionEntry[] }` |
| 400 | Invalid id | Error envelope |
| 403 | Forbidden scope/consent | Error envelope |
| 404 | Listing not found | Error envelope |

RevisionEntry schema:

```json
{
  "id": 31,
  "revision_no": 3,
  "action": "approved",
  "actor_id": 2,
  "created_at": "2026-04-16T00:00:00.000Z",
  "diff_json": {}
}
```

Validation rules:

- Access: admin/operations, merchant own office, or regular owner.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/listings/10/revisions \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": [
    {
      "id": 1,
      "revision_no": 1,
      "action": "created",
      "actor_id": 4,
      "created_at": "2026-04-16T10:00:00.000Z",
      "diff_json": null
    }
  ]
}
```

## Attachment Endpoints

Prefix: `/api/v1/listings/:listingId/attachments`

### POST /api/v1/listings/:listingId/attachments

- Description: Uploads new attachment.
- Auth: P3 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | listingId | Yes | integer |
| Body | file | Yes | multipart file field |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 201 | Uploaded | `{ ok: true, data: { attachment: AttachmentPublic, duplicate: false } }` |
| 200 | Duplicate detected | `{ ok: true, data: { attachment: AttachmentPublic, duplicate: true } }` |
| 400 | Invalid listing id / missing file | Error envelope |
| 403 | Access denied / consent / CSRF | Error envelope |
| 404 | Listing not found | Error envelope |
| 422 | File rejected | `{ ok:false, error:{ code:"ATTACHMENT_REJECTED", details:{ rejectionCode, rejectionDetail }}}` |

Validation rules:

- Max 25 non-deleted attachments per listing.
- Allowed MIME: JPEG, PNG, WebP, MP4, PDF.
- Size caps: image 12MB, video 200MB, pdf 20MB.
- Video must be H.264/AAC MP4.
- PDF must start with `%PDF` magic bytes.
- Duplicate detection by original SHA-256 within listing.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/listings/10/attachments \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 90909090-9090-4090-8090-909090909090" \
  -F "file=@front.jpg"
```

Example response:

```json
{
  "ok": true,
  "data": {
    "attachment": {
      "id": 7,
      "listing_id": 10,
      "kind": "image",
      "original_filename": "front.jpg",
      "bytes": 234567,
      "mime": "image/jpeg",
      "width": 1600,
      "height": 900,
      "duration_seconds": null,
      "created_at": "2026-04-16T12:00:00.000Z"
    },
    "duplicate": false
  }
}
```

### GET /api/v1/listings/:listingId/attachments

- Description: Lists non-deleted attachments for listing.
- Auth: P2 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Path | listingId | Yes | integer |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Attachment list | `{ ok: true, data: AttachmentPublic[] }` |
| 400 | Invalid listing id | Error envelope |
| 403 | Access denied / consent | Error envelope |
| 404 | Listing not found | Error envelope |

Validation rules:

- Read access follows listing scope rules.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/listings/10/attachments \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": [
    {
      "id": 7,
      "listing_id": 10,
      "kind": "image",
      "original_filename": "front.jpg",
      "bytes": 234567,
      "mime": "image/jpeg",
      "width": 1600,
      "height": 900,
      "duration_seconds": null,
      "created_at": "2026-04-16T12:00:00.000Z"
    }
  ]
}
```

### PUT /api/v1/listings/:listingId/attachments/:id

- Description: Replaces attachment content and creates new revision.
- Auth: P3 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | listingId | Yes | integer |
| Path | id | Yes | integer attachment id |
| Body | file | Yes | multipart file field |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Replaced | `{ ok: true, data: { attachment: AttachmentPublic } }` |
| 400 | Invalid id/missing file | Error envelope |
| 403 | Access denied / consent / CSRF | Error envelope |
| 404 | Listing/attachment not found | Error envelope |
| 422 | File rejected | Attachment rejected envelope |

Validation rules:

- Same file validations as upload.
- Duplicate content against other active attachments is treated as duplicate path.

Example request:

```bash
curl -X PUT http://localhost:3000/api/v1/listings/10/attachments/7 \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: abababab-abab-4bab-8bab-abababababab" \
  -F "file=@front-new.jpg"
```

Example response:

```json
{
  "ok": true,
  "data": {
    "attachment": {
      "id": 7,
      "listing_id": 10,
      "kind": "image",
      "original_filename": "front-new.jpg"
    }
  }
}
```

### DELETE /api/v1/listings/:listingId/attachments/:id

- Description: Soft-deletes attachment.
- Auth: P3 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | listingId | Yes | integer |
| Path | id | Yes | integer |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Deleted | `{ ok: true }` |
| 400 | Invalid ids | Error envelope |
| 403 | Access denied / consent / CSRF | Error envelope |
| 404 | Not found | Error envelope |

Validation rules:

- Write permissions required (`administrator`, `merchant` same office, or listing owner draft regular user).

Example request:

```bash
curl -X DELETE http://localhost:3000/api/v1/listings/10/attachments/7 \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc"
```

Example response:

```json
{
  "ok": true
}
```

### GET /api/v1/listings/:listingId/attachments/:id/revisions

- Description: Returns latest (max 5) non-pruned revision metadata.
- Auth: P2 + consent required + merchant(admin) rollback-capable roles only.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Path | listingId | Yes | integer |
| Path | id | Yes | integer attachment id |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Revision list | `{ ok: true, data: AttachmentRevisionView[] }` |
| 400 | Invalid attachment id | Error envelope |
| 403 | Not merchant/admin or consent missing | Error envelope |
| 404 | Attachment/listing not found | Error envelope |

AttachmentRevisionView schema:

```json
{
  "id": 21,
  "attachment_id": 7,
  "revision_no": 3,
  "pruned": false,
  "created_at": "2026-04-16T13:00:00.000Z"
}
```

Validation rules:

- Only `merchant` (own office) or `administrator` can view revisions.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/listings/10/attachments/7/revisions \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": [
    {
      "id": 21,
      "attachment_id": 7,
      "revision_no": 3,
      "pruned": false,
      "created_at": "2026-04-16T13:00:00.000Z"
    }
  ]
}
```

### POST /api/v1/listings/:listingId/attachments/:id/rollback

- Description: Rolls current attachment content back to a previous revision, creating a new revision.
- Auth: P3 + consent required + merchant(admin) rollback-capable roles.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | listingId | Yes | integer |
| Path | id | Yes | integer attachment id |
| Body | revisionNo | Yes | integer |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Rolled back | `{ ok: true, data: AttachmentPublic }` |
| 400 | Invalid id / revisionNo missing | Error envelope |
| 403 | Forbidden role/scope/consent/CSRF | Error envelope |
| 404 | Attachment/revision not found | Error envelope |

Validation rules:

- Target revision must exist and not be pruned.
- For image revisions, image processing is re-applied on rollback.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/listings/10/attachments/7/rollback \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd" \
  -H "Content-Type: application/json" \
  -d '{"revisionNo":2}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 7,
    "listing_id": 10,
    "kind": "image",
    "original_filename": "front.jpg"
  }
}
```

### GET /api/v1/listings/:listingId/attachments/rejections

- Description: Lists upload rejection history for listing.
- Auth: P2 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Path | listingId | Yes | integer |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Rejection list | `{ ok: true, data: AttachmentRejection[] }` |
| 400 | Invalid listing id | Error envelope |
| 403 | Access denied / consent missing | Error envelope |
| 404 | Listing not found | Error envelope |

AttachmentRejection schema:

```json
{
  "id": 44,
  "listing_id": 10,
  "filename": "movie.mov",
  "reason_code": "invalid_type",
  "reason_detail": "Detected MIME: video/quicktime",
  "actor_id": 4,
  "created_at": "2026-04-16T13:10:00.000Z"
}
```

Validation rules:

- Service role gate allows only `administrator`, `operations`, `merchant` (plus listing readability).

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/listings/10/attachments/rejections \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": [
    {
      "id": 44,
      "listing_id": 10,
      "filename": "movie.mov",
      "reason_code": "invalid_type",
      "reason_detail": "Detected MIME: video/quicktime",
      "actor_id": 4,
      "created_at": "2026-04-16T13:10:00.000Z"
    }
  ]
}
```

## Promo Endpoints

Prefix: `/api/v1/promo`

### POST /api/v1/promo

- Description: Creates promo collection draft.
- Auth: P3 + consent required + role `operations` or `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Body | title | Yes | string |
| Body | theme_date | No | date string `YYYY-MM-DD` |
| Body | starts_at | Yes | ISO datetime |
| Body | ends_at | Yes | ISO datetime |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 201 | Created | `{ ok: true, data: PromoCollection }` |
| 400 | Validation error | Error envelope |
| 403 | Forbidden role/consent/CSRF | Error envelope |

Validation rules:

- `title` non-empty.
- `starts_at` and `ends_at` must parse as valid datetimes.
- `ends_at` strictly after `starts_at`.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/promo \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: dededede-dede-4ede-8ede-dededededede" \
  -H "Content-Type: application/json" \
  -d '{"title":"Spring Deals","starts_at":"2026-04-20T00:00:00Z","ends_at":"2026-04-27T00:00:00Z"}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 3,
    "title": "Spring Deals",
    "status": "draft"
  }
}
```

### GET /api/v1/promo

- Description: Lists promo collections with optional filters and cursor pagination.
- Auth: P2 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Query | status | No | enum promo status |
| Query | from | No | datetime string |
| Query | to | No | datetime string |
| Query | cursor | No | base64 cursor |
| Query | limit | No | integer (default 25, max 100) |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Promo page | `{ ok: true, data: { items: PromoCollection[], nextCursor } }` |
| 401 | Unauthorized | Error envelope |
| 403 | Consent required | Error envelope |

Validation rules:

- Status is computed time-based during listing.

Example request:

```bash
curl -X GET "http://localhost:3000/api/v1/promo?status=live&limit=25" \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": {
    "items": [
      { "id": 3, "title": "Spring Deals", "status": "live" }
    ],
    "nextCursor": null
  }
}
```

### GET /api/v1/promo/:id

- Description: Returns promo collection with slots.
- Auth: P2 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Path | id | Yes | integer |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Promo found | `{ ok: true, data: PromoCollection & { slots: PromoSlot[] } }` |
| 400 | Invalid id | Error envelope |
| 403 | Consent required | Error envelope |
| 404 | Promo not found | Error envelope |

Validation rules:

- `id` must parse as integer.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/promo/3 \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 3,
    "title": "Spring Deals",
    "status": "scheduled",
    "slots": []
  }
}
```

### PATCH /api/v1/promo/:id

- Description: Updates promo collection draft fields.
- Auth: P3 + consent required + role `operations` or `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer |
| Body | title | No | string |
| Body | theme_date | No | date string |
| Body | starts_at | No | ISO datetime |
| Body | ends_at | No | ISO datetime |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Updated | `{ ok: true, data: PromoCollection }` |
| 400 | Validation or non-draft update attempt | Error envelope |
| 403 | Forbidden role/consent/CSRF | Error envelope |
| 404 | Promo not found | Error envelope |

Validation rules:

- Only `draft` promo collections are updatable.
- Non-empty title if provided.
- Date validity and `ends_at > starts_at`.

Example request:

```bash
curl -X PATCH http://localhost:3000/api/v1/promo/3 \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: efefefef-efef-4fef-8fef-efefefefefef" \
  -H "Content-Type: application/json" \
  -d '{"title":"Spring Deals - Updated"}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 3,
    "title": "Spring Deals - Updated",
    "status": "draft"
  }
}
```

### POST /api/v1/promo/:id/click

- Description: Records promo click engagement event.
- Auth: P3 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer |
| Body | listingId | No | integer |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Click logged | `{ ok: true }` |
| 400 | Invalid promo id | Error envelope |
| 403 | Consent/CSRF denied | Error envelope |
| 404 | Promo not found | Error envelope |

Validation rules:

- Promo must exist to log event.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/promo/3/click \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0" \
  -H "Content-Type: application/json" \
  -d '{"listingId":10}'
```

Example response:

```json
{
  "ok": true
}
```

### POST /api/v1/promo/:id/activate

- Description: Activates promo (`draft` -> `scheduled` then computed status).
- Auth: P3 + consent required + role `operations` or `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Activated | `{ ok: true, data: PromoCollection }` |
| 400 | Invalid id | Error envelope |
| 403 | Forbidden role/consent/CSRF | Error envelope |
| 404 | Promo not found | Error envelope |
| 422 | Illegal transition | Error envelope |

Validation rules:

- Transition enforced by promo state machine.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/promo/3/activate \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 11112222-3333-4444-8555-666677778888"
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 3,
    "status": "scheduled"
  }
}
```

### POST /api/v1/promo/:id/cancel

- Description: Cancels promo collection.
- Auth: P3 + consent required + role `operations` or `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Cancelled | `{ ok: true, data: PromoCollection }` |
| 400 | Invalid id | Error envelope |
| 403 | Forbidden role/consent/CSRF | Error envelope |
| 404 | Promo not found | Error envelope |
| 422 | Illegal transition | Error envelope |

Validation rules:

- Transition permitted from valid state only.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/promo/3/cancel \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 22223333-4444-4555-8666-777788889999"
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 3,
    "status": "cancelled"
  }
}
```

### POST /api/v1/promo/:id/slots

- Description: Adds listing to promo slots at rank.
- Auth: P3 + consent required + role `operations` or `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer collection id |
| Body | listingId | Yes | integer |
| Body | rank | Yes | integer (1..20) |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 201 | Slot created | `{ ok: true, data: PromoSlot }` |
| 400 | Invalid id/body/rank constraints | Error envelope |
| 403 | Forbidden role/consent/CSRF | Error envelope |
| 404 | Promo or listing not found | Error envelope |
| 409 | Duplicate listing or rank conflict | Error envelope |

Validation rules:

- Collection must not be `ended`/`cancelled`.
- Max 20 slots per collection.
- Listing must be currently `published`.
- Unique (`collection_id`,`listing_id`) and (`collection_id`,`rank`).

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/promo/3/slots \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 33334444-5555-4666-8777-888899990000" \
  -H "Content-Type: application/json" \
  -d '{"listingId":10,"rank":1}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 17,
    "collection_id": 3,
    "listing_id": 10,
    "rank": 1,
    "added_by": 2,
    "added_at": "2026-04-16T14:00:00.000Z"
  }
}
```

### DELETE /api/v1/promo/:id/slots/:slotId

- Description: Removes promo slot.
- Auth: P3 + consent required + role `operations` or `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer collection id |
| Path | slotId | Yes | integer slot id |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Removed | `{ ok: true }` |
| 400 | Invalid ids / status constraints | Error envelope |
| 403 | Forbidden role/consent/CSRF | Error envelope |
| 404 | Promo/slot not found | Error envelope |

Validation rules:

- Cannot remove from `ended`/`cancelled` collections.

Example request:

```bash
curl -X DELETE http://localhost:3000/api/v1/promo/3/slots/17 \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 44445555-6666-4777-8888-999900001111"
```

Example response:

```json
{
  "ok": true
}
```

### PUT /api/v1/promo/:id/slots/reorder

- Description: Reorders promo slots by assigning new ranks.
- Auth: P3 + consent required + role `operations` or `administrator`.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer collection id |
| Body | slots | Yes | array of `{ slotId:number, rank:number }` |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Reordered | `{ ok: true, data: PromoSlot[] }` |
| 400 | Invalid payload/rank/range | Error envelope |
| 403 | Forbidden role/consent/CSRF | Error envelope |

Validation rules:

- No duplicate ranks.
- Rank range 1..20.
- All slot IDs must belong to collection.

Example request:

```bash
curl -X PUT http://localhost:3000/api/v1/promo/3/slots/reorder \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 55556666-7777-4888-8999-000011112222" \
  -H "Content-Type: application/json" \
  -d '{"slots":[{"slotId":17,"rank":2},{"slotId":18,"rank":1}]}'
```

Example response:

```json
{
  "ok": true,
  "data": [
    { "id": 18, "collection_id": 3, "listing_id": 11, "rank": 1, "added_by": 2, "added_at": "..." },
    { "id": 17, "collection_id": 3, "listing_id": 10, "rank": 2, "added_by": 2, "added_at": "..." }
  ]
}
```

## Analytics Endpoints

Prefix: `/api/v1/analytics`

### GET /api/v1/analytics/kpi

- Description: Returns KPI rows and funnel summary.
- Auth: P2 + consent required + analytics role (`operations` or `administrator`).

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Query | grain | Yes | `day|daily|month|monthly` |
| Query | from | Yes | date string |
| Query | to | Yes | date string |
| Query | officeId | No | integer |
| Query | agentId | No | integer |
| Query | metrics | No | comma list of KPI metric names |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | KPI data | `{ ok: true, data: { rows: KpiRow[], funnel: FunnelData } }` |
| 400 | Missing/invalid grain/from/to | Error envelope |
| 403 | Insufficient role / consent required | Error envelope |
| 401 | Unauthorized | Error envelope |

KpiRow schema:

```json
{
  "grain_date": "2026-04-15",
  "office_id": 1,
  "agent_id": null,
  "metric": "listings_published",
  "value": 42
}
```

FunnelData schema:

```json
{
  "draft": 100,
  "approved": 80,
  "published": 60,
  "approvalRate": 0.8,
  "publishRate": 0.75
}
```

Validation rules:

- Grain normalized internally to `daily` or `monthly`.
- Daily rollup is materialized before query (`<=92` days per request loop).

Example request:

```bash
curl -X GET "http://localhost:3000/api/v1/analytics/kpi?grain=daily&from=2026-04-01&to=2026-04-16" \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": {
    "rows": [
      {
        "grain_date": "2026-04-15",
        "office_id": null,
        "agent_id": null,
        "metric": "new_users",
        "value": 5
      }
    ],
    "funnel": {
      "draft": 100,
      "approved": 80,
      "published": 60,
      "approvalRate": 0.8,
      "publishRate": 0.75
    }
  }
}
```

### GET /api/v1/analytics/funnel

- Description: Returns funnel summary only.
- Auth: P2 + consent required + analytics role.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Query | from | Yes | date string |
| Query | to | Yes | date string |
| Query | officeId | No | integer |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Funnel summary | `{ ok: true, data: FunnelData }` |
| 400 | Missing dates | Error envelope |
| 403 | Insufficient role / consent | Error envelope |

Validation rules:

- `from` and `to` required.

Example request:

```bash
curl -X GET "http://localhost:3000/api/v1/analytics/funnel?from=2026-04-01&to=2026-04-16" \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": {
    "draft": 100,
    "approved": 80,
    "published": 60,
    "approvalRate": 0.8,
    "publishRate": 0.75
  }
}
```

### POST /api/v1/analytics/exports

- Description: Queues KPI CSV export job.
- Auth: P3 + consent required + analytics role.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Body | grain | Yes | `day|daily|month|monthly` |
| Body | from | Yes | date string `YYYY-MM-DD` |
| Body | to | Yes | date string `YYYY-MM-DD` |
| Body | officeId | No | integer |
| Body | agentId | No | integer |
| Body | metrics | No | `KpiMetric[]` |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 202 | Job queued | `{ ok: true, data: { jobId, status: "queued" } }` |
| 400 | Validation failure | Error envelope |
| 403 | Insufficient role/consent/CSRF | Error envelope |

Validation rules:

- Grain normalized to `daily`/`monthly`.
- `from` and `to` required.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/analytics/exports \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 66667777-8888-4999-8aaa-bbbbccccdddd" \
  -H "Content-Type: application/json" \
  -d '{"grain":"daily","from":"2026-04-01","to":"2026-04-16","officeId":1}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "jobId": 12,
    "status": "queued"
  }
}
```

### GET /api/v1/analytics/exports/:jobId

- Description: Returns export job status and metadata.
- Auth: P2 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Path | jobId | Yes | integer |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Job details | `{ ok: true, data: ExportJobPublic & { downloadUrl? } }` |
| 400 | Invalid jobId | Error envelope |
| 403 | Access denied (non-owner non-admin) / consent | Error envelope |
| 404 | Job not found | Error envelope |

Validation rules:

- Non-admin can access only own jobs.
- `downloadUrl` provided only when status is `completed`.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/analytics/exports/12 \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 12,
    "status": "completed",
    "bytes": 14523,
    "requested_at": "2026-04-16 12:00:00.000",
    "completed_at": "2026-04-16 12:00:04.000",
    "expires_at": "2026-04-23 12:00:00.000",
    "downloadUrl": "/api/v1/analytics/exports/12/download"
  }
}
```

### GET /api/v1/analytics/exports/:jobId/download

- Description: Downloads generated CSV export file.
- Auth: P2 + consent required.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Path | jobId | Yes | integer |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | CSV binary stream | Body: raw CSV bytes; headers include `Content-Type: text/csv`, `Content-Disposition`, `X-SHA256` |
| 400 | Job not completed | Error envelope |
| 403 | Access denied/consent | Error envelope |
| 404 | Job not found or expired | Error envelope |
| 500 | Storage/key inconsistency | Error envelope |

Validation rules:

- Job must be `completed` and not expired.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/analytics/exports/12/download \
  -H "Authorization: Bearer eyJ..." \
  -o kpi.csv
```

Example response headers:

```http
HTTP/1.1 200 OK
Content-Type: text/csv
Content-Disposition: attachment; filename="kpi_daily_2026-04-01_2026-04-16_1.csv"
X-SHA256: 9f1e...
```

## Admin Endpoints

Prefix: `/api/v1/admin`

All admin endpoints require:

- Auth profile baseline: P2 for GET, P3 for mutating.
- `role = administrator`
- Consent accepted.

### GET /api/v1/admin/risk/:userId

- Description: Returns risk profile and latest risk events for user.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |
| Path | userId | Yes | integer |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Risk data | `{ ok: true, data: { profile: RiskProfile, events: RiskEvent[] } }` |
| 400 | Invalid userId | Error envelope |
| 401/403 | Unauthorized/forbidden/consent | Error envelope |

RiskProfile schema:

```json
{
  "id": 5,
  "user_id": 4,
  "credit_score": 92,
  "last_decay_at": "2026-04-15 00:00:00.000",
  "flags": null
}
```

RiskEvent schema:

```json
{
  "id": 77,
  "user_id": 4,
  "event_type": "policy_violation",
  "delta": -10,
  "new_score": 90,
  "detail_json": {"note":"..."},
  "created_at": "2026-04-16 10:00:00.000"
}
```

Validation rules:

- `userId` integer required.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/admin/risk/4 \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": {
    "profile": { "user_id": 4, "credit_score": 92 },
    "events": []
  }
}
```

### POST /api/v1/admin/risk/:userId/penalty

- Description: Applies risk penalty to user score.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | userId | Yes | integer |
| Body | penaltyType | Yes | string |
| Body | detail | No | object |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Penalty applied | `{ ok: true, data: RiskProfile }` |
| 400 | Invalid userId / missing penaltyType | Error envelope |
| 401/403 | Unauthorized/forbidden/consent/CSRF | Error envelope |
| 500 | Unknown penalty type or internal failure | Error envelope |

Validation rules:

- Known penalty types in code: `no_show_approval`, `policy_violation`, `multi_device_login`, `abnormal_ip_pattern`.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/admin/risk/4/penalty \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 77778888-9999-4aaa-8bbb-ccccddddeeee" \
  -H "Content-Type: application/json" \
  -d '{"penaltyType":"policy_violation","detail":{"source":"manual_review"}}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "user_id": 4,
    "credit_score": 82
  }
}
```

### GET /api/v1/admin/blacklist

- Description: Lists blacklist entries.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Blacklist entries | `{ ok: true, data: BlacklistEntry[] }` |
| 401/403 | Unauthorized/forbidden/consent | Error envelope |

BlacklistEntry schema:

```json
{
  "id": 3,
  "subject_type": "ip",
  "subject_value": "203.0.113.10",
  "reason": "abuse",
  "expires_at": null,
  "created_by": 1,
  "created_at": "2026-04-16 11:00:00.000"
}
```

Validation rules:

- None.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/admin/blacklist \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": []
}
```

### POST /api/v1/admin/blacklist

- Description: Adds or replaces blacklist entry.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Body | subjectType | Yes | enum `user`,`ip`,`device` |
| Body | subjectValue | Yes | string |
| Body | reason | Yes | string |
| Body | expiresAt | No | datetime string |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 201 | Entry created/updated | `{ ok: true, data: BlacklistEntry }` |
| 400 | Validation error | Error envelope |
| 401/403 | Unauthorized/forbidden/consent/CSRF | Error envelope |

Validation rules:

- `subjectType`, `subjectValue`, `reason` required.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/admin/blacklist \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 88889999-aaaa-4bbb-8ccc-ddddeeeeffff" \
  -H "Content-Type: application/json" \
  -d '{"subjectType":"ip","subjectValue":"203.0.113.10","reason":"credential stuffing"}'
```

Example response:

```json
{
  "ok": true,
  "data": {
    "id": 3,
    "subject_type": "ip",
    "subject_value": "203.0.113.10",
    "reason": "credential stuffing"
  }
}
```

### DELETE /api/v1/admin/blacklist/:id

- Description: Removes blacklist entry by id.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Path | id | Yes | integer |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Removed | `{ ok: true }` |
| 400 | Invalid id | Error envelope |
| 401/403 | Unauthorized/forbidden/consent/CSRF | Error envelope |
| 500 | Entry missing or internal failure | Error envelope |

Validation rules:

- `id` integer required.

Example request:

```bash
curl -X DELETE http://localhost:3000/api/v1/admin/blacklist/3 \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: 9999aaaa-bbbb-4ccc-8ddd-eeeeffff0000"
```

Example response:

```json
{
  "ok": true
}
```

### POST /api/v1/admin/purge/listing/:id

- Description: Hard-purges listing and dependent data.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Headers | X-Nonce | Yes | nonce purpose `purge` |
| Path | id | Yes | integer listing id |
| Body | confirm | Yes | exact string `PURGE <id>` |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Purged | `{ ok: true }` |
| 400 | Invalid id/confirm text | Error envelope |
| 401 | Missing/invalid nonce | Error envelope |
| 403 | Consent/CSRF/role denial | Error envelope |
| 404 | Listing not found | Error envelope |

Validation rules:

- Confirm text must exactly match listing id.
- Nonce is required and consumed.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/admin/purge/listing/10 \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "X-Nonce: purge-nonce" \
  -H "Idempotency-Key: aaaabbbb-cccc-4ddd-8eee-ffff00001111" \
  -H "Content-Type: application/json" \
  -d '{"confirm":"PURGE 10"}'
```

Example response:

```json
{
  "ok": true
}
```

### POST /api/v1/admin/purge/user/:id

- Description: Hard-purges user and associated data.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Headers | X-Nonce | Yes | nonce purpose `purge` |
| Path | id | Yes | integer user id |
| Body | confirm | Yes | exact string `PURGE <id>` |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Purged | `{ ok: true }` |
| 400 | Invalid id/confirm text | Error envelope |
| 401 | Missing/invalid nonce | Error envelope |
| 403 | Consent/CSRF/role denial | Error envelope |
| 404 | User not found | Error envelope |

Validation rules:

- Confirm text exact match required.
- Nonce required and consumed.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/admin/purge/user/4 \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "X-Nonce: purge-nonce" \
  -H "Idempotency-Key: bbbbcccc-dddd-4eee-8fff-000011112222" \
  -H "Content-Type: application/json" \
  -d '{"confirm":"PURGE 4"}'
```

Example response:

```json
{
  "ok": true
}
```

### GET /api/v1/admin/audit-chain

- Description: Verifies audit hash chain integrity.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Chain verification result | `{ ok: true, data: { valid: boolean, brokenAt?: string } }` |
| 401/403 | Unauthorized/forbidden/consent | Error envelope |

Validation rules:

- None.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/admin/audit-chain \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": {
    "valid": true
  }
}
```

### POST /api/v1/admin/audit-chain/repair

- Description: Repairs audit chain hashes using canonical representation.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization, X-CSRF-Token, Idempotency-Key | Yes | P3 |
| Body | None | No | - |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Repair completed | `{ ok: true, data: { repaired: number } }` |
| 401/403 | Unauthorized/forbidden/consent/CSRF | Error envelope |

Validation rules:

- None.

Example request:

```bash
curl -X POST http://localhost:3000/api/v1/admin/audit-chain/repair \
  -H "Authorization: Bearer eyJ..." \
  -H "X-CSRF-Token: <csrf>" \
  -H "Idempotency-Key: ccccdddd-eeee-4fff-8aaa-bbbbccccdddd"
```

Example response:

```json
{
  "ok": true,
  "data": {
    "repaired": 0
  }
}
```

### GET /api/v1/admin/job-runs

- Description: Returns latest scheduled job runs.

Request:

| Type | Name | Required | Schema |
|---|---|---:|---|
| Headers | Authorization | Yes | Bearer token |

Responses:

| Status | Meaning | Body |
|---|---|---|
| 200 | Job run list | `{ ok: true, data: JobRun[] }` |
| 401/403 | Unauthorized/forbidden/consent | Error envelope |

JobRun schema:

```json
{
  "id": 4,
  "job_name": "retention",
  "status": "completed",
  "started_at": "2026-04-16 01:00:00.000",
  "finished_at": "2026-04-16 01:00:01.100",
  "records_processed": 25,
  "error_detail": null
}
```

Validation rules:

- Returns last 50 rows ordered by `started_at` descending.

Example request:

```bash
curl -X GET http://localhost:3000/api/v1/admin/job-runs \
  -H "Authorization: Bearer eyJ..."
```

Example response:

```json
{
  "ok": true,
  "data": [
    {
      "id": 4,
      "job_name": "retention",
      "status": "completed",
      "started_at": "2026-04-16 01:00:00.000",
      "finished_at": "2026-04-16 01:00:01.100",
      "records_processed": 25,
      "error_detail": null
    }
  ]
}
```

## Assumptions

- Assumption: Date/time serialization in JSON responses may appear as ISO strings or DB-formatted strings (`YYYY-MM-DD HH:mm:ss.SSS`) depending on query path and driver; schemas above treat them as string datetimes.
- Assumption: For `POST /api/v1/admin/risk/:userId/penalty`, unknown `penaltyType` values currently bubble as internal error (`500`) because service throws generic Error.
- Assumption: For `DELETE /api/v1/admin/blacklist/:id`, deleting a non-existent id currently yields internal error (`500`) because service throws generic Error.
- Assumption: Metrics/date query inputs in analytics and promo list endpoints rely on JavaScript date parsing; malformed date strings are not uniformly rejected with explicit validation in all paths.
