-- 0007 Access requests, break glass, alerts and notifications
-- (master system prompt §23, §24, §31, §32, §33).

CREATE TABLE access_request (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             text NOT NULL UNIQUE,
  requested_by_user_id  uuid NOT NULL REFERENCES government_user (id) ON DELETE CASCADE,
  agency_id             uuid NOT NULL REFERENCES agency (id) ON DELETE RESTRICT,
  purpose               text NOT NULL,
  resource_type         text NOT NULL,
  subject_pcid          text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  resource_id           text,
  case_id               uuid REFERENCES investigation_case (id) ON DELETE SET NULL,
  incident_id           uuid REFERENCES incident (id) ON DELETE SET NULL,
  requested_fields      text[] NOT NULL,
  justification         text NOT NULL,
  status                text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN
                          ('SUBMITTED','AUTO_DENIED','PENDING_APPROVAL','APPROVED','DENIED','EXPIRED','REVOKED')),
  -- The policy evaluation performed at submission, kept verbatim so an approver
  -- sees exactly what the engine said (§24).
  policy_evaluation     jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_fields       text[] NOT NULL DEFAULT '{}',
  decided_by_user_id    uuid REFERENCES government_user (id) ON DELETE SET NULL,
  decided_at            timestamptz,
  decision_note         text,
  expires_at            timestamptz,
  revoked_at            timestamptz,
  revoked_by_user_id    uuid REFERENCES government_user (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Nobody approves their own request (§24, separation of duty).
  CONSTRAINT access_request_no_self_approval
    CHECK (decided_by_user_id IS NULL OR decided_by_user_id <> requested_by_user_id),
  CONSTRAINT access_request_approved_has_expiry
    CHECK (status <> 'APPROVED' OR expires_at IS NOT NULL)
);
CREATE INDEX access_request_requester_idx ON access_request (requested_by_user_id, created_at DESC);
CREATE INDEX access_request_status_idx ON access_request (status, created_at DESC);
CREATE INDEX access_request_subject_idx ON access_request (subject_pcid);

CREATE TABLE break_glass_grant (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             text NOT NULL UNIQUE,
  user_id               uuid NOT NULL REFERENCES government_user (id) ON DELETE CASCADE,
  agency_id             uuid NOT NULL REFERENCES agency (id) ON DELETE RESTRICT,
  incident_id           uuid REFERENCES incident (id) ON DELETE SET NULL,
  case_id               uuid REFERENCES investigation_case (id) ON DELETE SET NULL,
  resource_type         text NOT NULL,
  subject_pcid          text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  gates                 text[] NOT NULL,
  reason                text NOT NULL,
  status                text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN
                          ('ACTIVE','EXPIRED','REVOKED','REVIEWED_JUSTIFIED','REVIEWED_UNJUSTIFIED')),
  granted_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  revoked_at            timestamptz,
  revoked_by_user_id    uuid REFERENCES government_user (id) ON DELETE SET NULL,
  -- Post-event review is mandatory, so the due date is part of the record (§23).
  review_due_at         timestamptz NOT NULL,
  reviewed_by_user_id   uuid REFERENCES government_user (id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  review_note           text,
  access_count          integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- A grant is temporary by construction: the database refuses a window beyond
  -- the platform ceiling of one hour.
  CONSTRAINT break_glass_grant_bounded
    CHECK (expires_at > granted_at AND expires_at <= granted_at + interval '1 hour'),
  CONSTRAINT break_glass_gates_known
    CHECK (gates <@ ARRAY['JURISDICTION','CASE_BINDING','INCIDENT_BINDING','FIELD_APPROVAL']::text[]),
  CONSTRAINT break_glass_gates_present CHECK (cardinality(gates) > 0)
);
CREATE INDEX break_glass_user_idx ON break_glass_grant (user_id, granted_at DESC);
CREATE INDEX break_glass_status_idx ON break_glass_grant (status, review_due_at);
CREATE INDEX break_glass_subject_idx ON break_glass_grant (subject_pcid);

