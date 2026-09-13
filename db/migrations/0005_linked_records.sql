-- 0005 Linked government records and the integration framework
-- (master system prompt §28, §54, §55, §53).
--
-- Every table here holds a *projection* of a record another agency owns. The
-- source columns are mandatory, and the platform never treats itself as the
-- authority: a correction flows back to the source agency, it is not applied here.

CREATE TABLE data_source (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id           uuid NOT NULL REFERENCES agency (id) ON DELETE CASCADE,
  domain              text NOT NULL CHECK (domain IN (
                        'REVENUE','LANDS','PROPERTY','TRANSPORT','VEHICLES','BUSINESS','EDUCATION',
                        'HEALTH','SOCIAL_SERVICES','EMERGENCY_SERVICES','SECURITY','LOCAL_GOVERNMENT')),
  system_name         text NOT NULL,
  adapter_key         text NOT NULL,
  mode                text NOT NULL DEFAULT 'DISABLED' CHECK (mode IN ('PRODUCTION','SANDBOX','DISABLED')),
  base_url            text,
  config              jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_healthy_at     timestamptz,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, domain, system_name)
);

CREATE TABLE data_sync_job (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id      uuid NOT NULL REFERENCES data_source (id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN
                        ('SCHEDULED','RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED')),
  started_at          timestamptz,
  finished_at         timestamptz,
  records_examined    integer NOT NULL DEFAULT 0,
  records_written     integer NOT NULL DEFAULT 0,
  records_conflicted  integer NOT NULL DEFAULT 0,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX data_sync_job_source_idx ON data_sync_job (data_source_id, created_at DESC);

-- Where the platform's projection and the source disagree. Never auto-resolved
-- in favour of the platform (§55).
CREATE TABLE data_conflict (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id      uuid NOT NULL REFERENCES data_source (id) ON DELETE CASCADE,
  resource_type       text NOT NULL,
  resource_id         text NOT NULL,
  field_path          text NOT NULL,
  platform_value      text,
  source_value        text,
  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN
                        ('OPEN','UNDER_REVIEW','RESOLVED_SOURCE_WINS','RESOLVED_PLATFORM_CORRECTED',
                         'RESOLVED_NO_ACTION')),
  detected_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  resolved_by_user_id uuid REFERENCES government_user (id) ON DELETE SET NULL,
  resolution_note     text
);
CREATE INDEX data_conflict_status_idx ON data_conflict (status, detected_at DESC);

CREATE TABLE property (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id               text NOT NULL,
  address                   text NOT NULL,
  lga_code                  text REFERENCES lga (code) ON DELETE RESTRICT,
  ward_code                 text REFERENCES ward (code) ON DELETE RESTRICT,
  use_type                  text NOT NULL DEFAULT 'RESIDENTIAL',
  latitude                  numeric(9,6),
  longitude                 numeric(9,6),
  location_source           text CHECK (location_source IS NULL OR location_source IN
                              ('REGISTERED_ADDRESS','INCIDENT_REPORT','CALLER_SUPPLIED',
                               'RESPONDER_OBSERVED','GOVERNMENT_RECORD','REAL_TIME_DEVICE')),
  emergency_access_notes    text,
  occupant_count_estimate   integer,
  owner_pcid                text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  owner_name                text,
  classification            text NOT NULL DEFAULT 'CONFIDENTIAL',
  source_agency_id          uuid NOT NULL REFERENCES agency (id) ON DELETE RESTRICT,
  source_system             text NOT NULL,
  source_record_id          text NOT NULL,
  source_updated_at         timestamptz,
  last_synced_at            timestamptz NOT NULL DEFAULT now(),
  verification_status       text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN
                              ('UNVERIFIED','SOURCE_CONFIRMED','STALE','CONFLICTED')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_agency_id, source_system, source_record_id)
);
CREATE INDEX property_owner_pcid_idx ON property (owner_pcid);
CREATE INDEX property_property_id_idx ON property (property_id);
CREATE INDEX property_lga_idx ON property (lga_code);

CREATE TABLE vehicle (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_number   text NOT NULL,
  make                  text,
  model                 text,
  colour                text,
  registration_status   text NOT NULL DEFAULT 'UNKNOWN',
  -- Stolen/wanted markers carry the law-enforcement compartment (§14, §27).
  alert_status          text,
  alert_reference       text,
  owner_pcid            text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  owner_name            text,
  owner_contact         text,
  classification        text NOT NULL DEFAULT 'CONFIDENTIAL',
  source_agency_id      uuid NOT NULL REFERENCES agency (id) ON DELETE RESTRICT,
  source_system         text NOT NULL,
  source_record_id      text NOT NULL,
  source_updated_at     timestamptz,
  last_synced_at        timestamptz NOT NULL DEFAULT now(),
  verification_status   text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN
                          ('UNVERIFIED','SOURCE_CONFIRMED','STALE','CONFLICTED')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_agency_id, source_system, source_record_id)
);
CREATE UNIQUE INDEX vehicle_registration_number_key ON vehicle (upper(registration_number));
CREATE INDEX vehicle_owner_pcid_idx ON vehicle (owner_pcid);

