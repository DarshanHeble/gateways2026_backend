# Memory — quick-recall facts

Short-form companion to `HANDOVER.md` (read that first for full context). This file is for fast lookups mid-session, not onboarding.

## Identity
- Project: Gateways fest website + mobile app, CS department event.
- This repo: `gateways2026_backend`, canonical remote `https://github.com/DarshanHeble/gateways2026_backend`, local path `/home/kartik/Desktop/Gateways/gateways-backend`.
- Sibling repos: frontend at `/home/kartik/Desktop/Gateways/Gateways-website` (Next.js, source of the original mock `Repository` contract). Mobile repo not started.
- Team: 6 people — user + 2 backend, 1 more frontend, 3 mobile.

## Stack (locked decisions)
- Backend: Fastify + TypeScript.
- DB: MySQL via Drizzle ORM. Two connection roles: `DATABASE_URL` (least-priv) / `WRITER_DATABASE_URL` (privileged — XP, roles, attendance, payments).
- Auth: hand-rolled JWT (`jose`) + argon2id password hashing.
- Docs/contract sharing: `@fastify/swagger` generates OpenAPI at `/docs`; frontend/mobile run `openapi-typescript` against it. No shared contracts package/repo.
- Hosting target: Render (not yet deployed as of last check).

## Source-of-truth docs (both at Gateways-website repo root)
- `PARALLAX_Backend_Implementation_and_Integration_Plan.pdf` — engineering blueprint, 58 ops / 13 areas / 27 tables, transaction catalog, `DataError` codes.
- `Gateways_Registration_Team_Guide.docx` — payment-verification SOP, **authoritative for payments module**. Describes a **global one-time ₹250 pass** (one receipt per user unlocks ALL events), which conflicts with PARALLAX's per-registration `payment_receipts` assumption — Team Guide wins.

## Module ownership (3-way split)
- **Person A** — Identity & Access: auth, profiles, characters, reference. Status: auth ✅ done.
- **Person B** — Fest Ops: events, registrations, teams, attendance, check-in. Status: events ✅ done, rest pending.
- **Person C** — Progression & Platform: xp, achievements, payments, announcements, storage. Status: **payment-verification is the active task now**.
- Cross-lane hook: registration.service.ts must check payment-verified status before allowing registration (`PAYMENT_NOT_VERIFIED` 422).

## Repo state snapshot (as of this handover)
- Real code: `src/app.ts`, `src/config/env.ts`, `src/db/index.ts`, `src/db/transaction.ts`, `src/errors/DataError.ts`, `src/plugins/{security,swagger}.ts`, `src/services/email.service.ts`, full drizzle migration `0000_ambiguous_sauron.sql` (27 tables), docker-compose, multi-env `.env.example`s.
- **Known gap**: `src/db/schema/*.ts` files are all still 1-line stubs despite the migration already existing — `db/index.ts` imports a schema module that doesn't have real table defs yet. Needs fixing before serious feature work.
- Everything else (`repositories/`, `services/*` except email, `security/`, `storage/`, `routes/`, most of `plugins/`) is 1-line placeholder stubs, not implemented.

## Payment-verification module — target schema
```
payment_receipts: id, user_id UNIQUE, file_url, file_name, file_size_bytes,
  status enum('pending','verified','rejected'),
  submitted_at, reviewed_by, reviewed_at, rejection_reason
```
Current migration has `registration_id NOT NULL` instead — needs correcting to match the global-pass model above.

Rules: max 5MB PDF, one active receipt per user (`RECEIPT_ALREADY_SUBMITTED` if duplicate while pending/verified), reject requires mandatory reason note, approve → verified + unlocks all events + awards +10 XP (idempotent), admin/reviewer-only review endpoint.

## Reference
- Full Phase-1 extraction plan (frontend context, wave sequencing): `/home/kartik/.claude/plans/bubbly-drifting-fountain.md`
- This repo's own living docs: `PROJECT_CONTEXT.md` (status tracker), `ARCHITECTURE_AND_PLAN.md` (master architecture) — both already exist here, written by a teammate.
