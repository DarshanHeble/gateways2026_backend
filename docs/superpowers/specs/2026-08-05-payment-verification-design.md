# Payment-Verification Module — Design Spec

Branch: `dev-anand`. Written 2026-08-05.

## Context

Gateways requires a one-time ₹250 "entry pass" payment per user (not per event/registration) before that user can register for any event. Users upload a PDF receipt of a Christ University portal payment; an admin/reviewer approves or rejects it via a separate admin dashboard (built by another contributor, out of scope here). Approval unlocks all event registrations for that user and awards +10 XP.

Two source docs govern this (see `HANDOVER.md` §3): PARALLAX (engineering blueprint, models `payment_receipts` per-registration) and the Team Guide (product SOP, models it as one global receipt per user). **The Team Guide wins** — this is the authoritative behavior.

The `dev-anand` branch just merged a real authentication module (session-cookie based, `users`/`sessions`/`accounts`/`verification_tokens` tables, `assertAuthenticated()` working). Role enforcement (`assertAdmin()`) is still a hardcoded `FORBIDDEN` stub because `user_roles` doesn't exist yet — this module adds the minimal slice needed to unblock it.

## Goals

- A user can upload one PDF receipt (≤5MB) and see its status.
- An admin can list pending receipts and approve/reject them (reason mandatory on reject).
- Approval is idempotent, atomic, and awards +10 XP exactly once.
- Frontend (`Gateways-website`) can be tested against this without changes to its existing mock-repo call shape.

## Non-goals

- Building the admin dashboard UI (separate contributor).
- `registration.service.ts`'s payment-gate check — Fest Ops lane, not built yet. This module only exposes the data (`status === 'verified'`) that lane will consume later.
- Full identity schema (profiles, colleges, departments) or full progression schema (achievements, characters) — only the two tables needed here are added.

## Schema changes

### `src/db/schema/payments.ts` (rewrite)

```
payment_receipts:
  id                  varchar(36) PK
  user_id             varchar(36) UNIQUE, FK -> users.id
  cloudinary_public_id varchar(255)
  file_url            text
  file_name           varchar(255)
  file_size_bytes     int
  status              varchar(32) default 'pending'   -- 'pending' | 'verified' | 'rejected'
  submitted_at        timestamp(3) default now()
  reviewed_by         varchar(36) nullable, FK -> users.id
  reviewed_at         timestamp(3) nullable
  rejection_reason    text nullable

audit_log:            -- already fully specified in existing migration; add as-is
  id, actor_user_id, action, target_type, target_id, correlation_id, metadata, created_at
```

`registration_id` is dropped entirely — this replaces the migration's current per-registration model.

### `src/db/schema/identity.ts` (minimal — new file, first table of this domain)

```
user_roles:
  id, user_id FK->users.id, role varchar(64), event_scope_id nullable,
  granted_at default now(), granted_by nullable
  UNIQUE(user_id, role, event_scope_id)
```

Only this table. Rest of identity.ts (profiles, colleges, departments) stays a stub for its owner.

### `src/db/schema/progression.ts` (minimal — new file, first table of this domain)

```
xp_ledger:
  id, user_id FK->users.id, amount int, reason varchar(255),
  source_type varchar(64), source_id varchar(128), idempotency_key varchar(128),
  awarded_by nullable, created_at default now()
  UNIQUE(source_type, source_id, user_id)
```

Only this table.

### Migration

Generate a new migration via `drizzle-kit generate` reflecting the above — do not hand-edit `0000_ambiguous_sauron.sql`. `src/db/schema/index.ts` gets `payments.js`, `identity.js`, `progression.js` uncommented/added to its barrel export.

## Auth wiring

`src/security/roles.ts`'s `assertAdmin()` currently always throws `FORBIDDEN`. Replace its body with a real query: `SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'ADMIN' LIMIT 1`, throw `FORBIDDEN` only if no row found. Leave `assertOrganizer()` untouched (still needs `event_organizers`, out of scope).

## Storage — Cloudinary

