# Payment-Verification Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend for Gateways' one-time ₹250 entry-pass payment flow — a user uploads a PDF receipt, an admin approves/rejects it, approval awards +10 XP — on branch `dev-anand`, matching the design in `docs/superpowers/specs/2026-08-05-payment-verification-design.md`.

**Architecture:** Fastify route → Zod-validated body → service layer (business rules, transactions) → Drizzle repository layer (raw queries) → MySQL. File bytes go straight to Cloudinary from the service layer; only the resulting URL is persisted. Role checks (`assertAdmin`) and XP awarding are shared primitives other modules will reuse later.

**Tech Stack:** Fastify 5, Drizzle ORM (mysql2), Zod v4 + fastify-type-provider-zod, Cloudinary SDK v2, Vitest (new — this repo has no test runner yet).

## Global Constraints

- PDF receipts only, max 5MB — enforced server-side against actual decoded bytes, not just the client-reported size.
- One receipt per user (`UNIQUE(user_id)` on `payment_receipts`) — no `registration_id`, this is a global pass, not per-event.
- A second submission is rejected with `RECEIPT_ALREADY_SUBMITTED` while status is `pending` or `verified`; resubmission is allowed only after `rejected`.
- Rejecting a receipt requires a non-empty `rejection_reason` — enforced in the Zod schema AND the service layer.
- Approving a receipt awards exactly **+10 XP**, once, idempotently, and only for a receipt currently in `pending` status (no re-deciding a finalized receipt).
- All mutating DB work goes through `getWriterDb()` inside `withTransaction` + `withDeadlockRetry` (see `src/db/transaction.ts`).
- All new code uses `.js` extensions on relative imports (NodeNext module resolution, matches every existing file in this repo).
- Never commit `.env*` files with real secrets. Never run destructive git operations. Do not commit anything — the user commits themselves.

---

### Task 1: Test tooling (Vitest)

