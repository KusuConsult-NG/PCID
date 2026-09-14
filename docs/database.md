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

| File                                  | Contents                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `0001_reference_data`                 | Extensions, LGAs, wards, communities, reference sequences                                                             |
| `0002_agencies_and_iam`               | Agency registry, roles, users, sessions, MFA, API clients                                                             |
| `0003_audit`                          | The append-only hash-chained audit trail                                                                              |
| `0004_citizen_registry`               | PCID allocation, citizens, emergency contacts, registration, duplicates, corrections                                  |
| `0005_linked_records`                 | Property, vehicle, business, licence, revenue projections; data sources, sync jobs, conflicts; the relationship graph |
| `0006_public_safety`                  | Incidents, dispatch, response units, cases, missing and unidentified persons, matches                                 |
| `0007_authorization_workflows`        | Access requests, break-glass grants, alert rules, alerts, notifications                                               |
| `0008_database_roles`                 | `pcid_app` and `pcid_readonly` privileges                                                                             |
| `0009_postgis_optional`               | PostGIS acceleration where available; a portable great-circle function otherwise                                      |
| `0010_citizen_portal`                 | Credentials, verification tokens, and the resident's self-service state                                               |
| `0011_audit_chain_serialisation`      | The locked chain head that makes the audit chain correct under concurrency                                            |
| `0012_notification_delivery`          | Templates, backoff, suppression, deduplication, and the per-attempt delivery record                                   |
| `0013_spatial_lookup`                 | Position indexes the command map's bounding-box queries actually use                                                  |
| `0014_registry_search_at_scale`       | Trigram ordering for name search, an email index for duplicate detection, and the chain head's own vacuum settings    |
| `0015_registered_devices_and_offline` | Devices allowed to hold something offline, and the record of every release that left                                  |

## Invariants held by the database

These are the guarantees that do not depend on application code being correct.

### A proximity query is bounded before it is measured

0009 added GiST indexes on a generated geography column, and only where PostGIS
is installed. Nothing queried them: the platform's one proximity query computed
a great-circle distance for every row in the table and sorted the result, which
is a sequential scan whether PostGIS is present or not.

0013 adds partial b-tree indexes on `(latitude, longitude)` for the portable
path — the one every deployment without PostGIS uses, and the one the platform
must be fully functional on. Latitude leads because a bounding box on the ground
is narrow in latitude and the planner can range-scan it before filtering
longitude. They are partial because most rows in both tables never carry a
coordinate: an incident reported by address has none, and a unit that has not
reported its position has none.

The application side is what makes them usable: the bounding box goes into the
`WHERE` clause and the distance is computed only for the rows that survive it.
When the box finds nothing, the query falls back to measuring the whole fleet
rather than answering "nothing to send" — a slow answer beats a wrong one when
somebody is waiting for an ambulance.

### A name search is bounded before it is answered

Measured on four million records: `display_name % $1` matched a hundred and ten
thousand people for a whole name and a quarter of a million for a surname, and
`ORDER BY display_name` then had to sort all of them to return twenty. One search
read the entire table and took 2.6 seconds.

Three changes, and the order of them is the point:

1. The count runs first and stops at the cap (`LIMIT 1001`), so discovering that
   a search is too broad costs 32-85ms instead of 2.6 seconds.
2. A search matching more people than an officer could look through is refused
   with advice on what to add, so the expensive page is never built. This is a
   privacy control before it is a performance one: a surname against a statewide
   register is not an identification, and paging through the result is browsing
   the register.
3. What remains is ordered by trigram distance, not alphabetically, which a GiST
   index answers by walking in that order. A name with a date of birth beside it
   - the search a service counter actually makes - is answered in 2.5ms.

