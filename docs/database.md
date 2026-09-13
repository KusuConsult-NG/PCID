# Database

PostgreSQL 16. The schema is applied by version-controlled migrations in
[`db/migrations`](../db/migrations); nothing is ever changed by hand.

## Migrations

Each file is applied once, inside its own transaction, and its SHA-256 checksum
is recorded in `schema_migration`. **Editing an applied migration is refused** —
the runner compares checksums and stops. The fix for a shipped migration is a new
migration, because an edited one silently diverges between environments.

Concurrent migrators serialise on an advisory lock rather than racing.

```bash
npm run db:migrate    # idempotent
npm run db:seed       # reference data; also idempotent
```

| File                           | Contents                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `0001_reference_data`          | Extensions, LGAs, wards, communities, reference sequences                                                             |
| `0002_agencies_and_iam`        | Agency registry, roles, users, sessions, MFA, API clients                                                             |
| `0003_audit`                   | The append-only hash-chained audit trail                                                                              |
| `0004_citizen_registry`        | PCID allocation, citizens, emergency contacts, registration, duplicates, corrections                                  |
| `0005_linked_records`          | Property, vehicle, business, licence, revenue projections; data sources, sync jobs, conflicts; the relationship graph |
| `0006_public_safety`           | Incidents, dispatch, response units, cases, missing and unidentified persons, matches                                 |
| `0007_authorization_workflows` | Access requests, break-glass grants, alert rules, alerts, notifications                                               |
| `0008_database_roles`          | `pcid_app` and `pcid_readonly` privileges                                                                             |
| `0009_postgis_optional`        | PostGIS acceleration where available; a portable great-circle function otherwise                                      |

## Invariants held by the database

These are the guarantees that do not depend on application code being correct.

### The audit trail cannot be rewritten

`audit_event` has triggers refusing `UPDATE`, `DELETE` and `TRUNCATE`, and
`pcid_app` is not granted those privileges either. Two independent controls, so a
mistake in one does not lose the guarantee.

Each row is chained: `hash = sha256(prev_hash || canonical_payload)`, computed by
a `BEFORE INSERT` trigger so a caller cannot supply its own predecessor. The
canonical payload is defined by `audit_event_payload()` **in the database**, so
verification never depends on an application being available:

```sql
SELECT * FROM verify_audit_chain();          -- no rows means intact
SELECT * FROM verify_audit_chain(1000, 2000); -- a range
```

An event marked `ACCESS_RESTRICTED_FROM_CITIZEN` must carry a
`restriction_basis`; a check constraint enforces it.

### A PCID is never recycled

`pcid_allocation` is append-only by the same pattern. Every identifier ever
issued is recorded before the citizen row exists, so one handed out for a
registration later rejected can never be issued again. A check constraint
enforces the format, including the exclusion of the ambiguous characters.

### A match is never confirmed without a person

```sql
CONSTRAINT person_match_confirmation_is_human CHECK (
  status <> 'CONFIRMED' OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
)
```

No code path — present or future — can record an automated identification.

### Break glass is bounded in the schema

```sql
CONSTRAINT break_glass_grant_bounded CHECK (
  expires_at > granted_at AND expires_at <= granted_at + interval '1 hour'
)
```

The gates a grant may satisfy are constrained to the four binding gates, so a
grant covering a clearance ceiling cannot be stored at all.

### Nobody approves their own access request

```sql
CONSTRAINT access_request_no_self_approval CHECK (
  decided_by_user_id IS NULL OR decided_by_user_id <> requested_by_user_id
)
```

The API refuses it too. The constraint is there for the code path that forgets.

## Privileges

| Role                    | What it can do                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| owner (migrations only) | DDL. Used by the migration job, never by the API.                                                                                        |
| `pcid_app`              | SELECT, INSERT, UPDATE, DELETE — except UPDATE/DELETE on `audit_event` and `pcid_allocation`. Owns nothing, so it cannot drop a trigger. |
| `pcid_readonly`         | SELECT, excluding `citizen`, `emergency_contact`, `citizen_account` and both MFA tables. For operational reporting.                      |

No credential is issued to anything outside the API service.

## Key tables

**`citizen`** — the registry. `status` is the record's lifecycle (ACTIVE,
SUSPENDED, DECEASED, MERGED); `verification_level` is the assurance of the
identity. These are separate on purpose: a newly registered resident has a live
record at SELF_ASSERTED assurance, and conflating them would make every new
registration look invalid.

`nin` is nullable, unique when present, and records the agency that supplied it.

**`agency`** — the Government Agency Registry. Category, status, jurisdiction,
maximum classification, data-sharing agreement and expiry. Compartments are a
separate table with a legal basis per grant, so no agency name ever appears in
authorisation logic.

**`investigation_case` / `case_assignment` / `case_subject`** — case-bound access.
`case_subject` is the association that opens a record; it carries a written
justification and the officer who made it.

**`incident` / `incident_agency` / `incident_officer`** — incident-bound access.
Every coordinate carries `location_source` and, for incidents,
`location_retention_until`.

**Linked-record projections** (`property`, `vehicle`, `business`, `licence`,
`revenue_profile`) — each carries `source_agency_id`, `source_system`,
`source_record_id`, `source_updated_at`, `last_synced_at` and
`verification_status`, unique on the source triple. This is the source-of-truth
model in the schema: the platform holds a projection, not the record.

## Indexing

Trigram GIN indexes on citizen names for approximate matching; plain indexes on
phone, LGA, ward, status and date of birth; partial indexes on active
assignments; descending time indexes on the audit and incident tables, which are
almost always read newest-first.

`pg_trgm` avoids a separate search cluster at state scale. OpenSearch becomes
worthwhile if fuzzy search across several million records becomes a hot path;
nothing in the design prevents it.

## Geography

Latitude and longitude are `numeric(9,6)` — about 10 cm resolution, exact, and
portable. `0009` adds generated PostGIS geography columns and GiST indexes where
the extension is installed; without it, `great_circle_metres()` provides the same
semantics in SQL. The schema is identical either way.

## Conventions

- `timestamptz` everywhere. No naive timestamps.
- UUID primary keys via `gen_random_uuid()`, plus a human-readable reference
  (`INC-2026-000123`) where people quote it aloud.
- References are allocated by `next_reference(scope, period)`, which increments
  atomically.
- `updated_at` is maintained by a trigger, not by application code.
- Enumerations are `text` with a `CHECK` constraint rather than PostgreSQL enums,
  because adding a value is a plain migration.
- Deletes are avoided. Records are superseded, closed, revoked or unlinked, so
  history stays legible.

## Backups

See [disaster-recovery.md](disaster-recovery.md). The restore path is tested,
including that the audit chain still verifies afterwards.
