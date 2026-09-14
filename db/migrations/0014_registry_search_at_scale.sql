-- 0014 Make the registry's hot paths hold at statewide volume
-- (master system prompt §51, §63, §81).
--
-- Everything here answers a measurement, not a hunch. The numbers are from a
-- four-million-record register, three million audit events, on four cores; the
-- method and the full results are in docs/load-testing.md.

-- 1. Searching the register by name.
--
-- `display_name % $1` with `ORDER BY display_name` had two plans and neither was
-- acceptable: a bitmap scan of the GIN trigram index at 402ms, or - once the
-- planner saw the real selectivity of a common surname - a parallel sequential
-- scan of the whole table at 2.6 seconds. A surname against a statewide register
-- matches a couple of hundred thousand people, and sorting all of them to return
-- twenty is work proportional to the register.
--
-- The fix is in the service, not here: the count is bounded, a search matching
-- more people than anybody could look through is refused, and what remains is
-- ordered by trigram distance over at most a thousand rows.
--
-- What belongs here is the *removal* of an index, which is the opposite of what
-- this migration was first written to do. A GiST trigram index on display_name
-- was added to answer `ORDER BY display_name <-> $1` from the index. Measured, it
-- made things worse in the case that matters:
--
--   Bitmap Index Scan on citizen_dob_idx                185 rows      0.03ms
--   Bitmap Index Scan on citizen_display_name_trgm_gist  39,761 rows  1,072ms
--
-- The planner costed that second scan at 353 and it took a second. For a name
-- searched with a date of birth beside it - the search a service counter
-- actually makes - the date index alone finds the right two hundred rows in
-- microseconds, and the trigram scan contributes nothing but its own cost. About
-- one search in twelve drew that plan, which is the worst kind of defect: fast
-- in every test, occasionally a second, and never reproducible on demand.
--
-- The GIN index on display_name goes for the same reason: it was chosen for
-- BitmapAnd against a ward or LGA filter, where it cost 822ms and narrowed
-- nothing. Neither index is needed once the result set is bounded to a thousand
-- rows, because sorting a thousand rows by trigram distance is free. The trigram
-- indexes on given_name and family_name stay: duplicate detection matches on
-- those, and that query is narrowed by the date of birth before the name is
-- considered.
--
-- 542MB of index removed, and one fewer index to maintain on every registration.
DROP INDEX IF EXISTS citizen_display_name_trgm;

-- 2. Duplicate detection before a PCID is issued.
--
-- The candidate query matched on `lower(email)`, which no index covered - the
-- email column had no index at all - so that branch alone forced a scan of the
-- register on every registration.
CREATE INDEX citizen_email_lower_idx ON citizen (lower(email)) WHERE email IS NOT NULL;

-- 3. The audit chain head.
--
-- One row, updated once per audited operation. Three million audit events left
-- that one row occupying 32MB of dead versions, because autovacuum's defaults
-- are written for tables where a few per cent of rows change, and here a hundred
-- per cent of the table changes several hundred times a second. `VACUUM FULL`
-- took it back to 32kB.
--
-- So it is vacuumed on its own terms: after twenty-five updates rather than
-- after a proportion of a single row, and without the cost delay that throttles
-- ordinary autovacuum - this is one page, and the platform's busiest one.
ALTER TABLE audit_chain_head SET (
  autovacuum_vacuum_threshold = 25,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_cost_delay = 0,
  autovacuum_vacuum_cost_limit = 10000,
  autovacuum_analyze_threshold = 1000000
);

-- The bloat that has already accumulated is not removed here. VACUUM FULL takes
-- an ACCESS EXCLUSIVE lock, and on this table that stops every audited operation
-- in the platform - which is to say all of them. An existing deployment runs it
-- in a maintenance window; docs/deployment.md says so.
