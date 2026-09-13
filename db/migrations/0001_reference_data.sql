-- 0001 Reference data: extensions and the geography every other table hangs off.
--
-- PostGIS is the production choice for the GIS command map (master system prompt
-- §35). It is not a dependency of the core schema: coordinates are stored as
-- plain numerics with an explicit provenance column so the platform runs on a
-- stock PostgreSQL, and 0009_postgis_optional.sql adds the spatial index where
-- the extension is available.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

CREATE TABLE lga (
  code           text PRIMARY KEY,
  name           text NOT NULL UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ward (
  code           text PRIMARY KEY,
  lga_code       text NOT NULL REFERENCES lga (code) ON DELETE RESTRICT,
  name           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lga_code, name)
);
CREATE INDEX ward_lga_code_idx ON ward (lga_code);

CREATE TABLE community (
  code           text PRIMARY KEY,
  ward_code      text NOT NULL REFERENCES ward (code) ON DELETE RESTRICT,
  name           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ward_code, name)
);
CREATE INDEX community_ward_code_idx ON community (ward_code);

-- Atomic, gap-tolerant allocation of human-readable reference numbers such as
-- INC-2026-000123 and CASE-2026-00928.
CREATE TABLE reference_sequence (
  scope          text NOT NULL,
  period         text NOT NULL,
  next_value     bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (scope, period)
);

CREATE FUNCTION next_reference(p_scope text, p_period text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_value bigint;
BEGIN
  INSERT INTO reference_sequence (scope, period, next_value)
  VALUES (p_scope, p_period, 2)
  ON CONFLICT (scope, period)
  DO UPDATE SET next_value = reference_sequence.next_value + 1
  RETURNING reference_sequence.next_value - 1
  INTO v_value;
  RETURN v_value;
END;
$$;

-- Shared trigger to keep updated_at honest without relying on application code.
CREATE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER lga_set_updated_at BEFORE UPDATE ON lga
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ward_set_updated_at BEFORE UPDATE ON ward
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER community_set_updated_at BEFORE UPDATE ON community
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
