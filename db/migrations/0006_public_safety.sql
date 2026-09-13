-- 0006 Incidents, dispatch, cases, missing and unidentified persons
-- (master system prompt §8, §9, §11, §12, §13, §21, §36, §37).

CREATE TABLE response_unit (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_code             text NOT NULL UNIQUE,
  agency_id             uuid NOT NULL REFERENCES agency (id) ON DELETE RESTRICT,
  type                  text NOT NULL CHECK (type IN
                          ('POLICE_UNIT','AMBULANCE','FIRE_TRUCK','RESCUE_TEAM','EMERGENCY_VEHICLE','PERSONNEL')),
  status                text NOT NULL DEFAULT 'OFFLINE' CHECK (status IN
                          ('AVAILABLE','DISPATCHED','EN_ROUTE','ON_SCENE','BUSY','OFFLINE')),
  home_lga_code         text REFERENCES lga (code) ON DELETE RESTRICT,
  home_ward_code        text REFERENCES ward (code) ON DELETE RESTRICT,
  -- Operational position of a *unit*, reported by the unit itself. This is not a
  -- citizen location and the platform holds no citizen equivalent (§16).
  latitude              numeric(9,6),
  longitude             numeric(9,6),
  location_reported_at  timestamptz,
  location_source       text CHECK (location_source IS NULL OR location_source IN
                          ('REGISTERED_ADDRESS','INCIDENT_REPORT','CALLER_SUPPLIED',
                           'RESPONDER_OBSERVED','GOVERNMENT_RECORD','REAL_TIME_DEVICE')),
  capabilities          text[] NOT NULL DEFAULT '{}',
  contact_phone         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX response_unit_agency_idx ON response_unit (agency_id);
CREATE INDEX response_unit_status_idx ON response_unit (status);
CREATE INDEX response_unit_lga_idx ON response_unit (home_lga_code);

CREATE TABLE incident (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_number         text NOT NULL UNIQUE,
  type                    text NOT NULL CHECK (type IN
                            ('MEDICAL_EMERGENCY','FIRE','ROAD_ACCIDENT','MISSING_PERSON','DISASTER','FLOOD',
                             'BUILDING_COLLAPSE','SECURITY_INCIDENT','PUBLIC_DISTURBANCE','RESCUE_OPERATION',
                             'UNIDENTIFIED_PERSON','UNIDENTIFIED_DECEASED_PERSON','OTHER')),
  severity                text NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  status                  text NOT NULL DEFAULT 'REPORTED' CHECK (status IN
                            ('REPORTED','VERIFIED','DISPATCHED','ON_SCENE','CONTAINED','RESOLVED','CLOSED','CANCELLED')),
  classification          text NOT NULL DEFAULT 'CONFIDENTIAL',

  description             text NOT NULL,
  address_text            text,
  lga_code                text REFERENCES lga (code) ON DELETE RESTRICT,
  ward_code               text REFERENCES ward (code) ON DELETE RESTRICT,
  latitude                numeric(9,6),
  longitude               numeric(9,6),
  -- Where the coordinates came from. An incident location is an observation
  -- about an event, never a standing record about a person (§16).
  location_source         text NOT NULL DEFAULT 'INCIDENT_REPORT' CHECK (location_source IN
                            ('REGISTERED_ADDRESS','INCIDENT_REPORT','CALLER_SUPPLIED',
                             'RESPONDER_OBSERVED','GOVERNMENT_RECORD','REAL_TIME_DEVICE')),
  location_retention_until timestamptz,

  reporter_type           text NOT NULL CHECK (reporter_type IN ('CITIZEN','GOVERNMENT_USER','AGENCY','ANONYMOUS')),
  reporter_citizen_pcid   text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  reporter_user_id        uuid REFERENCES government_user (id) ON DELETE SET NULL,
  reporter_contact        text,

  lead_agency_id          uuid REFERENCES agency (id) ON DELETE RESTRICT,

  reported_at             timestamptz NOT NULL DEFAULT now(),
  verified_at             timestamptz,
  first_dispatched_at     timestamptz,
  first_arrival_at        timestamptz,
  resolved_at             timestamptz,
  closed_at               timestamptz,
  resolution              text,

  retention_policy        text NOT NULL DEFAULT 'INCIDENT_STANDARD',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incident_status_idx ON incident (status, reported_at DESC);
CREATE INDEX incident_type_idx ON incident (type, reported_at DESC);
CREATE INDEX incident_lga_idx ON incident (lga_code, reported_at DESC);
CREATE INDEX incident_ward_idx ON incident (ward_code, reported_at DESC);
CREATE INDEX incident_lead_agency_idx ON incident (lead_agency_id);
CREATE INDEX incident_reported_at_idx ON incident (reported_at DESC);

CREATE TABLE incident_agency (
  incident_id   uuid NOT NULL REFERENCES incident (id) ON DELETE CASCADE,
  agency_id     uuid NOT NULL REFERENCES agency (id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'RESPONDING',
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (incident_id, agency_id)
);

CREATE TABLE incident_officer (
  incident_id   uuid NOT NULL REFERENCES incident (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES government_user (id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'RESPONDER',
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  assigned_by   uuid REFERENCES government_user (id) ON DELETE SET NULL,
  released_at   timestamptz,
  PRIMARY KEY (incident_id, user_id)
);
CREATE INDEX incident_officer_user_idx ON incident_officer (user_id) WHERE released_at IS NULL;

CREATE TABLE incident_person (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id             uuid NOT NULL REFERENCES incident (id) ON DELETE CASCADE,
  citizen_pcid            text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  unidentified_person_id  uuid,
  role                    text NOT NULL CHECK (role IN
                            ('CASUALTY','WITNESS','REPORTER','RESPONDER','NEXT_OF_KIN','SUBJECT','OTHER')),
  note                    text,
  identified_at           timestamptz,
  identified_by_user_id   uuid REFERENCES government_user (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incident_person_incident_idx ON incident_person (incident_id);
CREATE INDEX incident_person_pcid_idx ON incident_person (citizen_pcid);

CREATE TABLE incident_asset (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id   uuid NOT NULL REFERENCES incident (id) ON DELETE CASCADE,
  asset_type    text NOT NULL CHECK (asset_type IN ('VEHICLE','PROPERTY','BUSINESS')),
  asset_id      uuid NOT NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (incident_id, asset_type, asset_id)
);

CREATE TABLE incident_timeline (
  id            bigserial PRIMARY KEY,
  incident_id   uuid NOT NULL REFERENCES incident (id) ON DELETE CASCADE,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  entry_type    text NOT NULL,
  summary       text NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_type    text NOT NULL,
  actor_id      uuid
);
CREATE INDEX incident_timeline_incident_idx ON incident_timeline (incident_id, occurred_at);

CREATE TABLE dispatch (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id         uuid NOT NULL REFERENCES incident (id) ON DELETE CASCADE,
  response_unit_id    uuid NOT NULL REFERENCES response_unit (id) ON DELETE RESTRICT,
  status              text NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN
                        ('ASSIGNED','ACKNOWLEDGED','EN_ROUTE','ON_SCENE','COMPLETED','STOOD_DOWN')),
  dispatched_by_user_id uuid REFERENCES government_user (id) ON DELETE SET NULL,
  dispatched_at       timestamptz NOT NULL DEFAULT now(),
  acknowledged_at     timestamptz,
  en_route_at         timestamptz,
  arrived_at          timestamptz,
  completed_at        timestamptz,
  stood_down_reason   text,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (incident_id, response_unit_id)
);
CREATE INDEX dispatch_incident_idx ON dispatch (incident_id);
CREATE INDEX dispatch_unit_idx ON dispatch (response_unit_id, dispatched_at DESC);

CREATE TABLE investigation_case (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number         text NOT NULL UNIQUE,
  type                text NOT NULL CHECK (type IN
                        ('CRIMINAL_INVESTIGATION','MISSING_PERSON','FRAUD','IDENTITY_FRAUD',
                         'PUBLIC_SAFETY','EMERGENCY','DISASTER','OTHER')),
  title               text NOT NULL,
  summary             text,
  status              text NOT NULL DEFAULT 'DRAFT' CHECK (status IN
                        ('DRAFT','OPEN','ACTIVE','SUSPENDED','PENDING_REVIEW','CLOSED','ARCHIVED')),
  classification      text NOT NULL DEFAULT 'LAW_ENFORCEMENT_RESTRICTED',
  agency_id           uuid NOT NULL REFERENCES agency (id) ON DELETE RESTRICT,
  lga_code            text REFERENCES lga (code) ON DELETE RESTRICT,
  ward_code           text REFERENCES ward (code) ON DELETE RESTRICT,
  incident_id         uuid REFERENCES incident (id) ON DELETE SET NULL,
  opened_by_user_id   uuid REFERENCES government_user (id) ON DELETE SET NULL,
  closed_by_user_id   uuid REFERENCES government_user (id) ON DELETE SET NULL,
  opened_at           timestamptz NOT NULL DEFAULT now(),
  closed_at           timestamptz,
  closure_note        text,
  retention_policy    text NOT NULL DEFAULT 'SECURITY_CASE_LEGAL',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX investigation_case_status_idx ON investigation_case (status, opened_at DESC);
CREATE INDEX investigation_case_agency_idx ON investigation_case (agency_id);

CREATE TABLE case_assignment (
  case_id       uuid NOT NULL REFERENCES investigation_case (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES government_user (id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'INVESTIGATOR' CHECK (role IN ('INVESTIGATOR','SUPERVISOR','ANALYST','OBSERVER')),
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  assigned_by   uuid REFERENCES government_user (id) ON DELETE SET NULL,
  released_at   timestamptz,
  PRIMARY KEY (case_id, user_id)
);
CREATE INDEX case_assignment_user_idx ON case_assignment (user_id) WHERE released_at IS NULL;

-- The link that opens a citizen record to an investigator (§22). Creating it is
-- itself an audited act.
CREATE TABLE case_subject (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid NOT NULL REFERENCES investigation_case (id) ON DELETE CASCADE,
  subject_type    text NOT NULL CHECK (subject_type IN ('CITIZEN','VEHICLE','PROPERTY','BUSINESS')),
  subject_id      text NOT NULL,
  subject_role    text NOT NULL CHECK (subject_role IN
                    ('SUBJECT_OF_INTEREST','COMPLAINANT','WITNESS','VICTIM','REPORTING_PERSON',
                     'NEXT_OF_KIN','MISSING_PERSON')),
  linked_by_user_id uuid REFERENCES government_user (id) ON DELETE SET NULL,
  linked_at       timestamptz NOT NULL DEFAULT now(),
  unlinked_at     timestamptz,
  justification   text NOT NULL,
  UNIQUE (case_id, subject_type, subject_id)
);
CREATE INDEX case_subject_subject_idx ON case_subject (subject_type, subject_id) WHERE unlinked_at IS NULL;

CREATE TABLE case_note (
  id            bigserial PRIMARY KEY,
  case_id       uuid NOT NULL REFERENCES investigation_case (id) ON DELETE CASCADE,
  author_id     uuid REFERENCES government_user (id) ON DELETE SET NULL,
  body          text NOT NULL,
  classification text NOT NULL DEFAULT 'LAW_ENFORCEMENT_RESTRICTED',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_note_case_idx ON case_note (case_id, created_at DESC);

CREATE TABLE case_document (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             uuid NOT NULL REFERENCES investigation_case (id) ON DELETE CASCADE,
  title               text NOT NULL,
  document_type       text NOT NULL,
  -- Evidence itself is held by the owning agency; the platform stores only the
  -- reference needed to find it (§21).
  external_reference  text NOT NULL,
  custodian_agency_id uuid REFERENCES agency (id) ON DELETE SET NULL,
  classification      text NOT NULL DEFAULT 'LAW_ENFORCEMENT_RESTRICTED',
  added_by_user_id    uuid REFERENCES government_user (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE missing_person (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_reference          text NOT NULL UNIQUE,
  case_id                 uuid REFERENCES investigation_case (id) ON DELETE SET NULL,
  incident_id             uuid REFERENCES incident (id) ON DELETE SET NULL,
  citizen_pcid            text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  full_name               text NOT NULL,
  age_years               integer,
  sex                     text CHECK (sex IS NULL OR sex IN ('FEMALE','MALE','UNSPECIFIED')),
  photograph_uri          text,
  physical_description    text,
  clothing_description    text,
  distinguishing_features text,
  last_seen_address       text,
  last_seen_lga_code      text REFERENCES lga (code) ON DELETE RESTRICT,
  last_seen_ward_code     text REFERENCES ward (code) ON DELETE RESTRICT,
  last_seen_at            timestamptz,
  circumstances           text,
  reporter_name           text,
  reporter_phone          text,
  reporter_relationship   text,
  reporter_citizen_pcid   text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  status                  text NOT NULL DEFAULT 'REPORTED' CHECK (status IN
                            ('REPORTED','VERIFIED','ACTIVE','LOCATED','REUNITED','CLOSED','CANCELLED')),
  classification          text NOT NULL DEFAULT 'SENSITIVE',
  agency_id               uuid REFERENCES agency (id) ON DELETE RESTRICT,
  resolved_at             timestamptz,
  resolution_note         text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX missing_person_status_idx ON missing_person (status, created_at DESC);
CREATE INDEX missing_person_pcid_idx ON missing_person (citizen_pcid);
CREATE INDEX missing_person_name_trgm ON missing_person USING gin (full_name gin_trgm_ops);
CREATE INDEX missing_person_lga_idx ON missing_person (last_seen_lga_code);

CREATE TABLE missing_person_officer (
  missing_person_id uuid NOT NULL REFERENCES missing_person (id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES government_user (id) ON DELETE CASCADE,
  assigned_at       timestamptz NOT NULL DEFAULT now(),
  released_at       timestamptz,
  PRIMARY KEY (missing_person_id, user_id)
);

CREATE TABLE unidentified_person (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             text NOT NULL UNIQUE,
  incident_id           uuid REFERENCES incident (id) ON DELETE SET NULL,
  condition             text NOT NULL DEFAULT 'UNKNOWN' CHECK (condition IN
                          ('CONSCIOUS','UNCONSCIOUS','INJURED','DECEASED','UNKNOWN')),
  status                text NOT NULL DEFAULT 'UNIDENTIFIED' CHECK (status IN
                          ('UNIDENTIFIED','UNDER_REVIEW','PROVISIONALLY_IDENTIFIED','IDENTIFIED','CLOSED')),
  estimated_age_min     integer,
  estimated_age_max     integer,
  apparent_sex          text CHECK (apparent_sex IS NULL OR apparent_sex IN ('FEMALE','MALE','UNSPECIFIED')),
  photograph_uri        text,
  physical_description  text,
  clothing_description  text,
  distinguishing_features text,
  identity_clues        text,
  found_address         text,
  found_lga_code        text REFERENCES lga (code) ON DELETE RESTRICT,
  found_ward_code       text REFERENCES ward (code) ON DELETE RESTRICT,
  found_at              timestamptz NOT NULL DEFAULT now(),
  -- Biometrics are out of scope for this release. The column records that an
  -- authorised agency holds a reference in its own system; the platform stores no
  -- biometric material and performs no biometric matching (§12).
  external_biometric_reference text,
  biometric_custodian_agency_id uuid REFERENCES agency (id) ON DELETE SET NULL,
  classification        text NOT NULL DEFAULT 'SENSITIVE',
  agency_id             uuid REFERENCES agency (id) ON DELETE RESTRICT,
  identified_pcid       text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  identified_at         timestamptz,
  identified_by_user_id uuid REFERENCES government_user (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX unidentified_person_status_idx ON unidentified_person (status, found_at DESC);
CREATE INDEX unidentified_person_lga_idx ON unidentified_person (found_lga_code);

ALTER TABLE incident_person
  ADD CONSTRAINT incident_person_unidentified_fk
  FOREIGN KEY (unidentified_person_id) REFERENCES unidentified_person (id) ON DELETE SET NULL;

-- Candidate matches. The engine may only ever write CANDIDATE; a person is
-- identified by an authorised human decision, never by a score (§13, §66).
CREATE TABLE person_match (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  missing_person_id       uuid NOT NULL REFERENCES missing_person (id) ON DELETE CASCADE,
  unidentified_person_id  uuid REFERENCES unidentified_person (id) ON DELETE CASCADE,
  candidate_citizen_pcid  text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  score                   numeric(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  -- Every contributing factor, with its weight, so "why am I seeing this?" can
  -- always be answered (§67).
  factors                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  engine_version          text NOT NULL,
  status                  text NOT NULL DEFAULT 'CANDIDATE' CHECK (status IN
                            ('CANDIDATE','UNDER_REVIEW','CONFIRMED','REJECTED','SUPERSEDED')),
  reviewed_by_user_id     uuid REFERENCES government_user (id) ON DELETE SET NULL,
  reviewed_at             timestamptz,
  review_note             text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_match_target_present CHECK (
    unidentified_person_id IS NOT NULL OR candidate_citizen_pcid IS NOT NULL
  ),
  CONSTRAINT person_match_confirmation_is_human CHECK (
    status <> 'CONFIRMED' OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE INDEX person_match_missing_idx ON person_match (missing_person_id, score DESC);
CREATE INDEX person_match_unidentified_idx ON person_match (unidentified_person_id);
CREATE INDEX person_match_status_idx ON person_match (status);

CREATE TABLE sighting (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  missing_person_id   uuid NOT NULL REFERENCES missing_person (id) ON DELETE CASCADE,
  reported_at         timestamptz NOT NULL DEFAULT now(),
  sighted_at          timestamptz,
  address_text        text,
  lga_code            text REFERENCES lga (code) ON DELETE RESTRICT,
  ward_code           text REFERENCES ward (code) ON DELETE RESTRICT,
  description         text NOT NULL,
  reporter_name       text,
  reporter_phone      text,
  verification_status text NOT NULL DEFAULT 'UNVERIFIED'
                        CHECK (verification_status IN ('UNVERIFIED','VERIFIED','DISCOUNTED')),
  verified_by_user_id uuid REFERENCES government_user (id) ON DELETE SET NULL,
  verified_at         timestamptz
);
CREATE INDEX sighting_missing_person_idx ON sighting (missing_person_id, reported_at DESC);

CREATE TRIGGER response_unit_set_updated_at BEFORE UPDATE ON response_unit
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER incident_set_updated_at BEFORE UPDATE ON incident
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER dispatch_set_updated_at BEFORE UPDATE ON dispatch
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER investigation_case_set_updated_at BEFORE UPDATE ON investigation_case
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER missing_person_set_updated_at BEFORE UPDATE ON missing_person
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER unidentified_person_set_updated_at BEFORE UPDATE ON unidentified_person
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER person_match_set_updated_at BEFORE UPDATE ON person_match
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