This repo has `"test": "echo \"Error: no test specified\" && exit 1"` and zero test infrastructure. Every later task in this plan needs a real test runner first.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/test-setup.test.ts` (temporary smoke test, deleted in this same task once it's proven the tooling works)

**Interfaces:**
- Produces: `npm test` runs Vitest once; `npm run test:watch` runs it in watch mode. All later tasks' test files (`src/**/*.test.ts`) are auto-discovered.

- [ ] **Step 1: Install Vitest**

```bash
npm install --save-dev vitest@^4.1.10
```

- [ ] **Step 2: Add the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 15000,
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Update package.json scripts**

In `package.json`, replace the `"test"` line and add a watch script:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 4: Write a smoke test to prove the tooling works**

Create `src/test-setup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('vitest tooling', () => {
  it('runs TypeScript tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: 1 passed test, `vitest tooling > runs TypeScript tests`.

- [ ] **Step 6: Delete the smoke test**

```bash
rm src/test-setup.test.ts
```

It's served its purpose (proving the runner works); real tests start in Task 6.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(test): add Vitest as the project's test runner"
```

---

### Task 2: Cloudinary dependency, env vars, DataError wording fix

**Files:**
- Modify: `package.json`
- Modify: `src/config/env.ts`
- Modify: `.env.example`, `.env.preproduction.example`, `.env.production.example`
- Modify: `src/errors/DataError.ts`

**Interfaces:**
- Produces: `AppConfig.CLOUDINARY_CLOUD_NAME`, `AppConfig.CLOUDINARY_API_KEY`, `AppConfig.CLOUDINARY_API_SECRET` (all `string | undefined`) consumed by Task 5's storage adapter.

- [ ] **Step 1: Install the Cloudinary SDK**

```bash
npm install cloudinary@^2.10.0
```

- [ ] **Step 2: Add Cloudinary env vars to the Zod schema**

In `src/config/env.ts`, add these fields to `envSchema` right after the existing `STORAGE_BUCKET_URL` / `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` block:

```ts
  // Cloudinary (payment receipt storage)
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
```

These are optional at the env-schema level (matching the `SMTP_*` pattern already in this file) — the storage adapter in Task 5 throws a clear `STORAGE_UNAVAILABLE` error at call time if they're missing, rather than failing the whole app's boot.

- [ ] **Step 2: Add the same vars to all three env example files**

Append to `.env.example`, `.env.preproduction.example`, and `.env.production.example` (each file, same three lines):

```
# Cloudinary (payment receipt storage)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

- [ ] **Step 3: Fix the RECEIPT_ALREADY_SUBMITTED wording**

The message currently says "for this registration" — wrong now that this is a global per-user pass, not per-registration. In `src/errors/DataError.ts`, change:

```ts
    RECEIPT_ALREADY_SUBMITTED: 'A receipt has already been submitted for this registration.',
```

to:

```ts
    RECEIPT_ALREADY_SUBMITTED: 'A payment receipt has already been submitted for your account.',
```

- [ ] **Step 4: Verify the app still boots**

Run: `npm run build`
Expected: no TypeScript errors (env.ts changes are additive-only).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/config/env.ts .env.example .env.preproduction.example .env.production.example src/errors/DataError.ts
git commit -m "feat(payments): add Cloudinary env config and fix receipt-duplicate wording"
```

---

### Task 3: `payment_receipts` + `audit_log` schema

**Files:**
- Modify: `src/db/schema/payments.ts` (currently `// payment_receipts (UNIQUE registration_id).`)
- Test: none (schema files are exercised by Task 4's migration + Task 8's repository tests)

**Interfaces:**
- Consumes: `users` table from `src/db/schema/auth.ts` (already real — `export const users = mysqlTable('users', ...)`).
- Produces: `paymentReceipts`, `auditLog` Drizzle table objects, plus `PaymentReceipt`/`NewPaymentReceipt`/`AuditLogEntry`/`NewAuditLogEntry` inferred types, consumed by Task 8's repository.

- [ ] **Step 1: Write the schema file**

Replace the full contents of `src/db/schema/payments.ts`:

```ts
/**
 * Payments Domain Schema
 *
 * Tables: payment_receipts, audit_log
 *
 * payment_receipts models a GLOBAL one-time entry-pass payment — one row per
 * user (UNIQUE(user_id)), not per-registration. See docs/superpowers/specs/
 * 2026-08-05-payment-verification-design.md for why (Team Guide vs PARALLAX
 * conflict, Team Guide wins).
 */

import { int, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { users } from './auth.js';

// ─── Payment Receipts ──────────────────────────────────────────────────────────
// status: 'pending' | 'verified' | 'rejected'
export const paymentReceipts = mysqlTable('payment_receipts', {
  id: varchar('id', { length: 36 }).primaryKey().notNull(),
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .unique()
    .references(() => users.id),
  cloudinaryPublicId: varchar('cloudinary_public_id', { length: 255 }).notNull(),
  fileUrl: text('file_url').notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileSizeBytes: int('file_size_bytes').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('pending'),
  submittedAt: timestamp('submitted_at', { fsp: 3 })
    .notNull()
    .default(sql`(now())`),
  reviewedBy: varchar('reviewed_by', { length: 36 }).references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { fsp: 3 }),
  rejectionReason: text('rejection_reason'),
});

// ─── Audit Log ─────────────────────────────────────────────────────────────────
// Generic actor/action/target audit trail. No FK on actor_user_id — matches the
// existing migration (audit rows must survive even if the actor is later purged).
export const auditLog = mysqlTable('audit_log', {
  id: varchar('id', { length: 36 }).primaryKey().notNull(),
  actorUserId: varchar('actor_user_id', { length: 36 }).notNull(),
  action: varchar('action', { length: 128 }).notNull(),
  targetType: varchar('target_type', { length: 64 }).notNull(),
  targetId: varchar('target_id', { length: 128 }).notNull(),
  correlationId: varchar('correlation_id', { length: 128 }),
  metadata: text('metadata'),
  createdAt: timestamp('created_at', { fsp: 3 })
    .notNull()
    .default(sql`(now())`),
});

// ─── Type Exports ─────────────────────────────────────────────────────────────
export type PaymentReceipt = typeof paymentReceipts.$inferSelect;
export type NewPaymentReceipt = typeof paymentReceipts.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
```

- [ ] **Step 2: Commit**

```bash
git add src/db/schema/payments.ts
git commit -m "feat(schema): define payment_receipts (global-pass model) and audit_log"
```

---

### Task 4: `user_roles` + `xp_ledger` schema, barrel export, migration

**Files:**
- Modify: `src/db/schema/identity.ts` (currently `// users, credentials, user_roles, refresh_tokens/sessions.`)
- Modify: `src/db/schema/progression.ts` (currently `// achievements, user_achievements, xp_ledger (idempotent on user_id+source_type+source_id+reason).`)
- Modify: `src/db/schema/index.ts`
- Create: `drizzle/migrations/000X_*.sql` (generated, not hand-written)

**Interfaces:**
- Produces: `userRoles` table + `UserRoleRow`/`NewUserRoleRow` types (consumed by Task 6's `assertAdmin`). `xpLedger` table + `XpLedgerEntry`/`NewXpLedgerEntry` types (consumed by Task 7's `xp.repository.ts`).

- [ ] **Step 1: Write the minimal identity schema**

Replace the full contents of `src/db/schema/identity.ts`:

```ts
/**
 * Identity Domain Schema (partial)
 *
 * Only `user_roles` is implemented here — added as a dependency of the
 * payment-verification module's admin-review gate (assertAdmin in
 * src/security/roles.ts). profiles/colleges/departments remain unimplemented,
 * owned by whoever picks up the rest of the identity domain.
 */

import { mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { users } from './auth.js';

export const userRoles = mysqlTable(
  'user_roles',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 64 }).notNull(),
    eventScopeId: varchar('event_scope_id', { length: 36 }),
    grantedAt: timestamp('granted_at', { fsp: 3 })
      .notNull()
      .default(sql`(now())`),
    grantedBy: varchar('granted_by', { length: 36 }),
  },
  (table) => ({
    userRoleScopeIdx: uniqueIndex('user_role_scope_idx').on(
      table.userId,
      table.role,
      table.eventScopeId,
    ),
  }),
);

export type UserRoleRow = typeof userRoles.$inferSelect;
export type NewUserRoleRow = typeof userRoles.$inferInsert;
```

- [ ] **Step 2: Write the minimal progression schema**

Replace the full contents of `src/db/schema/progression.ts`:

```ts
/**
 * Progression Domain Schema (partial)
 *
 * Only `xp_ledger` is implemented here — added as a dependency of the
 * payment-verification module's +10 XP award on approval. achievements/
 * user_achievements/characters remain unimplemented.
 */

import { int, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { users } from './auth.js';

export const xpLedger = mysqlTable(
  'xp_ledger',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amount: int('amount').notNull(),
    reason: varchar('reason', { length: 255 }).notNull(),
    sourceType: varchar('source_type', { length: 64 }).notNull(),
    sourceId: varchar('source_id', { length: 128 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    awardedBy: varchar('awarded_by', { length: 36 }),
    createdAt: timestamp('created_at', { fsp: 3 })
      .notNull()
      .default(sql`(now())`),
  },
  (table) => ({
    sourceIdempotencyIdx: uniqueIndex('source_idempotency_idx').on(
      table.sourceType,
      table.sourceId,
      table.userId,
    ),
  }),
);

export type XpLedgerEntry = typeof xpLedger.$inferSelect;
export type NewXpLedgerEntry = typeof xpLedger.$inferInsert;
```

- [ ] **Step 3: Update the schema barrel**

In `src/db/schema/index.ts`, uncomment/add the three new domains:

```ts
/**
 * Drizzle Schema — Barrel Re-export
 *
 * Active domains are exported here. Each domain's export is enabled
 * once its schema file is implemented. Stubs remain commented until then.
 */

// ✅ Phase 3 — Auth domain (users, accounts, sessions, verification_tokens)
export * from './auth.js';

// ✅ Payment-verification module deps (2026-08-05)
export * from './identity.js';     // user_roles only — profiles/colleges/departments still pending
export * from './progression.js';  // xp_ledger only — achievements/characters still pending
export * from './payments.js';     // payment_receipts, audit_log

// ⏳ Phase 4+ — Uncomment as each domain schema is implemented
// export * from './events.js';       // event_categories, events, event_organizers, schedule_slots, announcements
// export * from './registrations.js'; // registrations, teams, team_members
// export * from './attendance.js';   // attendance, checkin_token_redemptions
// export * from './reference.ts';    // (merged into identity/events when implemented)
```

- [ ] **Step 4: Bring up the local dev database**

Run: `npm run db:up`
Expected: `gateways2026_local_mysql` container starts and reports healthy (`docker ps` shows it).

If you don't have a `.env` file yet, copy the example and fill in the DB block to match `docker-compose.yml`'s defaults:

```bash
cp .env.example .env
```

`.env`'s `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` should already match `docker-compose.yml` (`127.0.0.1:3306`, `app_user`/`app_password`/`gateways2026_db`) since that's what `.env.example` ships with — just also fill in `AUTH_SECRET` and `CHECKIN_TOKEN_SECRET` with any 32+ char string for local dev (e.g. `openssl rand -base64 32`).

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: a new file appears under `drizzle/migrations/` (e.g. `0001_<name>.sql`) containing `CREATE TABLE user_roles`, `CREATE TABLE xp_ledger`, and a corrected `CREATE TABLE payment_receipts` (no `registration_id`, `user_id` UNIQUE) plus `CREATE TABLE audit_log`. This command runs interactively — drizzle-kit will prompt about renaming vs recreating `payment_receipts` (it can't tell a structural rewrite from a rename); answer "create table" (not "rename"), since the local dev DB has no production data to preserve.

- [ ] **Step 6: Apply the migration**

Run: `npm run db:push`
Expected: command completes without errors; the new tables exist in the local MySQL instance.

- [ ] **Step 7: Verify the app still boots against the real schema**

Run: `npm run dev` (in one terminal), then in another:

```bash
curl -s http://localhost:4000/health
```

Expected: `{"status":"ok","service":"gateways2026_backend",...}`. Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/identity.ts src/db/schema/progression.ts src/db/schema/index.ts drizzle/migrations/
git commit -m "feat(schema): add user_roles, xp_ledger, fix payment_receipts to global-pass model"
```

---

### Task 5: Cloudinary storage adapter

**Files:**
- Modify: `src/storage/storage.interface.ts` (currently `// Storage contract: createUploadUrl/completeUpload/createDownloadUrl/deleteObject.`)
- Modify: `src/storage/cloudinary.storage.ts` — **note:** create this file; the existing stub at `src/storage/local-fs.storage.ts` is left untouched (not used by this module, may still be useful for someone else later)
- Test: `src/storage/cloudinary.storage.test.ts`

**Interfaces:**
- Produces: `StorageAdapter` interface (`uploadFile`, `deleteFile`), `UploadResult` type, and the `cloudinaryStorage` singleton — consumed by Task 9's `payment.service.ts`.

- [ ] **Step 1: Define the storage interface**

Replace the full contents of `src/storage/storage.interface.ts`:

```ts
/**
 * Storage contract — implemented by cloudinary.storage.ts.
 * Kept adapter-shaped (not Cloudinary-specific) so a future swap to another
 * provider only requires a new file implementing this interface.
 */

export interface UploadResult {
  url: string;
  publicId: string;
  bytes: number;
}

export interface StorageAdapter {
  uploadFile(params: { data: string; folder: string; publicId: string }): Promise<UploadResult>;
  deleteFile(publicId: string): Promise<void>;
}
```

- [ ] **Step 2: Write the Cloudinary adapter**

Create `src/storage/cloudinary.storage.ts`:

```ts
/**
 * Cloudinary storage adapter — implements StorageAdapter for payment receipt PDFs.
 *
 * Receipts are uploaded as resource_type 'raw' (no image transformation applied —
 * PDFs are stored and served as-is). Config is read lazily on first use so the
 * app can boot even if Cloudinary env vars aren't set; only storage calls fail.
 */

import { v2 as cloudinary } from 'cloudinary';
import { loadConfig } from '../config/env.js';
import { createDataError } from '../errors/DataError.js';
import type { StorageAdapter, UploadResult } from './storage.interface.js';

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  const config = loadConfig();
  if (!config.CLOUDINARY_CLOUD_NAME || !config.CLOUDINARY_API_KEY || !config.CLOUDINARY_API_SECRET) {
    throw createDataError('STORAGE_UNAVAILABLE', 'Cloudinary credentials are not configured.');
  }
  cloudinary.config({
    cloud_name: config.CLOUDINARY_CLOUD_NAME,
    api_key: config.CLOUDINARY_API_KEY,
    api_secret: config.CLOUDINARY_API_SECRET,
  });
  configured = true;
}

export const cloudinaryStorage: StorageAdapter = {
  async uploadFile({ data, folder, publicId }): Promise<UploadResult> {
    ensureConfigured();
    try {
      const result = await cloudinary.uploader.upload(data, {
        resource_type: 'raw',
        folder,
        public_id: publicId,
        overwrite: false,
      });
      return { url: result.secure_url, publicId: result.public_id, bytes: result.bytes };
    } catch {
      throw createDataError('STORAGE_UNAVAILABLE', 'Failed to upload receipt to storage.');
    }
  },

  async deleteFile(publicId: string): Promise<void> {
    ensureConfigured();
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
    } catch {
      throw createDataError('STORAGE_UNAVAILABLE', 'Failed to delete receipt from storage.');
    }
  },
};
```

- [ ] **Step 3: Write the failing test (missing-config behavior)**

This test doesn't need real Cloudinary credentials — it only verifies the "not configured" error path, which is deterministic. Create `src/storage/cloudinary.storage.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  loadConfig: vi.fn(() => ({
    CLOUDINARY_CLOUD_NAME: undefined,
    CLOUDINARY_API_KEY: undefined,
    CLOUDINARY_API_SECRET: undefined,
  })),
}));

