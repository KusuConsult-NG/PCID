-- 0008 Database roles and privileges (master system prompt §44).
--
-- The application connects as `pcid_app`, which is deliberately NOT the owner of
-- any object. It cannot drop the audit triggers, alter the schema, or delete an
-- audit row or a PCID allocation. Migrations run as the owner, from a separate
-- credential used only by the migration job.
--
-- Nothing else - no portal, no MDA system, no security application, no analyst -
-- ever receives a database credential; they reach data only through the API.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcid_app') THEN
    CREATE ROLE pcid_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcid_readonly') THEN
    CREATE ROLE pcid_readonly NOLOGIN;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO pcid_app, pcid_readonly;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pcid_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pcid_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO pcid_app;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO pcid_readonly;

-- History is append-only at the privilege level as well as the trigger level:
-- two independent controls, so a mistake in either does not lose the guarantee.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM pcid_app;
REVOKE UPDATE, DELETE, TRUNCATE ON pcid_allocation FROM pcid_app;

-- The read-only analytics role never sees identifying columns of the registry.
REVOKE SELECT ON citizen FROM pcid_readonly;
REVOKE SELECT ON emergency_contact FROM pcid_readonly;
REVOKE SELECT ON citizen_account FROM pcid_readonly;
REVOKE SELECT ON mfa_credential, citizen_mfa_credential FROM pcid_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pcid_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO pcid_app;
