-- 0010 Citizen portal: credentials, verification tokens, and self-service state
-- (master system prompt §17, §39, §40, §57, §58).

-- A resident must change the passphrase issued to them at the registration desk
-- before the account is usable for anything else.
ALTER TABLE citizen_account
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT true;

-- Existing accounts predate the column; they have already been handed over, so
-- they are not retrospectively forced through a change.
UPDATE citizen_account SET must_change_password = false;

-- Which notifications a resident has read, for the portal's in-app inbox.
ALTER TABLE notification
  ADD COLUMN read_at timestamptz;
CREATE INDEX notification_unread_idx
  ON notification (recipient_type, recipient_id)
  WHERE read_at IS NULL;

/*
 * The PCID credential (§40).
 *
 * A credential is the thing a resident carries - a card, or the digital one in
 * the portal. It has its own serial and lifecycle, so a lost card can be revoked
 * and replaced without touching the identity behind it: the PCID is for life, the
 * credential is not.
 */
CREATE TABLE credential (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pcid                text NOT NULL REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  serial              text NOT NULL UNIQUE,
  format              text NOT NULL CHECK (format IN ('DIGITAL', 'PHYSICAL')),
  status              text NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'REPLACED', 'EXPIRED')),
  issued_at           timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz,
  revoked_at          timestamptz,
  revoked_reason      text,
  replaced_by         uuid REFERENCES credential (id) ON DELETE SET NULL,
  issued_by_user_id   uuid REFERENCES government_user (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credential_revoked_has_reason
    CHECK (revoked_at IS NULL OR revoked_reason IS NOT NULL)
);
CREATE INDEX credential_pcid_idx ON credential (pcid, status);

/*
 * Verification tokens are what a credential's QR actually carries (§39, §40).
 *
 * The QR encodes a URL ending in an opaque random token and nothing else - no
 * name, no PCID, no date of birth. Reading the QR therefore discloses nothing at
 * all; resolving it requires an authenticated officer with the verification
 * action, and returns only whether the credential is live and the name printed
 * on it.
 *
 * Only the hash is stored, so a database disclosure does not yield usable
 * tokens. The digital credential in the portal mints a short-lived token on each
 * view, so a screenshot of somebody's screen stops working within minutes.
 */
CREATE TABLE credential_verification_token (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL REFERENCES credential (id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  purpose       text NOT NULL CHECK (purpose IN ('PORTAL_DISPLAY', 'CARD_PRINT')),
  issued_at     timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  single_use    boolean NOT NULL DEFAULT false,
  CONSTRAINT credential_token_window CHECK (expires_at > issued_at),
  -- A token shown on a screen is short-lived by construction, not by convention.
  CONSTRAINT credential_token_display_is_short_lived
    CHECK (purpose <> 'PORTAL_DISPLAY' OR expires_at <= issued_at + interval '15 minutes')
);
CREATE INDEX credential_verification_token_credential_idx
  ON credential_verification_token (credential_id, expires_at DESC);
CREATE INDEX credential_verification_token_expiry_idx
  ON credential_verification_token (expires_at);

-- A resident can report identity fraud and unauthorised access from the portal
-- (§17). These become alerts for an officer to review, described as events rather
-- than as accusations (§31, §65).
ALTER TABLE alert_rule DROP CONSTRAINT alert_rule_kind_check;
ALTER TABLE alert_rule ADD CONSTRAINT alert_rule_kind_check CHECK (kind IN (
  'DUPLICATE_IDENTITY_ATTRIBUTES','REPEATED_FAILED_ADMIN_ACCESS','UNUSUAL_BULK_EXPORT',
  'UNUSUAL_SEARCH_VOLUME','MISSING_PERSON_POTENTIAL_MATCH',
  'INCIDENT_RESPONSE_UNIT_NOTIFICATION','BREAK_GLASS_INITIATED',
  'UNAUTHORISED_ACCESS_ATTEMPT',
  'CITIZEN_REPORTED_IDENTITY_FRAUD','CITIZEN_REPORTED_UNAUTHORISED_ACCESS'));

CREATE TRIGGER credential_set_updated_at BEFORE UPDATE ON credential
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The application may read and write tokens but, as everywhere, may not rewrite
-- the audit trail that records their use.
GRANT SELECT, INSERT, UPDATE, DELETE ON credential, credential_verification_token TO pcid_app;
GRANT SELECT ON credential TO pcid_readonly;