describe('cloudinaryStorage', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws STORAGE_UNAVAILABLE when Cloudinary credentials are missing', async () => {
    const { cloudinaryStorage } = await import('./cloudinary.storage.js');
    await expect(
      cloudinaryStorage.uploadFile({ data: 'data:application/pdf;base64,AAAA', folder: 'x', publicId: 'y' }),
    ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test -- cloudinary.storage`
Expected: FAIL — `src/storage/cloudinary.storage.ts` doesn't exist yet if you're doing steps out of order; if Step 2 is already done, this should actually PASS immediately since the implementation already handles this case. Confirm PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/storage/storage.interface.ts src/storage/cloudinary.storage.ts src/storage/cloudinary.storage.test.ts
git commit -m "feat(storage): add Cloudinary adapter for payment receipt PDFs"
```

---

### Task 6: Real `assertAdmin` + shared test helpers

**Files:**
- Modify: `src/security/roles.ts`
- Create: `src/test-helpers/db.ts` (shared by this task's tests and Tasks 8–11)
- Test: `src/security/roles.test.ts`

**Interfaces:**
- Consumes: `userRoles` table from Task 4, `getAppDb()` from `src/db/index.ts`.
- Produces: `assertAdmin(request): Promise<void>` (throws `FORBIDDEN` or resolves) — consumed by Task 11's routes. Test helpers: `createTestUser(db, overrides?): Promise<{id: string; email: string}>`, `grantRole(db, userId, role): Promise<void>`, `deleteTestUser(db, userId): Promise<void>` — consumed by Tasks 6, 8, 9, 10.

- [ ] **Step 1: Write the shared test helpers**

Create `src/test-helpers/db.ts`:

```ts
/**
 * Shared test-only helpers for creating/cleaning up real DB rows.
 * Every test that needs a user creates one here and deletes it in an
 * `afterEach`/`afterAll` — this repo's tests run against a real MySQL
 * instance (see docker-compose.yml), not mocks, so cleanup is mandatory
 * for repeatable runs.
 */

import { v7 as uuidv7 } from 'uuid';
import { eq } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { users } from '../db/schema/auth.js';
import { userRoles } from '../db/schema/identity.js';
import { paymentReceipts } from '../db/schema/payments.js';

type Db = MySql2Database<typeof schema>;

export async function createTestUser(
  db: Db,
  overrides?: Partial<{ email: string; status: string }>,
): Promise<{ id: string; email: string }> {
  const id = uuidv7();
  const email = overrides?.email ?? `test-${id}@example.com`;
  await db.insert(users).values({
    id,
    email,
    status: overrides?.status ?? 'ACTIVE',
  });
  return { id, email };
}

export async function grantRole(db: Db, userId: string, role: string): Promise<void> {
  await db.insert(userRoles).values({
    id: uuidv7(),
    userId,
    role,
  });
}

export async function deleteTestUser(db: Db, userId: string): Promise<void> {
  // FK cascades (ON DELETE CASCADE) clean up sessions/accounts/user_roles/xp_ledger.
  // payment_receipts.user_id has no ON DELETE CASCADE (see schema) — delete explicitly first.
  await db.delete(paymentReceipts).where(eq(paymentReceipts.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}
```

- [ ] **Step 2: Write the failing test**

Create `src/security/roles.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { getAppDb } from '../db/index.js';
import { createTestUser, deleteTestUser, grantRole } from '../test-helpers/db.js';
import { assertAdmin } from './roles.js';
import type { FastifyRequest } from 'fastify';

const db = getAppDb();
let cleanupUserId: string | null = null;

afterEach(async () => {
  if (cleanupUserId) {
    await deleteTestUser(db, cleanupUserId);
    cleanupUserId = null;
  }
});

function fakeRequest(userId: string): FastifyRequest {
  return { user: { id: userId, email: 'x@example.com', status: 'ACTIVE', emailVerified: null } } as FastifyRequest;
}

describe('assertAdmin', () => {
  it('throws FORBIDDEN for a user with no ADMIN role', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;

    await expect(assertAdmin(fakeRequest(user.id))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('resolves for a user with the ADMIN role', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;
    await grantRole(db, user.id, 'ADMIN');

    await expect(assertAdmin(fakeRequest(user.id))).resolves.toBeUndefined();
  });

  it('throws NOT_AUTHENTICATED when request.user is unset', async () => {
    await expect(assertAdmin({} as FastifyRequest)).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- roles.test`
Expected: FAIL — every case fails because `assertAdmin` currently always throws `FORBIDDEN` unconditionally (so case 2, "resolves for ADMIN", fails).

- [ ] **Step 4: Implement the real `assertAdmin`**

In `src/security/roles.ts`, replace the `assertAdmin` function body. The rest of the file (the `UserRole` enum, `assertAuthenticated` re-export note, `assertOrganizer`) stays as-is:

```ts
import type { FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { createDataError } from '../errors/DataError.js';
import { getAppDb } from '../db/index.js';
import { userRoles } from '../db/schema/identity.js';

// ─── Role Enum ────────────────────────────────────────────────────────────────

export const UserRole = {
  PARTICIPANT: 'PARTICIPANT',
  ORGANIZER: 'ORGANIZER',
  SCANNER: 'SCANNER',
  ADMIN: 'ADMIN',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

// ─── assertAuthenticated ──────────────────────────────────────────────────────

/**
 * Throws NOT_AUTHENTICATED (401) if the session hook has not decorated
 * request.user. Call this at the top of any protected route handler.
 */
export function assertAuthenticated(request: FastifyRequest): asserts request is FastifyRequest & {
  user: NonNullable<FastifyRequest['user']>;
} {
  if (!request.user) {
    throw createDataError('NOT_AUTHENTICATED');
  }
}

// ─── assertAdmin ──────────────────────────────────────────────────────────────

/**
 * Throws FORBIDDEN (403) if the authenticated user does not hold the ADMIN role.
 * Throws NOT_AUTHENTICATED (401) if there's no session at all.
 * Always re-derives from the database — never trusts a cached/client claim.
 */
export async function assertAdmin(request: FastifyRequest): Promise<void> {
  assertAuthenticated(request);

  const db = getAppDb();
  const rows = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(and(eq(userRoles.userId, request.user.id), eq(userRoles.role, UserRole.ADMIN)))
    .limit(1);

  if (!rows[0]) {
    throw createDataError('FORBIDDEN', 'Admin role required for this action.');
  }
}

// ─── assertOrganizer ──────────────────────────────────────────────────────────

/**
 * Throws FORBIDDEN (403) if the authenticated user is not an organizer for the given event.
 *
 * ⏳ Requires event_organizers table (events schema) — still a stub, out of scope
 * for the payment-verification module.
 */
export async function assertOrganizer(
  request: FastifyRequest,
  _eventId: string,
): Promise<void> {
  assertAuthenticated(request);
  throw createDataError(
    'FORBIDDEN',
    'Organizer role enforcement requires the events schema. Not yet available.',
  );
}
```

- [ ] **Step 5: Run the test again to verify it passes**

Run: `npm test -- roles.test`
Expected: all 3 cases PASS.

- [ ] **Step 6: `src/routes/auth.routes.ts` already imports `assertAdmin` from `../security/roles.js` — confirm nothing else broke**

Run: `npm run build`
Expected: no TypeScript errors (the function signature — `(request: FastifyRequest) => Promise<void>` — is unchanged, only the body).

- [ ] **Step 7: Commit**

```bash
git add src/security/roles.ts src/security/roles.test.ts src/test-helpers/db.ts
git commit -m "feat(security): implement real assertAdmin via user_roles table"
```

---

### Task 7: XP award (idempotent)

**Files:**
- Modify: `src/repositories/xp.repository.ts` (currently `// DB access for the xp_ledger; award/recalculateTotal logic lives in services/xp.service.ts.`)
- Modify: `src/services/xp.service.ts` (currently `// Idempotent XP award (writer connection) + recalculateTotal repair job.`)
- Test: `src/services/xp.service.test.ts`

**Interfaces:**
- Consumes: `xpLedger` table from Task 4.
- Produces: `awardXp(db, params: {userId, amount, reason, sourceType, sourceId, awardedBy?}): Promise<void>` — consumed by Task 10's `reviewReceipt`. `getTotalXpForUser(db, userId): Promise<number>` — not consumed by this module but a natural companion query, kept small.

- [ ] **Step 1: Write the repository**

Replace the full contents of `src/repositories/xp.repository.ts`:

```ts
/**
 * XP Ledger Repository — raw DB access only. Award-idempotency logic lives
 * in services/xp.service.ts (this file just inserts/reads rows).
 */

import { eq, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { xpLedger } from '../db/schema/progression.js';

type Db = MySql2Database<typeof schema>;

export async function insertXpLedgerEntry(
  db: Db,
  params: {
    id: string;
    userId: string;
    amount: number;
    reason: string;
    sourceType: string;
    sourceId: string;
    idempotencyKey: string;
    awardedBy?: string | null;
  },
): Promise<void> {
  await db.insert(xpLedger).values({
    id: params.id,
    userId: params.userId,
    amount: params.amount,
    reason: params.reason,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    idempotencyKey: params.idempotencyKey,
    awardedBy: params.awardedBy ?? null,
  });
}

export async function getTotalXpForUser(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`COALESCE(SUM(${xpLedger.amount}), 0)` })
    .from(xpLedger)
    .where(eq(xpLedger.userId, userId));
  return Number(rows[0]?.total ?? 0);
}
```

- [ ] **Step 2: Write the failing test**

Create `src/services/xp.service.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { getAppDb } from '../db/index.js';
import { createTestUser, deleteTestUser } from '../test-helpers/db.js';
import { awardXp } from './xp.service.js';
import { getTotalXpForUser } from '../repositories/xp.repository.js';

const db = getAppDb();
let cleanupUserId: string | null = null;

afterEach(async () => {
  if (cleanupUserId) {
    await deleteTestUser(db, cleanupUserId);
    cleanupUserId = null;
  }
});

describe('awardXp', () => {
  it('inserts a ledger row and the total reflects it', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;

    await awardXp(db, {
      userId: user.id,
      amount: 10,
      reason: 'test award',
      sourceType: 'payment_verification',
      sourceId: 'receipt-1',
    });

    const total = await getTotalXpForUser(db, user.id);
    expect(total).toBe(10);
  });

  it('rejects a second award for the same (sourceType, sourceId, userId)', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;

    await awardXp(db, {
      userId: user.id,
      amount: 10,
      reason: 'test award',
      sourceType: 'payment_verification',
      sourceId: 'receipt-2',
    });

    await expect(
      awardXp(db, {
        userId: user.id,
        amount: 10,
        reason: 'test award',
        sourceType: 'payment_verification',
        sourceId: 'receipt-2',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- xp.service`
Expected: FAIL — `awardXp` is not exported yet (`src/services/xp.service.ts` is still the 1-line stub).

- [ ] **Step 4: Implement the service**

Replace the full contents of `src/services/xp.service.ts`:

```ts
/**
 * XP Service — idempotent award on top of xp.repository.
 *
 * Idempotency is enforced at the DB layer: xp_ledger has
 * UNIQUE(source_type, source_id, user_id). A genuine duplicate call throws
 * VALIDATION_FAILED (via db/transaction.ts's mapDatabaseError) rather than
 * silently no-op-ing — callers (e.g. payment.service.ts's reviewReceipt) are
 * expected to guard re-entry themselves via a status-transition check, so a
 * duplicate here indicates an actual bug, not a normal retry.
 */

import { v7 as uuidv7 } from 'uuid';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { insertXpLedgerEntry } from '../repositories/xp.repository.js';

type Db = MySql2Database<typeof schema>;

export interface AwardXpParams {
  userId: string;
  amount: number;
  reason: string;
  sourceType: string;
  sourceId: string;
  awardedBy?: string | null;
}

export async function awardXp(db: Db, params: AwardXpParams): Promise<void> {
  await insertXpLedgerEntry(db, {
    id: uuidv7(),
    userId: params.userId,
    amount: params.amount,
    reason: params.reason,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    idempotencyKey: `${params.sourceType}:${params.sourceId}:${params.userId}`,
    awardedBy: params.awardedBy ?? null,
  });
}
```

Note: this relies on `db/transaction.ts`'s `mapDatabaseError` mapping `source_idempotency_idx` duplicate-key errors to `VALIDATION_FAILED` — that mapping already exists (see `src/db/transaction.ts`, `mapDatabaseError`). Plain `db.insert(...)` calls (not wrapped in `withTransaction`) throw the raw `mysql2` driver error, not a `DataError`, so this test's `.rejects.toMatchObject({ code: ... })` would fail against raw inserts. Check this in the next step — if it fails, wrap the insert with `withTransaction`.

- [ ] **Step 5: Run the test again**

Run: `npm test -- xp.service`
Expected: first case PASSES. Second case (duplicate) — check the actual error shape logged by Vitest's failure output. If it fails because the thrown error is a raw `mysql2` error (no `.code === 'VALIDATION_FAILED'`), update `insertXpLedgerEntry` in `src/repositories/xp.repository.ts` to route through the driver-error mapper:

```ts
import { mapDatabaseError } from '../db/transaction.js';
// ...
export async function insertXpLedgerEntry(db: Db, params: /* ... */): Promise<void> {
  try {
    await db.insert(xpLedger).values({ /* ... same as before ... */ });
  } catch (err) {
    throw mapDatabaseError(err);
  }
}
```

Re-run `npm test -- xp.service` until both cases pass.

- [ ] **Step 6: Commit**

```bash
git add src/repositories/xp.repository.ts src/services/xp.service.ts src/services/xp.service.test.ts
git commit -m "feat(xp): implement idempotent XP award"
```

---

### Task 8: Payment receipts + audit log repositories

**Files:**
- Create: `src/repositories/audit-log.repository.ts`
- Modify: `src/repositories/payment-receipts.repository.ts` (currently `// DB access for payment_receipts.`)
- Test: `src/repositories/payment-receipts.repository.test.ts`

**Interfaces:**
- Consumes: `paymentReceipts`, `auditLog` tables from Task 3.
- Produces: `createReceipt`, `getReceiptByUser`, `getReceiptByIdForUpdate`, `listPendingReceipts`, `updateReceiptStatus`, `deleteReceiptById` (all `(db, ...) => Promise<...>`) — consumed by Task 9/10's `payment.service.ts`. `insertAuditLogEntry(db, params)` — consumed by Task 10.

- [ ] **Step 1: Write the audit log repository**

Create `src/repositories/audit-log.repository.ts`:

```ts
/**
 * Audit Log Repository — generic actor/action/target trail.
 * Cross-cutting: other modules (registrations, roles, etc.) will reuse this
 * later, not payments-specific despite living next to payments.ts in schema.
 */

import { v7 as uuidv7 } from 'uuid';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { auditLog } from '../db/schema/payments.js';

type Db = MySql2Database<typeof schema>;

export interface AuditLogParams {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  correlationId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function insertAuditLogEntry(db: Db, params: AuditLogParams): Promise<void> {
  await db.insert(auditLog).values({
    id: uuidv7(),
    actorUserId: params.actorUserId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    correlationId: params.correlationId ?? null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
  });
}
```

- [ ] **Step 2: Write the failing test**

Create `src/repositories/payment-receipts.repository.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { getAppDb } from '../db/index.js';
import { createTestUser, deleteTestUser } from '../test-helpers/db.js';
import {
  createReceipt,
  deleteReceiptById,
  getReceiptByIdForUpdate,
  getReceiptByUser,
  listPendingReceipts,
  updateReceiptStatus,
} from './payment-receipts.repository.js';
import { withTransaction } from '../db/transaction.js';
import { v7 as uuidv7 } from 'uuid';

const db = getAppDb();
let cleanupUserId: string | null = null;

afterEach(async () => {
  if (cleanupUserId) {
    await deleteTestUser(db, cleanupUserId);
    cleanupUserId = null;
  }
});

describe('payment-receipts.repository', () => {
  it('creates a receipt and finds it by user', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;
    const receiptId = uuidv7();

    await createReceipt(db, {
      id: receiptId,
      userId: user.id,
      cloudinaryPublicId: 'pub-1',
      fileUrl: 'https://res.cloudinary.com/x/raw/upload/pub-1',
      fileName: 'receipt.pdf',
      fileSizeBytes: 1234,
    });

    const found = await getReceiptByUser(db, user.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(receiptId);
    expect(found?.status).toBe('pending');
  });

  it('lists only pending receipts', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;
    const receiptId = uuidv7();

    await createReceipt(db, {
      id: receiptId,
      userId: user.id,
      cloudinaryPublicId: 'pub-2',
      fileUrl: 'https://res.cloudinary.com/x/raw/upload/pub-2',
      fileName: 'receipt.pdf',
      fileSizeBytes: 1234,
    });

    const pendingBefore = await listPendingReceipts(db);
    expect(pendingBefore.some((r) => r.id === receiptId)).toBe(true);

    await updateReceiptStatus(db, receiptId, {
      status: 'verified',
      reviewedBy: user.id,
      reviewedAt: new Date(),
      rejectionReason: null,
    });

    const pendingAfter = await listPendingReceipts(db);
    expect(pendingAfter.some((r) => r.id === receiptId)).toBe(false);
  });

  it('locks a row FOR UPDATE inside a transaction', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;
    const receiptId = uuidv7();

    await createReceipt(db, {
      id: receiptId,
      userId: user.id,
      cloudinaryPublicId: 'pub-3',
      fileUrl: 'https://res.cloudinary.com/x/raw/upload/pub-3',
      fileName: 'receipt.pdf',
      fileSizeBytes: 1234,
    });

    const locked = await withTransaction(db, (tx) => getReceiptByIdForUpdate(tx, receiptId));
    expect(locked?.id).toBe(receiptId);
  });

  it('deletes a receipt by id', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;
    const receiptId = uuidv7();

    await createReceipt(db, {
      id: receiptId,
      userId: user.id,
      cloudinaryPublicId: 'pub-4',
      fileUrl: 'https://res.cloudinary.com/x/raw/upload/pub-4',
      fileName: 'receipt.pdf',
      fileSizeBytes: 1234,
    });

    await deleteReceiptById(db, receiptId);
    const found = await getReceiptByUser(db, user.id);
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- payment-receipts.repository`
Expected: FAIL — none of the imported functions exist yet.

- [ ] **Step 4: Implement the repository**

Replace the full contents of `src/repositories/payment-receipts.repository.ts`:

```ts
/**
 * Payment Receipts Repository — raw DB access only. Business rules
 * (duplicate-submission checks, status-transition guards) live in
 * services/payment.service.ts.
 */

import { eq } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { paymentReceipts } from '../db/schema/payments.js';

type Db = MySql2Database<typeof schema>;
type PaymentReceipt = schema.PaymentReceipt;

export async function createReceipt(
  db: Db,
  params: {
    id: string;
    userId: string;
    cloudinaryPublicId: string;
    fileUrl: string;
    fileName: string;
    fileSizeBytes: number;
  },
): Promise<void> {
  await db.insert(paymentReceipts).values({
    id: params.id,
    userId: params.userId,
    cloudinaryPublicId: params.cloudinaryPublicId,
    fileUrl: params.fileUrl,
    fileName: params.fileName,
    fileSizeBytes: params.fileSizeBytes,
    status: 'pending',
  });
}

export async function getReceiptByUser(db: Db, userId: string): Promise<PaymentReceipt | null> {
  const rows = await db.select().from(paymentReceipts).where(eq(paymentReceipts.userId, userId)).limit(1);
  return rows[0] ?? null;
}

/** Must be called inside a withTransaction(...) block for the lock to hold. */
export async function getReceiptByIdForUpdate(db: Db, id: string): Promise<PaymentReceipt | null> {
  const rows = await db.select().from(paymentReceipts).where(eq(paymentReceipts.id, id)).for('update');
  return rows[0] ?? null;
}

export async function listPendingReceipts(db: Db): Promise<PaymentReceipt[]> {
  return db.select().from(paymentReceipts).where(eq(paymentReceipts.status, 'pending'));
}

export async function updateReceiptStatus(
  db: Db,
  id: string,
  params: {
    status: 'verified' | 'rejected';
    reviewedBy: string;
    reviewedAt: Date;
    rejectionReason: string | null;
  },
): Promise<void> {
  await db
    .update(paymentReceipts)
    .set({
      status: params.status,
      reviewedBy: params.reviewedBy,
      reviewedAt: params.reviewedAt,
      rejectionReason: params.rejectionReason,
    })
    .where(eq(paymentReceipts.id, id));
}

export async function deleteReceiptById(db: Db, id: string): Promise<void> {
  await db.delete(paymentReceipts).where(eq(paymentReceipts.id, id));
}
```

- [ ] **Step 5: Run the tests again**

Run: `npm test -- payment-receipts.repository`
Expected: all 4 cases PASS.

- [ ] **Step 6: Commit**

```bash
git add src/repositories/payment-receipts.repository.ts src/repositories/audit-log.repository.ts src/repositories/payment-receipts.repository.test.ts
git commit -m "feat(payments): implement payment-receipts and audit-log repositories"
```

---

### Task 9: `payment.service.ts` — `submitReceipt`

**Files:**
- Modify: `src/services/payment.service.ts` (currently `// Payment receipt lifecycle: submit / review / verify state machine.`)
- Test: `src/services/payment.service.test.ts`

**Interfaces:**
- Consumes: `cloudinaryStorage` (Task 5), `createReceipt`/`getReceiptByUser`/`deleteReceiptById` (Task 8).
- Produces: `submitReceipt(userId: string, dto: {fileData: string; fileName: string; fileSizeBytes: number}): Promise<PaymentReceipt>` — consumed by Task 11's routes. Tests in this task mock `cloudinaryStorage` so they don't depend on live Cloudinary credentials.

- [ ] **Step 1: Write the failing test**

Create `src/services/payment.service.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppDb } from '../db/index.js';
import { createTestUser, deleteTestUser } from '../test-helpers/db.js';

vi.mock('../storage/cloudinary.storage.js', () => ({
  cloudinaryStorage: {
    uploadFile: vi.fn(async ({ publicId }: { publicId: string }) => ({
      url: `https://res.cloudinary.com/test/raw/upload/${publicId}`,
      publicId,
      bytes: 4,
    })),
    deleteFile: vi.fn(async () => {}),
  },
}));

