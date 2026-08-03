# PARALLAX Backend — Master Architecture, Security Blueprint & Implementation Plan

> **Repository**: `gateways2026_backend`  
> **Service**: Standalone Backend for Gateways Fest (Website & Mobile App)  
> **Primary Tech Stack**: Fastify (Node.js/TypeScript) + MySQL (via Drizzle ORM) + Zod + Argon2id  

---

## 1. Executive Overview & Mission

PARALLAX (`gateways2026_backend`) is a high-concurrency, security-first backend service. It replaces mock/localStorage data layers with a shared, persistent database for both the web platform and companion mobile app.

### **Core Systems**
1. **Authentication & Identity**: Auth.js / Argon2id password hashing, secure session management, user profiles, character identities.
2. **Fest Operations**: Events, schedule, capacity locking, waitlist promotion, team formation, QR check-in & attendance.
3. **Progression & Gamification**: XP ledger (append-only), leaderboards, achievement grants.
4. **Platform Operations**: Payment receipt verification, private S3 storage uploads, audience-targeted announcements, structured audit logging.

---

## 2. Security-First Architecture & Invariants

```
       ┌────────────────────────────────────────────────────────┐
       │                   Client / Frontend                     │
       └──────────────────────────┬─────────────────────────────┘
                                  │ HTTPS (TLS 1.3)
                                  ▼
       ┌────────────────────────────────────────────────────────┐
       │     Fastify Router / Middleware (Security Shield)      │
       │  • CORS, Rate Limiting, Helmet Headers, CSRF protection │
       └──────────────────────────┬─────────────────────────────┘
                                  │
                                  ▼
       ┌────────────────────────────────────────────────────────┐
       │       Authentication & Session Validation (Auth.js)     │
       │  • httpOnly, Secure, SameSite Lax/Strict Cookies        │
       │  • Session token validation & revocation check         │
       └──────────────────────────┬─────────────────────────────┘
                                  │
                                  ▼
       ┌────────────────────────────────────────────────────────┐
       │          Server-Side Authorization & RBAC              │
       │  • DB-backed role & event-scope check on EVERY action  │
       │  • Never trust client-supplied userId/roles            │
       └──────────────────────────┬─────────────────────────────┘
                                  │
                                  ▼
       ┌────────────────────────────────────────────────────────┐
       │               Zod Schema Input Validation              │
       │  • Strict type checks, sanitization, length caps       │
       │  • Rejects unexpected fields automatically             │
       └──────────────────────────┬─────────────────────────────┘
                                  │
                                  ▼
       ┌────────────────────────────────────────────────────────┐
       │       Service Layer (Business Logic & Transactions)     │
       │  • Atomic transactions (`withTransaction`)             │
       │  • Deadlock retry harness (`withDeadlockRetry`)         │
       │  • Idempotency keys & outbox pattern                    │
       └──────────────┬───────────────────────────┬─────────────┘
                      │                           │
  Standard Operations │                           │ Privileged Writes
  (Reads, Self-Writes)│                           │ (XP, Roles, Payments, Attendance)
                      ▼                           ▼
       ┌──────────────────────────┐   ┌──────────────────────────┐
       │ Standard App DB Pool     │   │ Privileged Writer Pool   │
       │ (DATABASE_URL)           │   │ (WRITER_DATABASE_URL)    │
       │ Least-privilege MySQL    │   │ Strict server-only isolation│
       │ DENIED protected writes  │   │ Audit logged in transaction│
       └──────────────┬───────────┘   └───────────┬──────────────┘
                      └─────────────┬─────────────┘
                                    │
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │                 MySQL Database Engine                  │
       │  • Transaction Isolation: READ COMMITTED              │
       │  • Session: UTC timezone, bigNumberStrings, dateStrings│
       └────────────────────────────────────────────────────────┘
```

### **Non-Negotiable Security Invariants**
- **Dual Database Connections**:
  - `DATABASE_URL` (Application role): Public reads, profile updates, event reads, registrations, team operations. **Hard-denied write access** to `xp_ledger`, `user_roles`, `attendance`, `payment_receipts` verification fields, and `audit_log`.
  - `WRITER_DATABASE_URL` (Writer role): Server-only privileged operations (XP awards, role grants, payment verification, attendance check-ins, audit logs).
