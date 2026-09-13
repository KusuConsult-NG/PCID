-- 0004 The citizen registry and the PCID itself
-- (master system prompt §2, §48, §49, §50, §51, §52).

-- Every PCID ever allocated, including those whose citizen record was later
-- merged or removed. Nothing in the platform deletes from this table, which is
-- what makes "never recycled" a guarantee rather than an intention (§49).
CREATE TABLE pcid_allocation (
  pcid            text PRIMARY KEY,
  allocated_at    timestamptz NOT NULL DEFAULT now(),
  allocated_by    uuid,
  channel         text NOT NULL,
  CONSTRAINT pcid_allocation_format CHECK (pcid ~ '^PL-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{2}$')
);

CREATE FUNCTION pcid_allocation_is_permanent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'a PCID allocation is permanent; % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER pcid_allocation_no_delete
  BEFORE DELETE ON pcid_allocation
  FOR EACH ROW EXECUTE FUNCTION pcid_allocation_is_permanent();

CREATE TRIGGER pcid_allocation_no_update
  BEFORE UPDATE ON pcid_allocation
  FOR EACH ROW EXECUTE FUNCTION pcid_allocation_is_permanent();

CREATE TRIGGER pcid_allocation_no_truncate
  BEFORE TRUNCATE ON pcid_allocation
  FOR EACH STATEMENT EXECUTE FUNCTION pcid_allocation_is_permanent();