const { submitReceipt } = await import('./payment.service.js');

const db = getAppDb();
let cleanupUserId: string | null = null;

// A 1x1 valid base64 payload is unnecessary — the service only checks the
// data-URI prefix and decoded byte length, not that it's a real PDF.
const SMALL_PDF_DATA_URI = 'data:application/pdf;base64,JVBERi0xLjQK';

afterEach(async () => {
  if (cleanupUserId) {
    await deleteTestUser(db, cleanupUserId);
    cleanupUserId = null;
  }
});

describe('submitReceipt', () => {
  it('creates a pending receipt for a first-time submission', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;

    const receipt = await submitReceipt(user.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });

    expect(receipt.userId).toBe(user.id);
    expect(receipt.status).toBe('pending');
    expect(receipt.fileUrl).toContain('cloudinary.com');
  });

  it('rejects a non-PDF data URI', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;

    await expect(
      submitReceipt(user.id, {
        fileData: 'data:image/png;base64,AAAA',
        fileName: 'receipt.png',
        fileSizeBytes: 3,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a second submission while the first is pending', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;

    await submitReceipt(user.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });

    await expect(
      submitReceipt(user.id, {
        fileData: SMALL_PDF_DATA_URI,
        fileName: 'receipt-2.pdf',
        fileSizeBytes: 9,
      }),
    ).rejects.toMatchObject({ code: 'RECEIPT_ALREADY_SUBMITTED' });
  });

  it('allows resubmission after a rejection', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;

    const first = await submitReceipt(user.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });

    // Simulate a reviewer rejecting it directly via the repository (review
    // flow itself is Task 10 — here we only need the receipt in 'rejected' state).
    const { updateReceiptStatus } = await import('../repositories/payment-receipts.repository.js');
    await updateReceiptStatus(db, first.id, {
      status: 'rejected',
      reviewedBy: user.id,
      reviewedAt: new Date(),
      rejectionReason: 'blurry scan',
    });

    const second = await submitReceipt(user.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt-retry.pdf',
      fileSizeBytes: 9,
    });

    expect(second.status).toBe('pending');
    expect(second.fileName).toBe('receipt-retry.pdf');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- payment.service`
Expected: FAIL — `submitReceipt` is not exported yet.

- [ ] **Step 3: Implement `submitReceipt`**

Replace the full contents of `src/services/payment.service.ts` (Task 10 will extend this same file with `reviewReceipt` — write the shared imports/constants now):

```ts
/**
 * Payment Service — submit / review lifecycle for the global entry-pass receipt.
 *
 * submitReceipt: validates the uploaded PDF, uploads to Cloudinary, inserts
 *   a 'pending' row. Duplicate submissions while pending/verified are rejected;
 *   a prior 'rejected' receipt is replaced on resubmission.
 * reviewReceipt: see Task 10.
 */

