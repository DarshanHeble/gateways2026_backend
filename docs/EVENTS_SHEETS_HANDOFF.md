# Events & Schedule from Google Sheets — Collaborator Brief

You own the **events lane** end to end: getting event + schedule data out of Google
Sheets and out through the API. Nobody else is building this. Auth and payments are
done and merged on `payment-branch` — don't touch those files.

---

## 1. The one architectural rule

**Sheets is an import source, not a runtime data source.**

```
Google Sheet  --(sync job, writes)-->  MySQL events/schedule_slots  --(reads)-->  API  -->  clients
```

Do **not** have the API routes call the Sheets API on request. Three reasons, any one
of which is enough:

1. `registrations`, `teams`, `attendance`, `certificates` and `announcements` all have
   foreign keys to `events.id`. A row that only exists in a spreadsheet cannot be
   referenced. The moment someone registers for an event, that event must be a real
   DB row.
2. Google's Sheets API has per-minute read quotas and no uptime guarantee you control.
   During the fest, `GET /api/v1/events` is the hottest endpoint on the site. A Google
   hiccup must not take the schedule page down.
3. Sheets has no types, no constraints, no uniqueness. Validation has to happen
   somewhere — do it once at import, not on every request.

Everything below follows from this.

---

## 2. ⚠️ The hazard that will destroy data if you get it wrong

Every FK to `events` is `ON DELETE CASCADE`:

```sql
registrations_event_id_events_id_fk  ... ON DELETE cascade
attendance_event_id_events_id_fk     ... ON DELETE cascade
teams_event_id_events_id_fk          ... ON DELETE cascade
announcements_event_id_events_id_fk  ... ON DELETE cascade
```

So: **if a sync deletes an event row because someone deleted a line in the spreadsheet,
MySQL silently deletes every registration, team and attendance record for that event.**
There is no undo.

**The sync must never issue `DELETE FROM events`.** A row that disappears from the sheet
gets its status set to `CANCELLED`, and the sync logs a warning. Removing an event for
real is a deliberate human action, not a spreadsheet edit. Write a test that asserts
this: seed an event with a registration, run a sync whose sheet omits that event, assert
the registration still exists.

---

## 3. Sheet layout

One spreadsheet, three tabs. Header row is row 1, exact lowercase snake_case names —
read them by header name, not by column index, so inserting a column doesn't corrupt
the import.

### Tab `events`

| column | required | notes |
|---|---|---|
| `slug` | ✅ | **The stable key.** Lowercase, `[a-z0-9-]`. Once published, never edit it. |
| `title` | ✅ | |
| `category_slug` | ✅ | Must match a row in the `categories` tab |
| `description` | | |
| `venue` | | |
| `starts_at` | ✅ | `YYYY-MM-DD HH:mm`, Asia/Kolkata — see §5 |
| `ends_at` | ✅ | same; must be `>= starts_at` |
| `capacity` | ✅ | positive integer |
| `is_team_event` | | `TRUE`/`FALSE` |
| `min_team_size` / `max_team_size` | | ints; if `is_team_event`, `max >= min >= 2` |
| `status` | ✅ | uppercase, see §6 |
| `payment_required` | | `TRUE`/`FALSE` |
| `fee_amount` | | integer **rupees** (not paise) |

### Tab `schedule`

| column | required | notes |
|---|---|---|
| `event_slug` | ✅ | must match an `events` row |
| `round_name` | ✅ | e.g. `Prelims`, `Finals` |
| `venue` | | |
| `starts_at` / `ends_at` | ✅ | same format |

### Tab `categories`

`slug` (✅, stable key), `name` (✅), `description`.

Give the fest team a **locked template** with data validation on `status`, the booleans
and the date columns. Every hour you spend on sheet-side validation is an hour you don't
spend debugging someone's `"25/12/2026"`.

---

## 4. Upsert strategy (this is where the bugs live)