CREATE TABLE citizen (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pcid                    text NOT NULL UNIQUE REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  status                  text NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (status IN
                            ('PENDING_VERIFICATION','ACTIVE','SUSPENDED','DECEASED','MERGED')),
  merged_into_pcid        text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,

  given_name              text NOT NULL,
  middle_name             text,
  family_name             text NOT NULL,
  display_name            text NOT NULL,
  sex                     text NOT NULL CHECK (sex IN ('FEMALE','MALE','UNSPECIFIED')),
  date_of_birth           date NOT NULL,

  phone_primary           text,
  phone_secondary         text,
  email                   text,

  residential_address     text,
  lga_code                text REFERENCES lga (code) ON DELETE RESTRICT,
  ward_code               text REFERENCES ward (code) ON DELETE RESTRICT,
  community_code          text REFERENCES community (code) ON DELETE RESTRICT,

  photograph_uri          text,
  blood_group             text CHECK (blood_group IS NULL OR blood_group IN
                            ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  emergency_medical_notes text,

  -- Optional external identifier only. A PCID is never derived from it and never
  -- requires it (§2, §49).
  nin                     text,
  nin_source_agency_id    uuid REFERENCES agency (id) ON DELETE SET NULL,

  verification_level      text NOT NULL DEFAULT 'SELF_ASSERTED' CHECK (verification_level IN
                            ('SELF_ASSERTED','DOCUMENT_VERIFIED','AGENCY_VERIFIED','BIOMETRIC_VERIFIED')),
  classification          text NOT NULL DEFAULT 'CONFIDENTIAL' CHECK (classification IN
                            ('PUBLIC','INTERNAL','CONFIDENTIAL','SENSITIVE','HIGHLY_RESTRICTED',
                             'LAW_ENFORCEMENT_RESTRICTED')),
  source_agency_id        uuid REFERENCES agency (id) ON DELETE RESTRICT,
  registration_channel    text NOT NULL,

  -- Retention: citizen identity is a long-term government record; the column
  -- records the applicable schedule rather than a hardcoded assumption (§69).
  retention_policy        text NOT NULL DEFAULT 'CITIZEN_IDENTITY_LONG_TERM',

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT citizen_merged_has_target CHECK (status <> 'MERGED' OR merged_into_pcid IS NOT NULL)
);

CREATE INDEX citizen_family_name_trgm ON citizen USING gin (family_name gin_trgm_ops);
CREATE INDEX citizen_given_name_trgm ON citizen USING gin (given_name gin_trgm_ops);
CREATE INDEX citizen_display_name_trgm ON citizen USING gin (display_name gin_trgm_ops);
CREATE INDEX citizen_phone_primary_idx ON citizen (phone_primary) WHERE phone_primary IS NOT NULL;
CREATE INDEX citizen_lga_idx ON citizen (lga_code);
CREATE INDEX citizen_ward_idx ON citizen (ward_code);
CREATE INDEX citizen_status_idx ON citizen (status);
CREATE INDEX citizen_dob_idx ON citizen (date_of_birth);
CREATE UNIQUE INDEX citizen_nin_key ON citizen (nin) WHERE nin IS NOT NULL;

CREATE TABLE emergency_contact (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id            uuid NOT NULL REFERENCES citizen (id) ON DELETE CASCADE,
  full_name             text NOT NULL,
  relationship          text NOT NULL,
  phone_primary         text NOT NULL,
  phone_secondary       text,
  priority              integer NOT NULL DEFAULT 1 CHECK (priority BETWEEN 1 AND 5),
  verification_status   text NOT NULL DEFAULT 'UNVERIFIED'
                          CHECK (verification_status IN ('UNVERIFIED','PENDING','VERIFIED','FAILED')),
  verified_at           timestamptz,
  -- Who last changed this. Government officers must not casually modify a
  -- citizen's emergency contacts (§18), so authorship is always recorded.
  last_changed_by_type  text NOT NULL CHECK (last_changed_by_type IN ('CITIZEN','GOVERNMENT_USER')),
  last_changed_by_id    uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX emergency_contact_citizen_idx ON emergency_contact (citizen_id, priority);

CREATE TABLE registration_request (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             text NOT NULL UNIQUE,
  status                text NOT NULL DEFAULT 'DRAFT' CHECK (status IN
                          ('DRAFT','SUBMITTED','DUPLICATE_REVIEW','APPROVED','REJECTED','ISSUED')),
  channel               text NOT NULL CHECK (channel IN
                          ('CITIZEN_PORTAL','REGISTRATION_DESK','FIELD_ENROLMENT','AGENCY_IMPORT','MDA_API')),
  payload               jsonb NOT NULL,
  submitted_by_user_id  uuid REFERENCES government_user (id) ON DELETE SET NULL,
  submitted_by_agency_id uuid REFERENCES agency (id) ON DELETE SET NULL,
  issued_pcid           text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  rejection_reason      text,
  decided_by_user_id    uuid REFERENCES government_user (id) ON DELETE SET NULL,
  decided_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX registration_request_status_idx ON registration_request (status, created_at DESC);

-- Potential duplicates are queued for human review; records are never silently
-- merged (§51).
CREATE TABLE duplicate_candidate (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_request_id uuid REFERENCES registration_request (id) ON DELETE CASCADE,
  existing_citizen_id     uuid NOT NULL REFERENCES citizen (id) ON DELETE CASCADE,
  candidate_citizen_id    uuid REFERENCES citizen (id) ON DELETE CASCADE,
  score                   numeric(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  -- Which attributes drove the score, so a reviewer can see why (§67).
  matched_attributes      jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                  text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN
                            ('PENDING_REVIEW','CONFIRMED_DUPLICATE','DISTINCT_PERSON','MERGED')),
  reviewed_by_user_id     uuid REFERENCES government_user (id) ON DELETE SET NULL,
  reviewed_at             timestamptz,
  review_note             text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX duplicate_candidate_status_idx ON duplicate_candidate (status, score DESC);
CREATE INDEX duplicate_candidate_existing_idx ON duplicate_candidate (existing_citizen_id);

CREATE TABLE identity_verification (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id          uuid NOT NULL REFERENCES citizen (id) ON DELETE CASCADE,
  level_before        text NOT NULL,
  level_after         text NOT NULL,
  evidence_type       text NOT NULL,
  evidence_reference  text,
  verifying_agency_id uuid REFERENCES agency (id) ON DELETE SET NULL,
  verified_by_user_id uuid REFERENCES government_user (id) ON DELETE SET NULL,
  verified_at         timestamptz NOT NULL DEFAULT now(),
  note                text
);
CREATE INDEX identity_verification_citizen_idx ON identity_verification (citizen_id, verified_at DESC);

CREATE TABLE correction_request (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference           text NOT NULL UNIQUE,
  citizen_id          uuid NOT NULL REFERENCES citizen (id) ON DELETE CASCADE,
  requested_by_type   text NOT NULL CHECK (requested_by_type IN ('CITIZEN','GOVERNMENT_USER')),
  requested_by_id     uuid,
  requesting_agency_id uuid REFERENCES agency (id) ON DELETE SET NULL,
  field_path          text NOT NULL,
  current_value       text,
  requested_value     text NOT NULL,
  justification       text NOT NULL,
  evidence_reference  text,
  status              text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN
                        ('SUBMITTED','EVIDENCE_REQUIRED','UNDER_REVIEW','APPROVED','REJECTED','APPLIED')),
  reviewed_by_user_id uuid REFERENCES government_user (id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  review_note         text,
  applied_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX correction_request_citizen_idx ON correction_request (citizen_id, created_at DESC);
CREATE INDEX correction_request_status_idx ON correction_request (status);

CREATE TRIGGER citizen_set_updated_at BEFORE UPDATE ON citizen
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER emergency_contact_set_updated_at BEFORE UPDATE ON emergency_contact
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER registration_request_set_updated_at BEFORE UPDATE ON registration_request
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER duplicate_candidate_set_updated_at BEFORE UPDATE ON duplicate_candidate
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER correction_request_set_updated_at BEFORE UPDATE ON correction_request
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
