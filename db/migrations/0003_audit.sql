-- 0003 Immutable audit (master system prompt §25, §26, §69).
--
-- Every audit row is chained: hash = sha256(prev_hash || canonical payload). Any
-- alteration or deletion of a historical row breaks the chain from that point on,
-- and `SELECT verify_audit_chain(...)` detects it. UPDATE and DELETE are refused
-- outright by a trigger, so the chain is a second line of defence rather than the
-- only one.

CREATE TABLE audit_event (
  seq                 bigserial PRIMARY KEY,
  id                  uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  occurred_at         timestamptz NOT NULL DEFAULT now(),

  action              text NOT NULL,
  outcome             text NOT NULL CHECK (outcome IN ('PERMITTED','DENIED','ERROR')),

  actor_type          text NOT NULL CHECK (actor_type IN
                        ('GOVERNMENT_USER','CITIZEN','API_CLIENT','SYSTEM','INTEGRATION')),
  actor_id            uuid,
  actor_display       text,
  agency_id           uuid,
  agency_code         text,
  roles               text[] NOT NULL DEFAULT '{}',

  purpose             text,
  resource_type       text NOT NULL,
  resource_id         text,
  -- The PCID the access concerned, which is what the citizen's own access
  -- history is keyed on (§26).
  subject_pcid        text,
  case_id             uuid,
  case_number         text,
  incident_id         uuid,
  incident_number     text,

  -- Which fields were actually released, and which were withheld and why (§25).
  fields_released     text[] NOT NULL DEFAULT '{}',
  fields_withheld     jsonb NOT NULL DEFAULT '[]'::jsonb,

  decision_reasons    jsonb NOT NULL DEFAULT '[]'::jsonb,
  break_glass_used    boolean NOT NULL DEFAULT false,
  break_glass_id      uuid,
  approvals_used      text[] NOT NULL DEFAULT '{}',

  citizen_visibility  text NOT NULL DEFAULT 'ACCESS_VISIBLE_TO_CITIZEN'
                        CHECK (citizen_visibility IN
                          ('ACCESS_VISIBLE_TO_CITIZEN','ACCESS_RESTRICTED_FROM_CITIZEN')),
  restriction_basis   text,

  ip_address          inet,
  user_agent          text,
  device_fingerprint  text,
  correlation_id      text NOT NULL,
  detail              jsonb NOT NULL DEFAULT '{}'::jsonb,

  prev_hash           text NOT NULL,
  hash                text NOT NULL,

  CONSTRAINT audit_event_restriction_has_basis CHECK (
    citizen_visibility = 'ACCESS_VISIBLE_TO_CITIZEN' OR restriction_basis IS NOT NULL
  )
);

CREATE INDEX audit_event_subject_pcid_idx ON audit_event (subject_pcid, occurred_at DESC);
CREATE INDEX audit_event_actor_idx ON audit_event (actor_id, occurred_at DESC);
CREATE INDEX audit_event_agency_idx ON audit_event (agency_id, occurred_at DESC);
CREATE INDEX audit_event_action_idx ON audit_event (action, occurred_at DESC);
CREATE INDEX audit_event_case_idx ON audit_event (case_id) WHERE case_id IS NOT NULL;
CREATE INDEX audit_event_incident_idx ON audit_event (incident_id) WHERE incident_id IS NOT NULL;
CREATE INDEX audit_event_break_glass_idx ON audit_event (break_glass_id) WHERE break_glass_used;
CREATE INDEX audit_event_occurred_at_idx ON audit_event (occurred_at DESC);

-- Refuse every mutation of history. This is a hard stop: not even a superuser
-- path in the application can modify an audit row, because the application never
-- connects as a role that may drop the trigger.
CREATE FUNCTION audit_event_is_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_is_append_only();

CREATE TRIGGER audit_event_no_delete
  BEFORE DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_is_append_only();

CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_is_append_only();

-- Canonical serialisation of the fields covered by the chain hash. Kept in the
-- database so that verification never depends on an application being available.
CREATE FUNCTION audit_event_payload(e audit_event)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT concat_ws('|',
    e.id::text,
    to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    e.action,
    e.outcome,
    e.actor_type,
    coalesce(e.actor_id::text, ''),
    coalesce(e.agency_id::text, ''),
    coalesce(e.purpose, ''),
    e.resource_type,
    coalesce(e.resource_id, ''),
    coalesce(e.subject_pcid, ''),
    coalesce(e.case_id::text, ''),
    coalesce(e.incident_id::text, ''),
    array_to_string(e.fields_released, ','),
    e.fields_withheld::text,
    e.decision_reasons::text,
    e.break_glass_used::text,
    coalesce(e.break_glass_id::text, ''),
    array_to_string(e.approvals_used, ','),
    e.citizen_visibility,
    coalesce(e.restriction_basis, ''),
    e.correlation_id,
    e.detail::text
  );
$$;

-- Fill prev_hash and hash on insert so the chain cannot be forged by a caller
-- that supplies its own values.
CREATE FUNCTION audit_event_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev text;
BEGIN
  SELECT hash INTO v_prev FROM audit_event ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := coalesce(v_prev, repeat('0', 64));
  NEW.hash := encode(digest(NEW.prev_hash || audit_event_payload(NEW), 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_event_chain_before_insert
  BEFORE INSERT ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_chain();

-- Walk the chain and report the first row whose hash does not agree with the
-- payload and its predecessor. Returns no rows when the chain is intact.
CREATE FUNCTION verify_audit_chain(p_from bigint DEFAULT 1, p_to bigint DEFAULT NULL)
RETURNS TABLE (seq bigint, id uuid, problem text)
LANGUAGE plpgsql
AS $$
DECLARE
  r          audit_event;
  v_expected text;
  v_prev     text;
BEGIN
  SELECT coalesce(
    (SELECT e.hash FROM audit_event e WHERE e.seq < p_from ORDER BY e.seq DESC LIMIT 1),
    repeat('0', 64))
  INTO v_prev;

  FOR r IN
    SELECT * FROM audit_event e
    WHERE e.seq >= p_from AND (p_to IS NULL OR e.seq <= p_to)
    ORDER BY e.seq
  LOOP
    IF r.prev_hash IS DISTINCT FROM v_prev THEN
      seq := r.seq; id := r.id;
      problem := 'prev_hash does not match the preceding row';
      RETURN NEXT;
    END IF;
    v_expected := encode(digest(r.prev_hash || audit_event_payload(r), 'sha256'), 'hex');
    IF r.hash IS DISTINCT FROM v_expected THEN
      seq := r.seq; id := r.id;
      problem := 'row hash does not match its content';
      RETURN NEXT;
    END IF;
    v_prev := r.hash;
  END LOOP;
END;
$$;
