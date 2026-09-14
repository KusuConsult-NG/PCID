-- 0015 Registered devices, and the controlled offline mode
-- (master system prompt §56, §42, §63).
--
-- Until now a device was a string: `device_fingerprint` on a session and on an
-- audit row, recorded but never registered, never bound to anything and
-- impossible to revoke. That is adequate while every read happens online and
-- nothing is retained. It is not adequate for a responder who has to read a
-- casualty's blood group in a place with no signal, because retaining that means
-- deciding which device may hold it, for how long, and how to take it back.

CREATE TABLE registered_device (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type          text NOT NULL CHECK (actor_type IN ('GOVERNMENT_USER','CITIZEN')),
  government_user_id  uuid REFERENCES government_user (id) ON DELETE CASCADE,
  citizen_account_id  uuid REFERENCES citizen_account (id) ON DELETE CASCADE,

  -- The device presents a secret; the platform stores only its hash, for the
  -- same reason it stores only a hash of a refresh token. A database that leaks
  -- must not hand somebody a working device identity.
  device_token_hash   text NOT NULL UNIQUE,
  label               text NOT NULL,
  platform            text NOT NULL CHECK (platform IN ('ANDROID','IOS','DESKTOP','OTHER')),
  user_agent          text,

  registered_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz,
  revoked_reason      text CHECK (revoked_reason IS NULL OR revoked_reason IN
                        ('USER_REQUEST','LOST_OR_STOLEN','ADMINISTRATIVE','ACCOUNT_CLOSED')),
  revoked_by_user_id  uuid REFERENCES government_user (id) ON DELETE SET NULL,

  -- Exactly one owner, the same shape as user_session. A device belongs to a
  -- person, never to an agency: revoking an account takes its devices with it.
  CONSTRAINT registered_device_owner_present CHECK (
    (actor_type = 'GOVERNMENT_USER' AND government_user_id IS NOT NULL AND citizen_account_id IS NULL)
    OR (actor_type = 'CITIZEN' AND citizen_account_id IS NOT NULL AND government_user_id IS NULL)
  ),
  CONSTRAINT registered_device_revocation_complete CHECK (
    (revoked_at IS NULL AND revoked_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL)
  )
);
CREATE INDEX registered_device_user_idx ON registered_device (government_user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX registered_device_citizen_idx ON registered_device (citizen_account_id)
  WHERE revoked_at IS NULL;

-- Every bundle that left the platform, and what it contained.
--
-- Not the bundle itself: the contents are never stored here, only the shape of
-- them. What an oversight review needs is that a release happened, to which
-- device, covering how many people, under which incident, expiring when - and
-- the audit event that carries the decision behind it. Storing the payload would
-- put the same personal data in a second place with a second retention rule,
-- which is the thing §56 exists to avoid.
CREATE TABLE offline_release (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id         uuid NOT NULL REFERENCES registered_device (id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('CITIZEN_CARD','INCIDENT_PROFILES')),
  incident_id       uuid REFERENCES incident (id) ON DELETE CASCADE,
  subject_pcid      text REFERENCES pcid_allocation (pcid) ON DELETE RESTRICT,
  record_count      integer NOT NULL CHECK (record_count >= 0 AND record_count <= 50),
  audit_event_id    uuid,
  released_at       timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  invalidated_at    timestamptz,

  -- Bounded in the schema, not only in the code that writes it. A day is the
  -- ceiling for anything; the service applies four hours to an incident pack.
  CONSTRAINT offline_release_bounded CHECK (
    expires_at > released_at AND expires_at <= released_at + interval '24 hours'
  ),
  -- An incident pack names its incident; a citizen card names its holder.
  -- Neither may be anonymous, because a release nobody can attribute is a
  -- release nobody can review.
  CONSTRAINT offline_release_subject_present CHECK (
    (kind = 'INCIDENT_PROFILES' AND incident_id IS NOT NULL)
    OR (kind = 'CITIZEN_CARD' AND subject_pcid IS NOT NULL AND incident_id IS NULL)
  )
);
CREATE INDEX offline_release_device_idx ON offline_release (device_id, released_at DESC);
CREATE INDEX offline_release_incident_idx ON offline_release (incident_id)
  WHERE incident_id IS NOT NULL;
CREATE INDEX offline_release_live_idx ON offline_release (expires_at)
  WHERE invalidated_at IS NULL;

-- Revoking a device invalidates what it was holding, in the same statement.
--
-- The client erases its copy when it next reaches the network, and until then it
-- holds ciphertext that expires on its own. This row is what makes the platform
-- able to say, afterwards, exactly when the authority to hold it ended - which is
-- the question an investigation into a lost phone actually asks.
CREATE FUNCTION invalidate_offline_releases_on_revocation()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY DEFINER because `pcid_app` is granted INSERT and SELECT on
-- offline_release and nothing else: the record of what left the platform is
-- append-only to the application, and only this trigger closes a row.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    UPDATE offline_release
       SET invalidated_at = NEW.revoked_at
     WHERE device_id = NEW.id AND invalidated_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER registered_device_revocation_invalidates
  AFTER UPDATE ON registered_device
  FOR EACH ROW EXECUTE FUNCTION invalidate_offline_releases_on_revocation();

-- A session may name the device it was opened on, so that revoking the device
-- and ending its sessions is one act rather than two that can be done by halves.
ALTER TABLE user_session ADD COLUMN registered_device_id uuid
  REFERENCES registered_device (id) ON DELETE SET NULL;
CREATE INDEX user_session_device_idx ON user_session (registered_device_id)
  WHERE revoked_at IS NULL AND registered_device_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcid_app') THEN
    GRANT SELECT, INSERT, UPDATE ON registered_device TO pcid_app;
    -- Append-only in intent and in privilege, except for the invalidation the
    -- revocation trigger performs as the table's owner.
    GRANT SELECT, INSERT ON offline_release TO pcid_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcid_readonly') THEN
    GRANT SELECT ON registered_device, offline_release TO pcid_readonly;
  END IF;
END;
$$;