CREATE TABLE alert_rule (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                 text NOT NULL UNIQUE,
  kind                text NOT NULL CHECK (kind IN
                        ('DUPLICATE_IDENTITY_ATTRIBUTES','REPEATED_FAILED_ADMIN_ACCESS','UNUSUAL_BULK_EXPORT',
                         'UNUSUAL_SEARCH_VOLUME','MISSING_PERSON_POTENTIAL_MATCH',
                         'INCIDENT_RESPONSE_UNIT_NOTIFICATION','BREAK_GLASS_INITIATED',
                         'UNAUTHORISED_ACCESS_ATTEMPT')),
  name                text NOT NULL,
  description         text NOT NULL,
  category            text NOT NULL CHECK (category IN
                        ('IDENTITY_INTEGRITY','SECURITY','DATA_SECURITY','POTENTIAL_MATCH',
                         'EMERGENCY_DISPATCH','OPERATIONAL')),
  severity            text NOT NULL CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),
  enabled             boolean NOT NULL DEFAULT true,
  -- Thresholds and windows are configuration an authorised administrator edits (§32).
  parameters          jsonb NOT NULL DEFAULT '{}'::jsonb,
  notify_roles        text[] NOT NULL DEFAULT '{}',
  notify_channels     text[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference           text NOT NULL UNIQUE,
  rule_id             uuid REFERENCES alert_rule (id) ON DELETE SET NULL,
  rule_key            text NOT NULL,
  category            text NOT NULL,
  severity            text NOT NULL,
  -- Titles describe records and events, never people (§31, §65).
  title               text NOT NULL,
  summary             text NOT NULL,
  -- Why the alert fired, with the factors considered and the confidence, so the
  -- "why am I seeing this?" question is always answerable (§67).
  explanation         jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence          numeric(5,2),
  engine_version      text,
  subject_type        text,
  subject_id          text,
  subject_pcid        text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  agency_id           uuid REFERENCES agency (id) ON DELETE SET NULL,
  classification      text NOT NULL DEFAULT 'SENSITIVE',
  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN
                        ('OPEN','UNDER_REVIEW','ACTIONED','DISMISSED_FALSE_POSITIVE','CLOSED')),
  assigned_to_user_id uuid REFERENCES government_user (id) ON DELETE SET NULL,
  reviewed_by_user_id uuid REFERENCES government_user (id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  review_note         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_status_idx ON alert (status, severity, created_at DESC);
CREATE INDEX alert_rule_key_idx ON alert (rule_key, created_at DESC);
CREATE INDEX alert_subject_pcid_idx ON alert (subject_pcid);

CREATE TABLE notification (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel             text NOT NULL CHECK (channel IN ('SMS','EMAIL','PUSH','IN_APP','DASHBOARD')),
  recipient_type      text NOT NULL CHECK (recipient_type IN ('GOVERNMENT_USER','CITIZEN','AGENCY','RESPONSE_UNIT')),
  recipient_id        text NOT NULL,
  recipient_address   text,
  subject             text,
  body                text NOT NULL,
  alert_id            uuid REFERENCES alert (id) ON DELETE SET NULL,
  incident_id         uuid REFERENCES incident (id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'QUEUED' CHECK (status IN
                        ('QUEUED','SENDING','SENT','DELIVERED','FAILED','SUPPRESSED')),
  attempts            integer NOT NULL DEFAULT 0,
  last_error          text,
  classification      text NOT NULL DEFAULT 'INTERNAL',
  queued_at           timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_status_idx ON notification (status, queued_at);
CREATE INDEX notification_recipient_idx ON notification (recipient_type, recipient_id, queued_at DESC);

-- Counters backing search-abuse detection (§63). Holds counts only, never the
-- search terms themselves.
CREATE TABLE sensitive_action_counter (
  user_id       uuid NOT NULL REFERENCES government_user (id) ON DELETE CASCADE,
  action        text NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, action, window_start)
);
CREATE INDEX sensitive_action_counter_window_idx ON sensitive_action_counter (window_start);

CREATE TRIGGER access_request_set_updated_at BEFORE UPDATE ON access_request
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER break_glass_grant_set_updated_at BEFORE UPDATE ON break_glass_grant
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER alert_rule_set_updated_at BEFORE UPDATE ON alert_rule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER alert_set_updated_at BEFORE UPDATE ON alert
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER notification_set_updated_at BEFORE UPDATE ON notification
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