**`slug` is the identity.** Sheet rows have no UUID; the DB requires one. So:

- **Events**: `SELECT id FROM events WHERE slug = ?`. Found → `UPDATE`. Not found →
  `INSERT` with a fresh `uuidv7()`. **Never regenerate an id for an existing slug** —
  that orphans every registration.
- Renaming a slug in the sheet reads as *delete old + create new*. Say so in the sheet's
  instructions row: **slug is permanent once published.**
- **Categories**: same, keyed on `slug`.
- **Schedule slots**: `schedule_slots` has no natural key and nothing FKs to it, so
  per event, inside a transaction: delete that event's slots, insert the sheet's. Simple
  and correct. Do it **per event**, not globally — one bad event's slots shouldn't wipe
  everyone's.

Wrap the whole sync in one transaction per event, not one for the entire run. A single
malformed row should skip that event, not roll back 60 good ones.

---

## 5. Timezones — read this twice

DB columns are `timestamp(3)`; the connection runs in UTC. Sheets hands you a naive
string with no zone. Fest staff type local time.

**Parse as `Asia/Kolkata`, convert to UTC, store UTC. The API always emits ISO-8601 UTC
(`2026-12-25T09:30:00.000Z`); clients format for display.**

Get this wrong and every event on the schedule page is 5h30m off — which nobody notices
until the day of the fest. Write a test with a known IST input and its exact expected
UTC output.

Use `date-fns-tz` or `Temporal`; do not hand-roll `+05:30`.

---

## 6. Status

Uppercase in the DB (matches the `'DRAFT'` default and `users.status`). The admin
dashboard lowercases for display — that adapter is not your problem.

```
DRAFT → PUBLISHED → REGISTRATION_CLOSED → ONGOING → COMPLETED
anything except COMPLETED → CANCELLED
```

Reject any other value at import and skip the row.

> **`DRAFT` must be invisible on every participant endpoint — including
> `GET /events/:id` and `GET /events/slug/:slug`, not just the list.**

Filter it in the **repository**, not the route, so a new route can't forget. The leak
is always through detail-by-id. Test all three endpoints.

---

## 7. Sync mechanics

- **Auth: a Google _service account_ with a read-only Sheets scope**
  (`spreadsheets.readonly`), and share the sheet with that service account's email as
  Viewer. This is *not* the OAuth client used for user sign-in — different credential,
  don't reuse it. Read-only scope means a bug in your code can never write to the sheet.
- **Triggers**: a scheduled run (every 10–15 min is plenty) **plus** a manual
  `POST /api/v1/admin/events/sync` behind `assertAdmin`, so staff can force a refresh
  after editing instead of waiting. On fest day the manual button is the one that matters.
- **Never let two syncs overlap** — an in-process boolean guard is enough at this scale;
  note the ceiling in a comment if we ever run multiple instances.
- **Report the result**, don't swallow it: return `{ created, updated, cancelled, skipped[] }`
  where `skipped` names the row and why. A sync that quietly imports 58 of 60 events is
  worse than one that fails loudly.
- **Abort if the sheet looks empty or truncated** (e.g. it returns 0 rows but the DB has
  40 events). A revoked share or a renamed tab returns an empty range, not an error, and
  a naive sync would cancel the entire fest.
- Write an `audit_log` row per sync (see `src/repositories/audit-log.repository.ts`).

---

## 8. API contract you must hit

Registered via `src/routes/index.ts`. Prefixes come from `src/config/routes.ts` —
never write a path literal.

**Participant** (`/api/v1/events`) — public, no auth, `DRAFT` filtered out:

```
GET /api/v1/events                 ?category=<slug>&status=<STATUS>
GET /api/v1/events/slug/:slug
GET /api/v1/events/:id
GET /api/v1/events/schedule        ?date=YYYY-MM-DD  (flattened slots, chronological)
GET /api/v1/events/categories
```

