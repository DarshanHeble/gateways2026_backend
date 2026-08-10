# Handover — Gateways Backend

Written for a fresh chat/session that has no memory of prior conversations. Read this fully before touching code. It complements, not replaces, `PROJECT_CONTEXT.md` and `ARCHITECTURE_AND_PLAN.md` in this same folder — those are the team's own living docs; this file is the cross-repo/cross-conversation context that isn't written down anywhere else yet.

---

## 1. The big picture

**Gateways** is a college CS-department fest website + companion mobile app. It started as a single Next.js repo (`Gateways-website`) where the "backend" was 100% mock — a `Repository` TypeScript interface backed by `localStorage`, no real server, no database. The team (6 people: you + 2 more on backend, 1 more on frontend, 3 on mobile) decided to split into three separate repos: frontend (existing repo, trimmed down), this backend repo, and a future mobile repo.

**This repo (`gateways2026_backend`, aka local folder `gateways-backend`) is the standalone backend**: Fastify + MySQL (via Drizzle ORM), replacing that mock data layer for both the website and the mobile app.

## 2. Repo relationships — where things live

- **Frontend**: `/home/kartik/Desktop/Gateways/Gateways-website` — the original Next.js repo. Its mock `Repository` interface (`src/backend/data/repository.ts`) and domain types (`src/backend/data/types.ts`) were the **design reference** this backend's 58-operation contract was derived from (58 ops across 13 areas: auth, profiles, reference, characters, events, registrations, teams, attendance, progression/xp, achievements, payments, announcements — see PARALLAX PDF page 9). The frontend's `local-repository.ts`/`local-auth.ts`/`seed.ts` encode the exact validation rules, error codes, and idempotency behavior each real backend operation must replicate — treat them as executable spec when a written spec is ambiguous.
- **This backend repo**: official/canonical repo is **`https://github.com/DarshanHeble/gateways2026_backend`** (a teammate's fork, now the shared team repo). Local clone lives at `/home/kartik/Desktop/Gateways/gateways-backend`, git remote `origin` points at that GitHub URL.
- **Mobile**: not started yet, out of scope for now, but it will consume this backend's HTTP API too — keep that in mind when designing routes/DTOs (nothing web-specific baked in).
- **Contract sharing decision**: no shared npm/git-dependency package for types. Instead, the backend generates an **OpenAPI spec** from its Fastify + Zod route schemas (`@fastify/swagger`, already wired — see `src/plugins/swagger.ts`, docs served at `/docs`). Frontend and mobile are meant to run `openapi-typescript` against that spec to generate their own local types. This was a deliberate choice over a shared contracts repo, to avoid extra registry/repo maintenance for a student team.

## 3. Two source documents that govern this repo — and where they conflict

Both live at the frontend repo root and were uploaded into chat; copies are referenced by path in `PROJECT_CONTEXT.md` too:

1. **`PARALLAX_Backend_Implementation_and_Integration_Plan.pdf`** (36 pages) — the engineering blueprint: 4-person lane division, MySQL two-connection-role policy (`DATABASE_URL` least-privilege vs `WRITER_DATABASE_URL` privileged), the full transaction/locking catalog, `DataError` code table, 27-table schema ownership matrix. This is the primary technical spec for this repo and is already reflected in `ARCHITECTURE_AND_PLAN.md`.
2. **`Gateways_Registration_Team_Guide.docx`** (at `/home/kartik/Desktop/Gateways/Gateways-website/Gateways_Registration_Team_Guide.docx`) — an *operations* SOP written for the humans who review payment receipts, not engineers. It is the **authoritative product spec for the payment-verification module** specifically, and it describes a **global one-time ₹250 entry pass model**: one payment unlocks *every* event for a user, it is NOT one receipt per registration.

**Known conflict, not yet resolved in code**: PARALLAX's schema (and the migration already generated in this repo — see §5) models `payment_receipts` as **one row per registration** (`registration_id NOT NULL`, no uniqueness on `user_id`). The Team Guide's actual product behavior needs **one row per user** (`UNIQUE(user_id)`, no `registration_id` at all, or it becomes nullable/unused). **The Team Guide wins** — it matches what the frontend already implements (`Gateways-website/src/frontend/screens/public/events/events-screen.tsx` hardcodes a single global `eventId="gateways-entry"` payment gate, not per-event). This needs to be fixed in the schema/migration before the payments module is built — see §6.

## 4. Team structure & module ownership (3 backend people)

Derived from PARALLAX's 4-lane split, consolidated to 3 since this team has 3 backend engineers, not 4:

| Lane | Owner slot | Modules | Status |
|---|---|---|---|
| **Identity & Access** | Person A | auth, profiles, characters, reference (bundled in — low complexity, pairs with characters' college/dept fields) | ✅ Auth reported complete (per user) |
| **Fest Operations** | Person B | events, registrations, teams, attendance, QR check-in | ✅ Events reported complete; registrations/teams/attendance still pending |
| **Progression & Platform** | Person C | xp, achievements, **payments**, announcements, storage | 🔴 Payment-verification is the active task — see §6 |

Cross-lane dependency to flag explicitly to whoever owns each side: **`registration.service.ts` (Fest Ops) must check `paymentReceipts.getByUser(userId)?.status === 'verified'` before running its capacity-lock transaction**, throwing `PAYMENT_NOT_VERIFIED` (422) otherwise — per the Team Guide's "no confirmed seat without a verified pass" rule. This isn't optional; it's the core business rule of the whole payment system.

Full inventory of every schema/repository/service/route file and which lane owns it is in the frontend repo's saved plan file: `/home/kartik/.claude/plans/bubbly-drifting-fountain.md` (Phase 1 extraction plan — still useful for wave sequencing even though the "3 repos" and "OpenAPI contracts" decisions in it have since been finalized as described in §2).

## 5. Actual current state of this repo (verified by reading the tree, not assumed)

**Real, working code** (not stubs):
- `src/app.ts` — Fastify bootstrap, health check at `/health`, registers swagger + security plugins.
- `src/config/env.ts` — Zod-validated multi-environment `.env` loader (dev/preprod/prod).
- `src/db/index.ts` — `getAppDb()` / `getWriterDb()`, dual MySQL connection pools via `mysql2` + Drizzle, imports schema from `./schema/index.js`.
- `src/db/transaction.ts` — transaction/deadlock-retry helpers.
- `src/errors/DataError.ts` — the `DataError` class + code catalog.
- `src/plugins/security.ts`, `src/plugins/swagger.ts` — CORS/helmet/rate-limit registration, Swagger UI at `/docs`.
- `src/services/email.service.ts` — primary+fallback SMTP with failover (already built, not in original plan — for verification/reset emails presumably).
- `docker-compose.yml`, `drizzle.config.ts`, `drizzle/migrations/0000_ambiguous_sauron.sql` (340 lines — full SQL for all 27 tables, already generated), `.env.example` × 3 environments, `package.json`/`package-lock.json`.

**⚠️ Known gap / likely blocker**: `src/db/schema/*.ts` (identity.ts, events.ts, payments.ts, etc., and the `index.ts` that `db/index.ts` imports as `import * as schema from './schema/index.js'`) are **still 1-line placeholder stub files** — no actual Drizzle table definitions exist in the schema folder right now, even though a full migration SQL file already exists in `drizzle/migrations/`. This means either (a) the schema was written once, used to generate that migration, then lost/not committed, or (b) the migration was written by hand/another method. **Either way, `src/db/index.ts` currently cannot compile/run correctly against an empty schema module.** Whoever picks up any module needs to write the real Drizzle schema files matching the existing migration's table shapes (`drizzle/migrations/0000_ambiguous_sauron.sql` is the ground truth for column names/types until schema.ts is rewritten) — except for `payment_receipts`, which needs the `registration_id` → `user_id`-unique fix from §3 first.

**Still stubs (1-line comments only, no logic)**: everything in `src/repositories/*`, `src/services/*` (except `email.service.ts`), `src/security/*`, `src/storage/*`, `src/routes/*`, `src/plugins/{cors,error-handler,jwt-auth,rate-limit}.ts` (these three are likely superseded by the real `src/plugins/security.ts` that already exists — reconcile/delete the redundant stubs rather than filling them in separately).

## 6. The active task: payment-verification module

Full requirements were already synthesized from both source docs in chat; condensed here:

**Schema fix needed first** (`src/db/schema/payments.ts`, and the migration):
```
payment_receipts:
  id, user_id UNIQUE, file_url, file_name, file_size_bytes,
  status enum('pending','verified','rejected'),
  submitted_at, reviewed_by, reviewed_at, rejection_reason
```
(drop or stop relying on `registration_id` — global pass, not per-registration)

**Business rules from the Team Guide** (`Gateways_Registration_Team_Guide.docx`):
- ₹250 one-time fee via Christ University's payment portal; user uploads PDF receipt (max 5MB, enforce server-side not just client-side).
- One active receipt per user — reject a second submission while `pending`/`verified` with `RECEIPT_ALREADY_SUBMITTED` (already in the `DataError` catalog); resubmission only allowed after a `rejected` status.
- Reviewer (admin/payment_reviewer role) approves or rejects via an admin dashboard at `/dashboard/verify-payments` (frontend route, already exists client-side).
- **Approve** → status `verified`, unlocks ALL event registrations for that user, awards **+10 XP** (idempotent, via `xp.service.ts`, key something like `(userId, 'payment_verification', receiptId, 'gateways_pass_bonus')`).
- **Reject** → status `rejected`, a rejection **reason note is mandatory** (enforce in the Zod route schema, not just UI — the doc is explicit this is non-negotiable), enables re-upload on the frontend.

**Engineering rigor from PARALLAX** (PDF pages 10, 17, 21, 34):
- `DataError` codes already defined: `RECEIPT_ALREADY_SUBMITTED` (409), `PAYMENT_NOT_VERIFIED` (422).
- Transaction catalog: use `writerDb`, lock order `receipt -> registration`, atomic write of `status/reviewer/reason` + registration consequence + audit row, idempotent on valid-state-transition only (can't re-verify an already-decided receipt).
- Reviewer operations need `assertPaymentReviewer`-style role re-check server-side, never trust a client role claim.

**Files to implement** (all currently 1-line stubs): `src/db/schema/payments.ts`, `src/repositories/payment-receipts.repository.ts`, `src/services/payment.service.ts`, `src/routes/payment-receipts.routes.ts`, plus a small addition inside `src/services/registration.service.ts` (once it exists) for the payment-status gate described in §4.

## 7. Practical notes for whoever resumes this

- Always `git fetch && git log --oneline origin/main` before starting — this repo has multiple active contributors pushing directly to `main` (no branch/PR workflow observed yet), so check for new commits each session.
- `PROJECT_CONTEXT.md`'s "Quick Navigation" links use `file:///home/darshan/Projects/...` paths — those are a *different teammate's* local machine, not yours; don't follow them literally.
- The Team Guide docx is only in the frontend repo, not this one — worth copying it (or at least its payment-verification section) into this repo if the team wants it self-contained here.