Duplicate detection had the same defect and a worse consequence. It matched on
`similarity(family_name, $2) > 0.3`, which is a function call and so not an index
condition: every registration read the whole register, 1.3 seconds each. It had
also stopped working: a surname net over a statewide register returns a couple of
hundred thousand people, and the query took an arbitrary fifty of them, so a real
duplicate was usually not among them. The net is now the surname paired with the
date of birth, which no candidate above the review threshold can escape - the
arithmetic is asserted by a test - and it runs in 0.4ms.

### What leaves on a device is bounded by the schema

`offline_release` records every bundle that left the platform: which device,
which incident or which person, how many records, and when it expires. Two
constraints do the work that code must not be trusted alone to do:

```sql
CONSTRAINT offline_release_bounded CHECK (
  expires_at > released_at AND expires_at <= released_at + interval '24 hours'
)
CHECK (record_count >= 0 AND record_count <= 50)
```

A test holds the contract's constants to those numbers, so raising one in code
without the other fails the build.

The table holds the _shape_ of a release and never its contents. Storing the
payload would put the same personal data in a second place under a second
retention rule, which is the thing the controlled offline mode exists to avoid.

Revoking a device invalidates what it held in the same statement, through an
`AFTER UPDATE` trigger that is `SECURITY DEFINER` — `pcid_app` may insert and
select on `offline_release` and nothing else, so the record of what left is
append-only to the application and only the trigger closes a row.

### A message is never sent twice, and never sent for ever

`notification.dedupe_key` carries a partial unique index, so a producer that is
retried — a request replayed, a sync run again — queues nothing the second time
rather than sending somebody the same thing twice.

The worker claims with `FOR UPDATE SKIP LOCKED` inside a transaction that also
moves the row to `SENDING`, so two workers never take the same message however
many are running. A worker killed between the claim and the send leaves a row in
`SENDING`; `next_attempt_at` is what brings it back, rather than a lock with
nobody left to clear it.

`notification_delivery_attempt` is append-only at the privilege level as well as
in intent: `pcid_app` may insert and select and nothing else. An operator
reading "it failed four times" is reading four rows, not a counter somebody
could quietly revise. The table records the outcome and the gateway's reference
and never the body — the body is on the notification, and copying it here would
put the same personal information in two places with two retention rules.

### The audit trail cannot be rewritten, or forked

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

The chain is extended under a row lock. `audit_chain_head` holds one row — the
hash of the last link and the number the next one carries — and the trigger reads
it with `SELECT ... FOR UPDATE`, which re-reads the latest committed version
after waiting. A plain `SELECT` cannot: under READ COMMITTED the trigger runs
inside the inserting statement's snapshot, so concurrent writers read the same
tail and the chain forks. The sequence number comes from that same row rather
than from a `bigserial`, because sequence values are handed out before commit and
the order the chain is forged in has to be the order it is verified in.

The trigger is `SECURITY DEFINER` and `pcid_app` holds no privilege on
`audit_chain_head` at all, so no application path — not even a direct connection
— can choose its own predecessor.

The chain head is one row, updated once per audited operation, and autovacuum's
defaults are written for tables where a few per cent of rows change. Three
million audit events left that single row occupying 32MB of dead versions.
`0014` gives it its own vacuum settings - after twenty-five updates, with no cost
delay - because it is one page and the busiest one in the platform.

Measured throughput of the chain: about 1,100 audited writes a second on one
connection and about 1,300 across sixteen. The second figure is the ceiling on
audited operations for the whole platform, and adding API instances does not
raise it. `docs/load-testing.md` sets out what that means and when it would need
revisiting.

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

**`citizen_account` / `credential` / `credential_verification_token`** — the
resident's own access. `citizen_account.must_change_password` is set when a
passphrase is issued at a desk and cleared only when the resident replaces it, so
a credential somebody else wrote down cannot stay in use. A `credential` is the
thing that can be replaced when a card is lost; the Plateau Citizen ID it names
is not. Verification tokens are short-lived by constraint, not by convention:
`credential_token_display_is_short_lived` refuses a row whose lifetime exceeds
fifteen minutes, so no future code path can quietly issue a long-lived one.

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