import { v7 as uuidv7 } from 'uuid';
import { getAppDb, getWriterDb } from '../db/index.js';
import { withDeadlockRetry, withTransaction } from '../db/transaction.js';
import { createDataError } from '../errors/DataError.js';
import {
  createReceipt,
  deleteReceiptById,
  getReceiptByUser,
} from '../repositories/payment-receipts.repository.js';
import { cloudinaryStorage } from '../storage/cloudinary.storage.js';
import type { PaymentReceipt } from '../db/schema/payments.js';

const MAX_FILE_SIZE_BYTES = 5_000_000;
const PDF_DATA_URI_PREFIX = 'data:application/pdf;base64,';

export interface SubmitReceiptDto {
  fileData: string;
  fileName: string;
  fileSizeBytes: number;
}

export async function submitReceipt(userId: string, dto: SubmitReceiptDto): Promise<PaymentReceipt> {
  if (!dto.fileData.startsWith(PDF_DATA_URI_PREFIX)) {
    throw createDataError('VALIDATION_FAILED', 'Receipt file must be a PDF.');
  }

  const base64Payload = dto.fileData.slice(PDF_DATA_URI_PREFIX.length);
  const decodedBytes = Buffer.from(base64Payload, 'base64').length;
  if (decodedBytes > MAX_FILE_SIZE_BYTES) {
    throw createDataError('VALIDATION_FAILED', 'Receipt file must not exceed 5MB.');
  }

  const appDb = getAppDb();
  const existing = await getReceiptByUser(appDb, userId);
  if (existing && (existing.status === 'pending' || existing.status === 'verified')) {
    throw createDataError('RECEIPT_ALREADY_SUBMITTED');
  }

  const receiptId = uuidv7();
  const upload = await cloudinaryStorage.uploadFile({
    data: dto.fileData,
    folder: 'gateways/payment-receipts',
    publicId: receiptId,
  });

  const writerDb = getWriterDb();
  return withDeadlockRetry(() =>
    withTransaction(writerDb, async (tx) => {
      // A previously rejected receipt is replaced on resubmission — the
      // UNIQUE(user_id) constraint means the old row must go first.
      if (existing && existing.status === 'rejected') {
        await deleteReceiptById(tx, existing.id);
      }

      await createReceipt(tx, {
        id: receiptId,
        userId,
        cloudinaryPublicId: upload.publicId,
        fileUrl: upload.url,
        fileName: dto.fileName,
        fileSizeBytes: decodedBytes,
      });

      const created = await getReceiptByUser(tx, userId);
      if (!created) {
        throw createDataError('INTERNAL_ERROR', 'Receipt row failed to persist.');
      }
      return created;
    }),
  );
}

