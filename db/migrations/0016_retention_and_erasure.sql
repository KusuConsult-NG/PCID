-- 0016 Retention and erasure
-- (master system prompt §21, §68).
--
-- The schedules existed on paper. `citizen.retention_policy`,
-- `incident.retention_policy` and `investigation_case.retention_policy` carried
-- defaults; `incident.location_retention_until` was set on every write;
-- `docs/privacy.md` printed a table of periods. Nothing read any of it, and
-- nothing ever erased a row. A retention schedule that nothing applies is a
-- claim rather than a control - and the platform was making that claim to a
-- regulator in writing.
--
-- Two tables here: what a sweep did, and what it erased. Neither ever holds what
-- was erased. A ledger that recorded the contents of a deleted row in order to
-- prove it was deleted would defeat the deletion.

-- The policy vocabulary is the contracts catalogue, held to this constraint by
-- packages/contracts/test/retention.test.ts. It is stated here as well as there
-- because a column that accepts any string is a column that will eventually
-- contain a typo nothing enforces.
ALTER TABLE citizen
  ADD CONSTRAINT citizen_retention_policy_known
  CHECK (retention_policy IN ('CITIZEN_IDENTITY_LONG_TERM'));
ALTER TABLE incident
  ADD CONSTRAINT incident_retention_policy_known
  CHECK (retention_policy IN ('INCIDENT_STANDARD'));
ALTER TABLE investigation_case
  ADD CONSTRAINT case_retention_policy_known
  CHECK (retention_policy IN ('SECURITY_CASE_LEGAL'));

-- One sweep.
CREATE TABLE retention_run (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference       text NOT NULL UNIQUE,

  -- Who asked. A scheduled sweep has no actor and says so, rather than
  -- borrowing the identity of whoever deployed it.
  trigger         text NOT NULL CHECK (trigger IN ('SCHEDULED','MANUAL')),
  actor_type      text NOT NULL CHECK (actor_type IN ('GOVERNMENT_USER','SYSTEM')),
  actor_id        uuid REFERENCES government_user (id) ON DELETE SET NULL,
  actor_display   text,

  -- A dry run counts what is due and erases nothing. It exists because the
  -- first live sweep on a deployment that has been running for a year is the
  -- one nobody wants to be surprised by.
  dry_run         boolean NOT NULL DEFAULT false,

  status          text NOT NULL DEFAULT 'RUNNING'
                    CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  rows_affected   integer NOT NULL DEFAULT 0,
  -- True when a rule hit its batch limit: there is more to do and the next
  -- sweep will continue. Reported rather than hidden, because "we ran it and it
  -- said 5000" must not be mistaken for "there were 5000".
  more_remaining  boolean NOT NULL DEFAULT false,
  error           text,

  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,

  correlation_id  text,

  CONSTRAINT retention_run_actor_matches_trigger CHECK (
    (trigger = 'SCHEDULED' AND actor_type = 'SYSTEM' AND actor_id IS NULL)
    OR (trigger = 'MANUAL' AND actor_type = 'GOVERNMENT_USER' AND actor_id IS NOT NULL)
  ),
  CONSTRAINT retention_run_failure_has_reason CHECK (
    status <> 'FAILED' OR error IS NOT NULL
  )
);
CREATE INDEX retention_run_started_idx ON retention_run (started_at DESC);

-- What one rule did in one sweep: a policy, a table, a cutoff and a count.
--
-- Deliberately not a list of identifiers. Recording which rows were erased would
-- keep a pointer to each erased subject for as long as the ledger is kept, which
-- is a longer retention than the data itself had. The count and the cutoff are
-- what an oversight review needs: it can re-derive what should have gone.
CREATE TABLE retention_erasure (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES retention_run (id) ON DELETE CASCADE,
  policy_key      text NOT NULL,
  disposition     text NOT NULL CHECK (disposition IN ('DELETE','REDACT')),
  table_name      text NOT NULL,
  cutoff          timestamptz NOT NULL,
  rows_affected   integer NOT NULL CHECK (rows_affected >= 0),
  capped          boolean NOT NULL DEFAULT false,
  executed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, policy_key)
);
CREATE INDEX retention_erasure_policy_idx ON retention_erasure (policy_key, executed_at DESC);