- Add `cloudinary` npm dependency.
- `src/storage/cloudinary.storage.ts` implements the existing `storage.interface.ts` contract (`createUploadUrl`/`completeUpload`/`createDownloadUrl`/`deleteObject` — adapt to Cloudinary's model: upload happens synchronously server-side from the base64 payload, so `completeUpload` effectively does the upload and returns `{ url, publicId }`; `createDownloadUrl` returns the stored secure URL directly since Cloudinary URLs are already durable).
- New env vars: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — added to `env.ts` schema (optional-with-validation, matching the pattern of `SMTP_*`) and all three `.env.*.example` files.

## Upload wire format

Matches the frontend's existing mock `PaymentReceiptRepository.submit()` shape exactly:

```
POST /payment-receipts
{ fileData: string (base64 data URI), fileName: string, fileSizeBytes: number }
```

Server re-validates: mime is `application/pdf` (sniffed from the data URI prefix, not trusted from `fileName`), `fileSizeBytes <= 5_000_000` (and cross-checked against actual decoded buffer length — client-reported size is not trusted for the real limit). The data URI is passed straight to Cloudinary's upload API, which accepts it natively.

## Repository / Service / Routes

**`src/repositories/payment-receipts.repository.ts`**
- `create(data)`, `getByUser(userId)`, `getById(id)`, `listPending()`, `updateStatus(id, {status, reviewedBy, reviewedAt, rejectionReason})` — all writer-connection for mutations, app-connection for reads.

**`src/services/payment.service.ts`**
- `submit(userId, {fileData, fileName, fileSizeBytes})`:
  1. Validate PDF mime + size (server-side, both against declared and actual bytes).
  2. `getByUser(userId)` — if existing receipt has `status` in `('pending','verified')`, throw `RECEIPT_ALREADY_SUBMITTED`. If `rejected`, allow resubmission (upsert / delete+insert against the `UNIQUE(user_id)` constraint).
  3. Upload to Cloudinary.
  4. Insert row, `status='pending'`.
- `review(receiptId, reviewerId, decision, reason?)`:
  1. `assertAdmin`-equivalent already enforced at the route layer.
  2. Writer transaction: `SELECT ... FOR UPDATE` the receipt row.
  3. If `status !== 'pending'`, throw `VALIDATION_FAILED` ("already decided") — no re-deciding a finalized receipt.
  4. If `decision === 'rejected'`, require non-empty `reason` (`VALIDATION_FAILED` if missing — enforced in Zod schema too, belt-and-suspenders).
  5. Update `status/reviewed_by/reviewed_at/rejection_reason`.
  6. If `verified`: award +10 XP via `xp.service.ts`'s idempotent award, `source_type='payment_verification', source_id=receiptId, reason='gateways_pass_bonus'`.
  7. Insert `audit_log` row (`action='payment_receipt_reviewed'`, `target_type='payment_receipt'`, `target_id=receiptId`, `metadata={decision, reason}`).
  8. All in one transaction; retried on deadlock via existing `withDeadlockRetry`.

**`src/routes/payment-receipts.routes.ts`**
- `POST /payment-receipts` — `assertAuthenticated`, body = upload wire format above.
- `GET /payment-receipts/me` — `assertAuthenticated`, returns caller's own receipt or `null`.
- `GET /payment-receipts/pending` — `assertAdmin`, returns list for the dashboard.
- `POST /payment-receipts/:id/review` — `assertAdmin`, body `{decision: 'verified'|'rejected', reason?: string}`, Zod schema makes `reason` required when `decision === 'rejected'` (via `.refine`).

All routes registered with Zod schemas for OpenAPI generation (matches existing `fastify-type-provider-zod` pattern), and rely on the existing global error handler (`DataError` → HTTP JSON) — no new error-handling code needed.

## Testing plan

- Unit-level: exercise `payment.service.ts` against a real dev MySQL (via `docker-compose`) — submit, duplicate-submit rejection, reject-then-resubmit, approve-awards-xp-once (call review twice, confirm second throws).
- Integration: run the backend locally (`npm run dev`), point `Gateways-website`'s payment-upload-modal fetch calls at it (temporary local override, not a permanent frontend change) to confirm the wire format round-trips: upload → Cloudinary URL stored → `GET /payment-receipts/me` reflects `pending` → manually call review endpoint → status flips to `verified`.
