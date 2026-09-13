-- 0002 Government Agency Registry, roles, users and sessions
-- (master system prompt §5, §6, §7, §41, §42).

CREATE TABLE agency (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                      text NOT NULL UNIQUE,
  name                      text NOT NULL,
  category                  text NOT NULL CHECK (category IN (
                              'MDA','SECURITY','EMERGENCY','HEALTH','JUSTICE','REVENUE','TRANSPORT',
                              'LANDS','EDUCATION','SOCIAL_SERVICES','LOCAL_GOVERNMENT','OTHER')),
  status                    text NOT NULL DEFAULT 'INACTIVE'
                              CHECK (status IN ('ACTIVE','SUSPENDED','INACTIVE')),
  jurisdiction_scope        text NOT NULL DEFAULT 'STATE'
                              CHECK (jurisdiction_scope IN ('STATE','LGA','WARD')),
  jurisdiction_lga_codes    text[] NOT NULL DEFAULT '{}',
  jurisdiction_ward_codes   text[] NOT NULL DEFAULT '{}',
  -- Highest classification this agency is approved to receive (§27).
  max_classification        text NOT NULL DEFAULT 'INTERNAL' CHECK (max_classification IN (
                              'PUBLIC','INTERNAL','CONFIDENTIAL','SENSITIVE','HIGHLY_RESTRICTED',
                              'LAW_ENFORCEMENT_RESTRICTED')),
  data_sharing_agreement    text NOT NULL DEFAULT 'NONE' CHECK (data_sharing_agreement IN (
                              'SIGNED','PENDING','EXPIRED','SUSPENDED','NONE')),
  data_sharing_expires_at   timestamptz,
  api_integration_status    text NOT NULL DEFAULT 'NOT_INTEGRATED' CHECK (api_integration_status IN (
                              'NOT_INTEGRATED','SANDBOX','CERTIFYING','LIVE','SUSPENDED')),
  contact_email             text,
  contact_phone             text,
  contact_address           text,
  data_protection_officer   text,
  administrator_name        text,
  authorized_services       text[] NOT NULL DEFAULT '{}',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agency_category_idx ON agency (category);
CREATE INDEX agency_status_idx ON agency (status);

-- Compartment markings an agency holds. Held as data so that no agency name ever
-- appears in authorisation logic (§5).
CREATE TABLE agency_compartment_grant (
  agency_id       uuid NOT NULL REFERENCES agency (id) ON DELETE CASCADE,
  compartment     text NOT NULL CHECK (compartment IN ('LAW_ENFORCEMENT_RESTRICTED')),
  granted_at      timestamptz NOT NULL DEFAULT now(),
  granted_by      uuid,
  legal_basis     text NOT NULL,
  PRIMARY KEY (agency_id, compartment)
);

CREATE TABLE department (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id       uuid NOT NULL REFERENCES agency (id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, code)
);

CREATE TABLE role (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,
  description     text NOT NULL,
  -- A technical role confers administration, never entitlement to citizen data (§7).
  technical_only  boolean NOT NULL DEFAULT false,
  system_managed  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_action (
  role_id         uuid NOT NULL REFERENCES role (id) ON DELETE CASCADE,
  action          text NOT NULL,
  PRIMARY KEY (role_id, action)
);

CREATE TABLE government_user (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id               uuid NOT NULL REFERENCES agency (id) ON DELETE RESTRICT,
  department_id           uuid REFERENCES department (id) ON DELETE SET NULL,
  email                   text NOT NULL,
  full_name               text NOT NULL,
  service_number          text,
  phone                   text,
  status                  text NOT NULL DEFAULT 'ACTIVE'
                            CHECK (status IN ('ACTIVE','SUSPENDED','LOCKED','DISABLED')),
  -- Password material. The algorithm and its parameters travel with the hash so
  -- that a future parameter increase can be rolled out per-user on next login.
  password_hash           text NOT NULL,
  password_algorithm      text NOT NULL,
  password_params         jsonb NOT NULL,
  password_updated_at     timestamptz NOT NULL DEFAULT now(),
  must_change_password    boolean NOT NULL DEFAULT true,
  mfa_enrolled            boolean NOT NULL DEFAULT false,
  clearance               text NOT NULL DEFAULT 'INTERNAL' CHECK (clearance IN (
                            'PUBLIC','INTERNAL','CONFIDENTIAL','SENSITIVE','HIGHLY_RESTRICTED',
                            'LAW_ENFORCEMENT_RESTRICTED')),
  jurisdiction_scope      text NOT NULL DEFAULT 'STATE'
                            CHECK (jurisdiction_scope IN ('STATE','LGA','WARD')),
  jurisdiction_lga_codes  text[] NOT NULL DEFAULT '{}',
  jurisdiction_ward_codes text[] NOT NULL DEFAULT '{}',
  access_window           jsonb,
  failed_login_count      integer NOT NULL DEFAULT 0,
  locked_until            timestamptz,
  last_login_at           timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX government_user_email_key ON government_user (lower(email));
CREATE INDEX government_user_agency_idx ON government_user (agency_id);
CREATE INDEX government_user_status_idx ON government_user (status);

CREATE TABLE user_role (
  user_id     uuid NOT NULL REFERENCES government_user (id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES role (id) ON DELETE RESTRICT,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid REFERENCES government_user (id) ON DELETE SET NULL,
  expires_at  timestamptz,
  PRIMARY KEY (user_id, role_id)
);

-- Multi-factor credentials. TOTP secrets are stored encrypted by the application;
-- the column holds ciphertext and never a usable secret.
CREATE TABLE mfa_credential (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES government_user (id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('TOTP','RECOVERY_CODE')),
  secret_ciphertext text NOT NULL,
  label             text,
  confirmed_at      timestamptz,
  last_used_at      timestamptz,
  last_used_counter bigint,
  consumed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_credential_user_idx ON mfa_credential (user_id, kind);

CREATE TABLE citizen_account (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pcid                  text NOT NULL,
  email                 text,
  phone                 text,
  status                text NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE','SUSPENDED','LOCKED','DISABLED')),
  password_hash         text NOT NULL,
  password_algorithm    text NOT NULL,
  password_params       jsonb NOT NULL,
  password_updated_at   timestamptz NOT NULL DEFAULT now(),
  mfa_enrolled          boolean NOT NULL DEFAULT false,
  failed_login_count    integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX citizen_account_pcid_key ON citizen_account (pcid);
CREATE UNIQUE INDEX citizen_account_email_key ON citizen_account (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE citizen_mfa_credential (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES citizen_account (id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('TOTP','RECOVERY_CODE')),
  secret_ciphertext text NOT NULL,
  confirmed_at      timestamptz,
  last_used_at      timestamptz,
  last_used_counter bigint,
  consumed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX citizen_mfa_credential_account_idx ON citizen_mfa_credential (account_id, kind);

-- Sessions. Only the hash of a refresh token is stored, so a database disclosure
-- does not yield usable sessions. Rotation is recorded via replaced_by (§42).
CREATE TABLE user_session (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type            text NOT NULL CHECK (actor_type IN ('GOVERNMENT_USER','CITIZEN')),
  government_user_id    uuid REFERENCES government_user (id) ON DELETE CASCADE,
  citizen_account_id    uuid REFERENCES citizen_account (id) ON DELETE CASCADE,
  refresh_token_hash    text NOT NULL UNIQUE,
  authentication_level  text NOT NULL DEFAULT 'AAL1' CHECK (authentication_level IN ('AAL1','AAL2')),
  aal2_expires_at       timestamptz,
  issued_at             timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  revoked_at            timestamptz,
  revoked_reason        text,
  replaced_by           uuid REFERENCES user_session (id) ON DELETE SET NULL,
  ip_address            inet,
  user_agent            text,
  device_fingerprint    text,
  CONSTRAINT user_session_actor_present CHECK (
    (actor_type = 'GOVERNMENT_USER' AND government_user_id IS NOT NULL AND citizen_account_id IS NULL)
    OR (actor_type = 'CITIZEN' AND citizen_account_id IS NOT NULL AND government_user_id IS NULL)
  )
);
CREATE INDEX user_session_government_user_idx ON user_session (government_user_id) WHERE revoked_at IS NULL;
CREATE INDEX user_session_citizen_idx ON user_session (citizen_account_id) WHERE revoked_at IS NULL;
CREATE INDEX user_session_expiry_idx ON user_session (expires_at);

-- Brute-force and suspicious-login detection (§42).
CREATE TABLE login_attempt (
  id            bigserial PRIMARY KEY,
  identifier    text NOT NULL,
  actor_type    text NOT NULL CHECK (actor_type IN ('GOVERNMENT_USER','CITIZEN')),
  succeeded     boolean NOT NULL,
  failure_code  text,
  ip_address    inet,
  user_agent    text,
  attempted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempt_identifier_idx ON login_attempt (lower(identifier), attempted_at DESC);
CREATE INDEX login_attempt_ip_idx ON login_attempt (ip_address, attempted_at DESC);

-- API clients for MDA and agency system integration, authenticated at the gateway (§45).
CREATE TABLE api_client (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id             uuid NOT NULL REFERENCES agency (id) ON DELETE CASCADE,
  name                  text NOT NULL,
  client_id             text NOT NULL UNIQUE,
  secret_hash           text NOT NULL,
  secret_algorithm      text NOT NULL,
  secret_params         jsonb NOT NULL,
  scopes                text[] NOT NULL DEFAULT '{}',
  status                text NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  rate_limit_per_minute integer NOT NULL DEFAULT 120,
  allowed_ip_ranges     text[] NOT NULL DEFAULT '{}',
  last_used_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER agency_set_updated_at BEFORE UPDATE ON agency
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER department_set_updated_at BEFORE UPDATE ON department
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER role_set_updated_at BEFORE UPDATE ON role
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER government_user_set_updated_at BEFORE UPDATE ON government_user
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER citizen_account_set_updated_at BEFORE UPDATE ON citizen_account
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER api_client_set_updated_at BEFORE UPDATE ON api_client
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