export async function getOwnReceipt(userId: string): Promise<PaymentReceipt | null> {
  return getReceiptByUser(getAppDb(), userId);
}
```

- [ ] **Step 4: Run the tests again**

Run: `npm test -- payment.service`
Expected: all 4 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/payment.service.ts src/services/payment.service.test.ts
git commit -m "feat(payments): implement submitReceipt with duplicate/resubmit rules"
```

---

### Task 10: `payment.service.ts` — `reviewReceipt`

**Files:**
- Modify: `src/services/payment.service.ts` (append to the file from Task 9)
- Modify: `src/services/payment.service.test.ts` (append new test cases)

**Interfaces:**
- Consumes: `getReceiptByIdForUpdate`/`updateReceiptStatus`/`listPendingReceipts` (Task 8), `awardXp` (Task 7), `insertAuditLogEntry` (Task 8).
- Produces: `reviewReceipt(receiptId: string, reviewerId: string, dto: {decision: 'verified'|'rejected'; reason?: string}): Promise<PaymentReceipt>`, `listPendingReceipts(): Promise<PaymentReceipt[]>` (service-level wrapper) — both consumed by Task 11's routes.

- [ ] **Step 1: Append the failing tests**

Append to `src/services/payment.service.test.ts` (add these imports to the top alongside the existing ones, and add a new `describe` block at the end):

```ts
// Add to the existing import block at the top of the file:
// import { grantRole } from '../test-helpers/db.js';  <-- add this named import
```

Concretely, update the top imports to:

```ts
import { createTestUser, deleteTestUser, grantRole } from '../test-helpers/db.js';
```

And add this `describe` block at the end of the file:

```ts
const { reviewReceipt, listPendingReceipts: listPendingReceiptsService } = await import('./payment.service.js');

describe('reviewReceipt', () => {
  it('verifies a pending receipt and awards +10 XP exactly once', async () => {
    const submitter = await createTestUser(db);
    const reviewer = await createTestUser(db);
    cleanupUserId = submitter.id; // reviewer cleaned up manually below

    const receipt = await submitReceipt(submitter.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });

    const reviewed = await reviewReceipt(receipt.id, reviewer.id, { decision: 'verified' });
    expect(reviewed.status).toBe('verified');
    expect(reviewed.reviewedBy).toBe(reviewer.id);

    const { getTotalXpForUser } = await import('../repositories/xp.repository.js');
    const total = await getTotalXpForUser(db, submitter.id);
    expect(total).toBe(10);

    await deleteTestUser(db, reviewer.id);
  });

  it('rejects re-deciding an already-verified receipt', async () => {
    const submitter = await createTestUser(db);
    const reviewer = await createTestUser(db);
    cleanupUserId = submitter.id;

    const receipt = await submitReceipt(submitter.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });
    await reviewReceipt(receipt.id, reviewer.id, { decision: 'verified' });

    await expect(reviewReceipt(receipt.id, reviewer.id, { decision: 'verified' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    await deleteTestUser(db, reviewer.id);
  });

  it('requires a non-empty reason to reject', async () => {
    const submitter = await createTestUser(db);
    const reviewer = await createTestUser(db);
    cleanupUserId = submitter.id;

    const receipt = await submitReceipt(submitter.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });

    await expect(reviewReceipt(receipt.id, reviewer.id, { decision: 'rejected' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    await deleteTestUser(db, reviewer.id);
  });

  it('rejects with a reason and does not award XP', async () => {
    const submitter = await createTestUser(db);
    const reviewer = await createTestUser(db);
    cleanupUserId = submitter.id;

    const receipt = await submitReceipt(submitter.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });

    const reviewed = await reviewReceipt(receipt.id, reviewer.id, {
      decision: 'rejected',
      reason: 'Blurry, amount not legible',
    });
    expect(reviewed.status).toBe('rejected');
    expect(reviewed.rejectionReason).toBe('Blurry, amount not legible');

    const { getTotalXpForUser } = await import('../repositories/xp.repository.js');
    const total = await getTotalXpForUser(db, submitter.id);
    expect(total).toBe(0);

    await deleteTestUser(db, reviewer.id);
  });

  it('listPendingReceipts excludes decided receipts', async () => {
    const submitter = await createTestUser(db);
    const reviewer = await createTestUser(db);
    cleanupUserId = submitter.id;

    const receipt = await submitReceipt(submitter.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });

    let pending = await listPendingReceiptsService();
    expect(pending.some((r) => r.id === receipt.id)).toBe(true);

    await reviewReceipt(receipt.id, reviewer.id, { decision: 'verified' });

    pending = await listPendingReceiptsService();
    expect(pending.some((r) => r.id === receipt.id)).toBe(false);

    await deleteTestUser(db, reviewer.id);
  });
});
```