**Admin** (`/api/v1/admin/events`) — every handler calls `assertAuthenticated` +
`assertAdmin`, no exceptions:

```
GET  /api/v1/admin/events          all statuses incl. DRAFT
POST /api/v1/admin/events/sync     manual re-import
POST /api/v1/admin/events/:id/status   validated transition (§6)
```

**No admin create/update/delete for events.** The sheet is the source of truth; a second
write path means the next sync silently overwrites whatever an admin typed. Status
override is the one exception, and even that gets stomped if the sheet also sets status —
decide and document which wins (recommendation: the sheet wins, and the override exists
only for `CANCELLED` in an emergency).

**Fields to omit from responses** (the dashboard's mock model has them, our DB doesn't —
they're unresolved with the team, so emit nothing rather than a guess): `registrationClosesAt`,
`requiresIndemnity`, `coordinatorName`, `coordinatorPhone`, and a flat `track`. Expose
`categoryId` plus a nested `category` object instead.

**Defer `GET /:id/stats`** — it needs registration counts and that lane isn't built.
Returning `0` would be a lie an admin acts on.

---

## 9. Repo landmines

- **`drizzle-kit generate` will propose `DROP TABLE` for ~16 tables.** Drizzle diffs the
  schema barrel against the live DB, and most tables have no `schema.ts` yet. Read
  `src/db/schema/index.ts` — the guardrail is documented there. **Hand-review every
  generated migration before applying it.**
- Because `events`, `event_categories` and `schedule_slots` already exist in the DB,
  translate their DDL **exactly** from `drizzle/migrations/0000_ambiguous_sauron.sql`
  (lines 111–146, 197–205) into `src/db/schema/events.ts` — same types, same `fsp: 3` on
  every timestamp, no new columns. A correct translation produces an **empty** diff.
  Verify that; a non-empty diff means you mistyped something.
- **`src/routes/route-inventory.test.ts` will fail** when you add routes. That's the
  point — it's a guard, not a bug. Add your exact paths to the list, and the diff makes
  the new API surface reviewable.
- Two DB pools: `getAppDb()` for reads, `getWriterDb()` for writes. The sync uses the
  writer.
- Tests run against **real local MySQL** via `docker-compose`, not mocks. Mock only the
  Sheets API client.
- **Don't commit** — Kartik does the commits.

## 10. Config

Add to `src/config/env.ts` (Zod-validated) **and** all three `.env*.example` files:

```
GOOGLE_SHEETS_SPREADSHEET_ID=
GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON=      # base64 of the JSON key
EVENTS_SYNC_ENABLED=true
EVENTS_SYNC_INTERVAL_MINUTES=15
```

The service-account key is a real credential — `.env` only, never committed, and give it
its own key so it can be rotated without touching sign-in.

## 11. Files

```
src/db/schema/events.ts           translate from migration 0000, no new columns
src/repositories/events.repository.ts   DRAFT filtering lives HERE
src/services/events-sheets.service.ts   fetch + validate + upsert
src/services/event.service.ts           status transitions, read logic
src/routes/events.routes.ts             participant
src/routes/admin/events.routes.ts       admin, all assertAdmin
```

## 12. Tests that must exist

1. A sheet omitting an event **cancels** it and leaves its registrations intact. (§2)
2. IST input → correct UTC output. (§5)
3. `DRAFT` invisible on list, by-slug **and** by-id. (§6)
4. Re-running an unchanged sync is a no-op — same ids, no duplicate slots. (§4)
5. One malformed row is skipped and reported; the other rows still import. (§7)
6. Valid and invalid status transitions. (§6)

## 13. Questions to settle before you start

- Who owns the sheet, and is it locked to editors? An open sheet is an unauthenticated
  write path into production data.
- If the sheet and an admin status override disagree, which wins?
- Fest day: is a 15-minute sync lag acceptable for last-minute venue changes, or do we
  need the manual trigger wired into the dashboard UI on day one?