- **Concurrency & Capacity Locking**:
  - Registration and cancellation both lock the event row (`SELECT ... FOR UPDATE`) before checking capacity or waitlist state.
  - Check-in tokens require HMAC signing (60s lifetime) and a `jti` single-use redemption table to prevent QR replay.
  - XP awards are append-only in `xp_ledger` locked by `UNIQUE(source_type, source_id, user_id)`.
- **Database Session Configuration**: `timezone = UTC`, `transaction isolation = READ COMMITTED`, `bigNumberStrings = true`, `dateStrings = true`.
- **Deadlock Retry Policy**: Automatic retry up to 3 times ONLY for MySQL deadlock error codes `1213` and `1205` with exponential backoff and jitter.

---

## 3. Schema Blueprint (27 Tables Across 6 Domains)

1. **Auth**: `users`, `accounts`, `sessions`, `verification_tokens`
2. **Identity & Roles**: `profiles`, `user_roles`, `colleges`, `departments`
3. **Progression**: `characters`, `levels`, `xp_ledger`, `achievements`, `user_achievements`
4. **Events**: `event_categories`, `events`, `event_organizers`, `schedule_slots`, `announcements`
5. **Participation**: `teams`, `team_members`, `registrations`, `attendance`, `checkin_token_redemptions`
6. **Platform & Finance**: `payment_receipts`, `audit_log`, `sponsors`, `certificates`

**Required Database Views**:
- `leaderboard`: Ranks users by `total_xp` descending, tie-broken by `created_at` ascending.
- `event_stats`: Aggregates confirmed, waitlisted, checked-in, and remaining seat counts per event.

---

## 4. Error Standards (`DataError`)

All expected operational and business failures return standardized `DataError` objects with stable HTTP mappings:

| DataError Code | HTTP | Description / Handling |
| :--- | :--- | :--- |
| `NOT_AUTHENTICATED` | 401 | Missing or invalid server session. |
| `INVALID_CREDENTIALS` | 401 | Generic login failure (never reveal user existence). |
| `EMAIL_TAKEN` | 409 | Normalized email already registered. |
| `PLAYER_NAME_TAKEN` | 409 | Character player name conflict. |
| `NOT_FOUND` | 404 | Resource missing or hidden from caller scope. |
| `ALREADY_REGISTERED` | 409 | Duplicate registration attempt. |
| `EVENT_FULL` | 422 | Event capacity reached and waitlist disabled/full. |
| `REGISTRATION_CLOSED` | 422 | Outside registration timing window. |
| `TEAM_FULL` | 409 | Team capacity maximum reached. |
| `INVALID_JOIN_CODE` | 409 | Unknown, expired, or invalid team join code. |
| `STORAGE_UNAVAILABLE` | 503 | Upload service outage or signed URL failure. |
| `VALIDATION_FAILED` | 400 | Zod schema validation error. |
| `RECEIPT_ALREADY_SUBMITTED`| 409 | Active payment receipt exists. |
| `PAYMENT_NOT_VERIFIED` | 422 | Operation requires a verified receipt. |

---

## 5. Phased Delivery Plan

### **Phase 1: Project Setup & Security Infrastructure (Current Phase)**
- Setup TypeScript Fastify backend.
- Configure Zod `.env` validation (`loadConfig`).
- Register Fastify security plugins (`@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/cookie`).
- Implement `DataError` catalog and error mapping.

### **Phase 2: Database Schema & Dual Connection Pools**
- Define all 27 tables in Drizzle ORM schema (`src/backend/db/schema`).
- Configure dual database pools (`getAppDb`, `getWriterDb`).
- Implement `withTransaction` and `withDeadlockRetry` helpers.
- Create migration pipeline and deterministic database seeds.

### **Phase 3: Auth, Session & RBAC Engine**
- Argon2id password hashing and secure token utilities.
- Auth.js / session routes and middleware.
- Implement server-side authorization guards (`assertAuthenticated`, `assertAdmin`, `assertOrganizer`, `assertEventOrganizer`, `assertScannerPermission`).

### **Phase 4: Core Domain Services & Concurrency-Safe Workflows**
- Event reads, capacity-locked registrations, and waitlist promotion.
- Team creation and join-code operations.
- Anti-replay QR check-in and attendance recording.
- XP ledger awards and achievement grants (via writer connection).
- Payment receipt upload and verification lifecycle.

### **Phase 5: Automated Testing, Concurrency Verification & Hardening**
- Integration tests for app-role write denial.
- Parallel concurrency tests (20 simultaneous requests for 1 remaining seat).
- Preproduction smoke suite and launch readiness checklist.