CREATE TABLE business (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         text NOT NULL,
  name                text NOT NULL,
  status              text NOT NULL DEFAULT 'UNKNOWN',
  address             text,
  lga_code            text REFERENCES lga (code) ON DELETE RESTRICT,
  proprietor_pcid     text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  classification      text NOT NULL DEFAULT 'INTERNAL',
  source_agency_id    uuid NOT NULL REFERENCES agency (id) ON DELETE RESTRICT,
  source_system       text NOT NULL,
  source_record_id    text NOT NULL,
  source_updated_at   timestamptz,
  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  verification_status text NOT NULL DEFAULT 'UNVERIFIED',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_agency_id, source_system, source_record_id)
);
CREATE INDEX business_proprietor_idx ON business (proprietor_pcid);
CREATE INDEX business_business_id_idx ON business (business_id);

CREATE TABLE licence (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  licence_id          text NOT NULL,
  type                text NOT NULL,
  status              text NOT NULL DEFAULT 'UNKNOWN',
  valid_from          date,
  valid_to            date,
  holder_pcid         text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  classification      text NOT NULL DEFAULT 'INTERNAL',
  source_agency_id    uuid NOT NULL REFERENCES agency (id) ON DELETE RESTRICT,
  source_system       text NOT NULL,
  source_record_id    text NOT NULL,
  source_updated_at   timestamptz,
  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  verification_status text NOT NULL DEFAULT 'UNVERIFIED',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_agency_id, source_system, source_record_id)
);
CREATE INDEX licence_holder_idx ON licence (holder_pcid);
CREATE INDEX licence_licence_id_idx ON licence (licence_id);

CREATE TABLE revenue_profile (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id                 text NOT NULL,
  citizen_pcid                text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  compliance_status           text NOT NULL DEFAULT 'UNKNOWN',
  outstanding_balance_minor   bigint NOT NULL DEFAULT 0,
  classification              text NOT NULL DEFAULT 'SENSITIVE',
  source_agency_id            uuid NOT NULL REFERENCES agency (id) ON DELETE RESTRICT,
  source_system               text NOT NULL,
  source_record_id            text NOT NULL,
  source_updated_at           timestamptz,
  last_synced_at              timestamptz NOT NULL DEFAULT now(),
  verification_status         text NOT NULL DEFAULT 'UNVERIFIED',
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_agency_id, source_system, source_record_id)
);
CREATE INDEX revenue_profile_citizen_idx ON revenue_profile (citizen_pcid);

CREATE TABLE government_programme (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_code      text NOT NULL,
  name                text NOT NULL,
  agency_id           uuid NOT NULL REFERENCES agency (id) ON DELETE RESTRICT,
  description         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, programme_code)
);

CREATE TABLE programme_enrolment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id        uuid NOT NULL REFERENCES government_programme (id) ON DELETE CASCADE,
  citizen_pcid        text NOT NULL REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  status              text NOT NULL DEFAULT 'ENROLLED',
  enrolled_at         timestamptz NOT NULL DEFAULT now(),
  classification      text NOT NULL DEFAULT 'CONFIDENTIAL',
  source_agency_id    uuid NOT NULL REFERENCES agency (id) ON DELETE RESTRICT,
  source_system       text NOT NULL,
  source_record_id    text NOT NULL,
  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_agency_id, source_system, source_record_id)
);
CREATE INDEX programme_enrolment_citizen_idx ON programme_enrolment (citizen_pcid);

-- Explicit relationship graph (§30). Edges are materialised so the graph can be
-- traversed under authorisation rather than inferred from joins at request time.
CREATE TABLE relationship (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_type           text NOT NULL,
  from_id             text NOT NULL,
  relation            text NOT NULL,
  to_type             text NOT NULL,
  to_id               text NOT NULL,
  classification      text NOT NULL DEFAULT 'CONFIDENTIAL',
  source_agency_id    uuid REFERENCES agency (id) ON DELETE SET NULL,
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_type, from_id, relation, to_type, to_id)
);
CREATE INDEX relationship_from_idx ON relationship (from_type, from_id) WHERE valid_to IS NULL;
CREATE INDEX relationship_to_idx ON relationship (to_type, to_id) WHERE valid_to IS NULL;

CREATE TABLE import_job (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             text NOT NULL UNIQUE,
  agency_id             uuid NOT NULL REFERENCES agency (id) ON DELETE RESTRICT,
  uploaded_by_user_id   uuid REFERENCES government_user (id) ON DELETE SET NULL,
  file_name             text NOT NULL,
  file_checksum         text NOT NULL,
  record_count          integer NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'UPLOADED' CHECK (status IN
                          ('UPLOADED','VALIDATING','VALIDATION_FAILED','PREVIEW_READY','AWAITING_APPROVAL',
                           'IMPORTING','COMPLETED','FAILED','CANCELLED')),
  validation_report     jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by_user_id   uuid REFERENCES government_user (id) ON DELETE SET NULL,
  approved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER data_source_set_updated_at BEFORE UPDATE ON data_source
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER property_set_updated_at BEFORE UPDATE ON property
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER vehicle_set_updated_at BEFORE UPDATE ON vehicle
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER business_set_updated_at BEFORE UPDATE ON business
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER licence_set_updated_at BEFORE UPDATE ON licence
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER revenue_profile_set_updated_at BEFORE UPDATE ON revenue_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER government_programme_set_updated_at BEFORE UPDATE ON government_programme
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER import_job_set_updated_at BEFORE UPDATE ON import_job
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