(`grantRole` is imported for parity with other test files but not directly needed here since `reviewReceipt` itself doesn't check the caller's role — that's enforced at the route layer in Task 11, not the service layer. It's fine that it's unused here; remove the import if your linter complains — this repo has no lint script configured currently, so it won't block the test run either way.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- payment.service`
Expected: FAIL — `reviewReceipt` and the service-level `listPendingReceipts` aren't exported yet.

- [ ] **Step 3: Implement `reviewReceipt`**

Append to `src/services/payment.service.ts` (add these imports to the existing import block, then add the new functions at the end of the file):

Update the top of the file's imports to:

```ts
import {
  createReceipt,
  deleteReceiptById,
  getReceiptByIdForUpdate,
  getReceiptByUser,
  listPendingReceipts as listPendingReceiptsRepo,
  updateReceiptStatus,
} from '../repositories/payment-receipts.repository.js';
import { insertAuditLogEntry } from '../repositories/audit-log.repository.js';
import { awardXp } from './xp.service.js';
```

Then append at the end of the file:

```ts
const XP_AWARD_AMOUNT = 10;

export interface ReviewReceiptDto {
  decision: 'verified' | 'rejected';
  reason?: string;
}

export async function reviewReceipt(
  receiptId: string,
  reviewerId: string,
  dto: ReviewReceiptDto,
): Promise<PaymentReceipt> {
  if (dto.decision === 'rejected' && (!dto.reason || dto.reason.trim().length === 0)) {
    throw createDataError('VALIDATION_FAILED', 'A rejection reason is required.');
  }

  const writerDb = getWriterDb();
  return withDeadlockRetry(() =>
    withTransaction(writerDb, async (tx) => {
      const receipt = await getReceiptByIdForUpdate(tx, receiptId);
      if (!receipt) {
        throw createDataError('NOT_FOUND', 'Payment receipt not found.');
      }
      if (receipt.status !== 'pending') {
        throw createDataError('VALIDATION_FAILED', 'This receipt has already been decided.');
      }

      const reviewedAt = new Date();
      await updateReceiptStatus(tx, receiptId, {
        status: dto.decision,
        reviewedBy: reviewerId,
        reviewedAt,
        rejectionReason: dto.decision === 'rejected' ? dto.reason! : null,
      });

      if (dto.decision === 'verified') {
        await awardXp(tx, {
          userId: receipt.userId,
          amount: XP_AWARD_AMOUNT,
          reason: 'Gateways entry pass verified',
          sourceType: 'payment_verification',
          sourceId: receiptId,
          awardedBy: reviewerId,
        });
      }

      await insertAuditLogEntry(tx, {
        actorUserId: reviewerId,
        action: 'payment_receipt_reviewed',
        targetType: 'payment_receipt',
        targetId: receiptId,
        metadata: { decision: dto.decision, reason: dto.reason ?? null },
      });

      const updated = await getReceiptByIdForUpdate(tx, receiptId);
      if (!updated) {
        throw createDataError('INTERNAL_ERROR', 'Receipt row disappeared during review.');
      }
      return updated;
    }),
  );
}

export async function listPendingReceipts(): Promise<PaymentReceipt[]> {
  return listPendingReceiptsRepo(getAppDb());
}
```

- [ ] **Step 4: Run the tests again**

Run: `npm test -- payment.service`
Expected: all 9 cases (4 from Task 9 + 5 from this task) PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: everything passes.

- [ ] **Step 6: Commit**

```bash
git add src/services/payment.service.ts src/services/payment.service.test.ts
git commit -m "feat(payments): implement reviewReceipt with atomic status+XP+audit write"
```

---

### Task 11: Zod schemas, routes, app wiring, manual smoke test

**Files:**
- Create: `src/schemas/payment.schemas.ts`
- Modify: `src/routes/payment-receipts.routes.ts` (currently `// POST/GET receipt submit/get/list/review.`)
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–10.
- Produces: the live HTTP surface — `POST /payment-receipts`, `GET /payment-receipts/me`, `GET /payment-receipts/pending`, `POST /payment-receipts/:id/review`.

- [ ] **Step 1: Write the Zod schemas**

Create `src/schemas/payment.schemas.ts`:

```ts
/**
 * Payment Receipt Zod Schemas — request/response validation + OpenAPI generation.
 */

import { z } from 'zod';

export const SubmitReceiptBodySchema = z.object({
  fileData: z
    .string()
    .startsWith('data:application/pdf;base64,', 'fileData must be a base64-encoded PDF data URI.'),
  fileName: z.string().min(1).max(255),
  fileSizeBytes: z
    .number()
    .int()
    .positive()
    .max(5_000_000, 'File must not exceed 5MB.'),
});

export const ReviewReceiptBodySchema = z
  .object({
    decision: z.enum(['verified', 'rejected']),
    reason: z.string().min(1).max(1000).optional(),
  })
  .refine((val) => val.decision !== 'rejected' || Boolean(val.reason?.trim()), {
    message: 'A rejection reason is required when rejecting a receipt.',
    path: ['reason'],
  });

export const ReceiptIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID.'),
});

export const PaymentReceiptResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  fileUrl: z.string(),
  fileName: z.string(),
  fileSizeBytes: z.number(),
  status: z.enum(['pending', 'verified', 'rejected']),
  submittedAt: z.string(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
});

export const PaymentReceiptOrNullResponseSchema = PaymentReceiptResponseSchema.nullable();
export const PaymentReceiptListResponseSchema = z.array(PaymentReceiptResponseSchema);

export type SubmitReceiptBody = z.infer<typeof SubmitReceiptBodySchema>;
export type ReviewReceiptBody = z.infer<typeof ReviewReceiptBodySchema>;
export type ReceiptIdParam = z.infer<typeof ReceiptIdParamSchema>;
```

- [ ] **Step 2: Write the routes**

Replace the full contents of `src/routes/payment-receipts.routes.ts`:

```ts
/**
 * Payment Receipt Routes — registered under prefix `/payment-receipts` in app.ts.
 *
 * Endpoints:
 *   POST   /payment-receipts            — submit a receipt (PDF, base64)   [auth required]
 *   GET    /payment-receipts/me         — caller's own receipt or null      [auth required]
 *   GET    /payment-receipts/pending    — list receipts awaiting review     [auth + ADMIN]
 *   POST   /payment-receipts/:id/review — approve/reject a receipt          [auth + ADMIN]
 *
 * CSRF: all POST endpoints here require the X-CSRF-Token header (enforced
 * globally in security.ts) — they are not in the CSRF-exempt path list.
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { assertAuthenticated } from '../plugins/jwt-auth.js';
import { assertAdmin } from '../security/roles.js';
import {
  getOwnReceipt,
  listPendingReceipts,
  reviewReceipt,
  submitReceipt,
} from '../services/payment.service.js';
import {
  PaymentReceiptListResponseSchema,
  PaymentReceiptOrNullResponseSchema,
  PaymentReceiptResponseSchema,
  ReceiptIdParamSchema,
  ReviewReceiptBodySchema,
  SubmitReceiptBodySchema,
} from '../schemas/payment.schemas.js';
import type { PaymentReceipt } from '../db/schema/payments.js';

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    statusCode: z.number(),
    retryable: z.boolean(),
    correlationId: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

function serializeReceipt(receipt: PaymentReceipt) {
  return {
    id: receipt.id,
    userId: receipt.userId,
    fileUrl: receipt.fileUrl,
    fileName: receipt.fileName,
    fileSizeBytes: receipt.fileSizeBytes,
    status: receipt.status as 'pending' | 'verified' | 'rejected',
    submittedAt:
      typeof receipt.submittedAt === 'string' ? receipt.submittedAt : receipt.submittedAt.toISOString(),
    reviewedBy: receipt.reviewedBy,
    reviewedAt:
      receipt.reviewedAt == null
        ? null
        : typeof receipt.reviewedAt === 'string'
          ? receipt.reviewedAt
          : receipt.reviewedAt.toISOString(),
    rejectionReason: receipt.rejectionReason,
  };
}

export async function registerPaymentReceiptRoutes(app: FastifyInstance) {
  const router = app.withTypeProvider<ZodTypeProvider>();

  router.post(
    '/',
    {
      schema: {
        tags: ['Payments'],
        summary: 'Submit the one-time entry-pass payment receipt',
        body: SubmitReceiptBodySchema,
        response: {
          201: PaymentReceiptResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      assertAuthenticated(request);
      const receipt = await submitReceipt(request.user.id, request.body);
      return reply.status(201).send(serializeReceipt(receipt));
    },
  );

  router.get(
    '/me',
    {
      schema: {
        tags: ['Payments'],
        summary: "Get the caller's own payment receipt",
        response: {
          200: PaymentReceiptOrNullResponseSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      assertAuthenticated(request);
      const receipt = await getOwnReceipt(request.user.id);
      return receipt ? serializeReceipt(receipt) : null;
    },
  );

  router.get(
    '/pending',
    {
      schema: {
        tags: ['Payments'],
        summary: 'List receipts awaiting review (Admin only)',
        response: {
          200: PaymentReceiptListResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      assertAuthenticated(request);
      await assertAdmin(request);
      const receipts = await listPendingReceipts();
      return receipts.map(serializeReceipt);
    },
  );

  router.post(
    '/:id/review',
    {
      schema: {
        tags: ['Payments'],
        summary: 'Approve or reject a payment receipt (Admin only)',
        params: ReceiptIdParamSchema,
        body: ReviewReceiptBodySchema,
        response: {
          200: PaymentReceiptResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      assertAuthenticated(request);
      await assertAdmin(request);
      const receipt = await reviewReceipt(request.params.id, request.user.id, request.body);
      return serializeReceipt(receipt);
    },
  );
}
```

- [ ] **Step 3: Register the routes in app.ts**

In `src/app.ts`, add the import and registration, mirroring the existing `/auth` prefix pattern:

```ts
import { registerPaymentReceiptRoutes } from './routes/payment-receipts.routes.js';
```

And after the existing `/auth` route registration block, add:

```ts
  // Register payment-receipt routes under /payment-receipts prefix
  await app.register(
    async (paymentsApp) => {
      await registerPaymentReceiptRoutes(paymentsApp);
    },
    { prefix: '/payment-receipts' },
  );
```

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 5: Run the full automated test suite one more time**

Run: `npm test`
Expected: all tests across every task still pass.

- [ ] **Step 6: Manual end-to-end smoke test against a running server**

This exercises the real HTTP surface, including cookie/CSRF/session plumbing that the unit tests don't cover (they call service functions directly, not through Fastify). You'll need a Cloudinary account's real credentials in `.env` for this step specifically (the upload actually hits Cloudinary here, unlike the mocked service tests) — sign up free at cloudinary.com if you don't have one yet, and fill in `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` in `.env`.

Start the server: `npm run dev` (leave running in one terminal). In another terminal:

```bash
# 1. Sign up a test user
curl -s -c /tmp/cookies.txt -X POST http://localhost:4000/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"paytest@example.com","password":"testpass123","fullName":"Pay Test"}'
# Expected: {"message":"..."} — check server logs / your configured SMTP for the OTP,
# or query the DB directly: SELECT token FROM verification_tokens WHERE identifier='paytest@example.com';
# (token in DB is bcrypt-hashed — for local testing, temporarily log the plaintext OTP
# in signupWithPassword, or read it from whatever SMTP catcher you have configured.)

# 2. Verify email with the OTP (replace 123456)
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt -X POST http://localhost:4000/auth/verify-email \
  -H 'Content-Type: application/json' \
  -d '{"email":"paytest@example.com","otp":"123456"}'

# 3. Sign in (issues session + CSRF cookies into cookies.txt)
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt -X POST http://localhost:4000/auth/signin \
  -H 'Content-Type: application/json' \
  -d '{"email":"paytest@example.com","password":"testpass123"}'

# 4. Extract the CSRF token from the cookie jar for subsequent POSTs
CSRF=$(grep csrf_token /tmp/cookies.txt | awk '{print $NF}')

# 5. Submit a receipt (tiny fake PDF payload — service only checks prefix + size, not real PDF structure)
curl -s -b /tmp/cookies.txt -X POST http://localhost:4000/payment-receipts \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"fileData":"data:application/pdf;base64,JVBERi0xLjQK","fileName":"receipt.pdf","fileSizeBytes":9}'
# Expected: 201, { "status": "pending", "fileUrl": "https://res.cloudinary.com/...", ... }

# 6. Confirm it shows up on GET /me
curl -s -b /tmp/cookies.txt http://localhost:4000/payment-receipts/me
# Expected: same receipt, status "pending"

# 7. Grant yourself ADMIN directly in the DB (no admin-grant endpoint exists yet —
#    that's Person A's /auth/admin/roles/:userId route, still a stub; out of scope here)
mysql -h 127.0.0.1 -P 3306 -u app_user -papp_password gateways2026_db \
  -e "INSERT INTO user_roles (id, user_id, role) SELECT UUID(), id, 'ADMIN' FROM users WHERE email='paytest@example.com';"

# 8. List pending receipts as admin
curl -s -b /tmp/cookies.txt http://localhost:4000/payment-receipts/pending
# Expected: array containing the receipt from step 5

# 9. Approve it
RECEIPT_ID=$(curl -s -b /tmp/cookies.txt http://localhost:4000/payment-receipts/me | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -s -b /tmp/cookies.txt -X POST "http://localhost:4000/payment-receipts/$RECEIPT_ID/review" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"decision":"verified"}'
# Expected: 200, { "status": "verified", "reviewedBy": "<user id>", ... }

# 10. Confirm XP was awarded
mysql -h 127.0.0.1 -P 3306 -u app_user -papp_password gateways2026_db \
  -e "SELECT amount, source_type FROM xp_ledger WHERE user_id = (SELECT id FROM users WHERE email='paytest@example.com');"
# Expected: one row, amount=10, source_type='payment_verification'
```

Expected overall: every step returns the documented shape, no 500s. This is the point at which it's reasonable to also try the real frontend (`Gateways-website`) against this running server, per the original goal of this task — that requires either pointing the frontend's fetch calls at `http://localhost:4000` (its own separate change, not part of this backend repo) or manual `curl`/Postman testing as above.

- [ ] **Step 7: Check the OpenAPI docs render**

With the dev server still running, open `http://localhost:4000/docs` in a browser. Expected: Swagger UI loads, shows a "Payments" tag with all 4 endpoints, matching the schemas from Step 1.

- [ ] **Step 8: Commit**

```bash
git add src/schemas/payment.schemas.ts src/routes/payment-receipts.routes.ts src/app.ts
git commit -m "feat(payments): wire payment-receipt routes into the app"
```

---

## Explicitly out of scope (do not implement as part of this plan)

- The admin dashboard UI at `/dashboard/verify-payments` (another contributor's work).
- `registration.service.ts`'s payment-status gate (`PAYMENT_NOT_VERIFIED` check before registering) — Fest Ops lane, not built yet; this plan only makes `payment_receipts.status === 'verified'` queryable for that lane to consume later.
- Filling in `/auth/admin/roles/:userId` in `src/routes/auth.routes.ts` (Person A's route) — Task 11's smoke test grants the ADMIN role via a direct SQL insert instead.
- Full identity schema (profiles, colleges, departments) and full progression schema (achievements, characters) beyond the two tables this plan needs.
- Any change to the `Gateways-website` frontend repo.