-- A ledger of erasures that could itself be edited would prove nothing.
CREATE FUNCTION retention_erasure_is_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'retention_erasure is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER retention_erasure_no_update
  BEFORE UPDATE ON retention_erasure
  FOR EACH ROW EXECUTE FUNCTION retention_erasure_is_append_only();
CREATE TRIGGER retention_erasure_no_delete
  BEFORE DELETE ON retention_erasure
  FOR EACH ROW EXECUTE FUNCTION retention_erasure_is_append_only();

-- Redaction leaves a mark, and the mark is what makes it idempotent.
--
-- Without it a rule has to recognise an already-redacted row by its contents -
-- comparing a body against a placeholder string - which is both slow and the
-- kind of check that stops matching the day somebody edits the wording. It also
-- gives the interface a date: "erased on 4 March under the retention schedule"
-- is an answer, and a blank field is not.
ALTER TABLE incident ADD COLUMN location_erased_at timestamptz;
ALTER TABLE notification ADD COLUMN content_erased_at timestamptz;

-- Finding what is due, without reading the whole table and without an index
-- that grows for ever.
--
-- The two redaction rules get partial btrees whose predicate is "not yet
-- erased", so each index shrinks as its backlog is worked off and holds only
-- the rows still awaiting a decision.
CREATE INDEX incident_location_retention_idx ON incident (location_retention_until)
  WHERE location_erased_at IS NULL AND location_retention_until IS NOT NULL;
CREATE INDEX notification_content_retention_idx ON notification (created_at)
  WHERE content_erased_at IS NULL;

-- The delete rules read append-ordered tables, where a row's position and its
-- timestamp agree. BRIN suits that exactly: a few kilobytes instead of a btree
-- the size of the table, and the sweep takes any due batch rather than the
-- oldest one, so it never needs a sorted scan. `user_session (expires_at)`,
-- `credential_verification_token (expires_at)` and
-- `sensitive_action_counter (window_start)` already have btrees from earlier
-- migrations and get nothing further.
CREATE INDEX login_attempt_attempted_at_brin ON login_attempt USING brin (attempted_at);
CREATE INDEX notification_attempt_attempted_at_brin
  ON notification_delivery_attempt USING brin (attempted_at);
CREATE INDEX offline_release_released_at_brin ON offline_release USING brin (released_at);

-- Existing incidents predate the retention date being set on write. Give them
-- the schedule's default from their own report date rather than from now, so a
-- backlog is erased on the timetable it should always have had rather than
-- getting ninety fresh days because the platform was upgraded.
UPDATE incident
   SET location_retention_until = reported_at + interval '90 days'
 WHERE location_retention_until IS NULL;

-- `offline_release` stays append-only to the application.
--
-- Migration 0015 granted `pcid_app` SELECT and INSERT on it and nothing else, so
-- the record of what left the platform cannot be edited or removed by the code
-- that writes it. The retention schedule still has to reach it after a year, so
-- it reaches it the same way revocation does: through one named function owned
-- by the table's owner, which erases by the schedule's cutoff and nothing else.
-- A grant of DELETE would have been three lines shorter and would have given the
-- whole application a way to remove the evidence.
CREATE FUNCTION retention_erase_offline_releases(p_cutoff timestamptz, p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_erased integer;
BEGIN
  WITH doomed AS (
    SELECT id FROM offline_release
     WHERE released_at < p_cutoff
     ORDER BY released_at
     LIMIT p_limit
  ), gone AS (
    DELETE FROM offline_release WHERE id IN (SELECT id FROM doomed) RETURNING 1
  )
  SELECT count(*)::integer INTO v_erased FROM gone;
  RETURN v_erased;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcid_app') THEN
    GRANT SELECT, INSERT, UPDATE ON retention_run TO pcid_app;
    -- Append-only in privilege as well as in trigger.
    GRANT SELECT, INSERT ON retention_erasure TO pcid_app;
    -- The sweep needs DELETE only on the operational tables it prunes. It is
    -- granted on nothing that holds a citizen record, a case or an audit event -
    -- so the schedule could not destroy one of those even if a rule were written
    -- to try.
    GRANT DELETE ON login_attempt, user_session, credential_verification_token,
                    notification_delivery_attempt, sensitive_action_counter TO pcid_app;
    GRANT EXECUTE ON FUNCTION retention_erase_offline_releases(timestamptz, integer) TO pcid_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcid_readonly') THEN
    GRANT SELECT ON retention_run, retention_erasure TO pcid_readonly;
  END IF;
END;
$$;
