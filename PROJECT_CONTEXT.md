# PROJECT CONTEXT & LIVE UPDATE LOG

> **Project**: `gateways2026_backend` (PARALLAX Backend)  
> **Last Updated**: 2026-08-03  
> **Status**: Infrastructure, Multi-Env DB & Swagger UI Phase Complete  

---

## 1. Quick Navigation for AI Agents
- 📌 **Master Security Architecture & Implementation Plan**: [`ARCHITECTURE_AND_PLAN.md`](file:///home/darshan/Projects/gateways2026_backend/ARCHITECTURE_AND_PLAN.md)
- 📌 **Source PDF Requirement Baseline**: [`PARALLAX_Backend_Implementation_and_Integration_Plan.pdf`](file:///home/darshan/Projects/gateways2026_backend/PARALLAX_Backend_Implementation_and_Integration_Plan.pdf)
- 📌 **Project README**: [`README.md`](file:///home/darshan/Projects/gateways2026_backend/README.md)

---

## 2. Current Status & Progress Tracker

| Phase | Description | Status | Key Deliverables |
| :--- | :--- | :---: | :--- |
| **Phase 1** | Project Setup & Security Infrastructure | ✅ Completed | Fastify setup, `.env` Zod validation, security middleware, `DataError` catalog |
| **Phase 2** | Database Schema & Dual DB Connection Pools | ✅ Completed | 27 Drizzle tables, multi-env connection pooling, migration generation (`0000_ambiguous_sauron.sql`) |
| **Phase 2.5** | DX, Docker & Swagger UI Documentation | ✅ Completed | `npm run dev:all` (Docker MySQL runner), interactive Swagger UI at `/docs` with Zod schemas |
| **Phase 3** | Auth, Session & RBAC Engine | 🟡 In Progress | Argon2id hashing, Auth.js session handling, RBAC guard helpers |
| **Phase 4** | Core Domain Workflows & Concurrency Locks | ⏳ Pending | Capacity-locked registrations, QR anti-replay, XP ledger, payment lifecycle |
| **Phase 5** | Security Auditing & Concurrency Testing | ⏳ Pending | MySQL grant denial tests, 20-parallel seat stress tests, pre-launch checklist |

---

## 3. Mandatory Invariants for Any AI / Engineer Working on this Repo

1. **Dual DB Connections**:
   - `appDb` (`DATABASE_URL`) MUST NOT write to `xp_ledger`, `user_roles`, `attendance`, or `payment_receipts` verification fields.
   - `writerDb` (`WRITER_DATABASE_URL`) is strictly server-only for privileged actions.
2. **Authorization**:
   - MUST NOT trust client-supplied `userId` or roles from requests/cookies.
   - MUST re-read role and event-scope permissions from MySQL server-side inside every mutation.
3. **Capacity & Concurrency Locking**:
   - Event registrations MUST execute `SELECT ... FOR UPDATE` on the event row inside a transaction before inserting a registration.
   - Retries MUST be wrapped with `withDeadlockRetry` for MySQL errors `1213` and `1205`.
4. **Input Defense**:
   - Every route payload MUST be validated using a strict **Zod** schema.

---

## 4. Work Log

- **2026-08-02**: Analyzed official `PARALLAX_Backend_Implementation_and_Integration_Plan.pdf` baseline.
- **2026-08-02**: Created comprehensive master architecture document [`ARCHITECTURE_AND_PLAN.md`](file:///home/darshan/Projects/gateways2026_backend/ARCHITECTURE_AND_PLAN.md).
- **2026-08-02**: Initialized context tracking file [`PROJECT_CONTEXT.md`](file:///home/darshan/Projects/gateways2026_backend/PROJECT_CONTEXT.md).
- **2026-08-03**: Implemented multi-environment `.env` loader (`development`, `preproduction`, `production`) supporting individual `DB_*` parameters.
- **2026-08-03**: Created single-command local dev workflow `npm run dev:all` with Docker Compose for MySQL.
- **2026-08-03**: Added interactive Swagger UI documentation at `/docs` with Zod schema validation.
- **2026-08-03**: Generated initial Drizzle SQL migrations for all 27 tables (`0000_ambiguous_sauron.sql`) and added environment-aware migration CLI scripts.
