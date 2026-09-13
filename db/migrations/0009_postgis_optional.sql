-- 0009 Optional PostGIS acceleration for the GIS command map (§35).
--
-- Applied only where the extension is installed. The schema is identical either
-- way: latitude and longitude remain the stored truth, and this migration adds a
-- generated geography column plus a spatial index so proximity queries on the
-- command map do not degrade to a sequential scan at statewide volumes.
--
-- Without PostGIS the platform is fully functional; proximity is computed from a
-- bounding box plus a great-circle distance in SQL.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') THEN
    CREATE EXTENSION IF NOT EXISTS postgis;

    ALTER TABLE incident
      ADD COLUMN IF NOT EXISTS geog geography(Point, 4326)
      GENERATED ALWAYS AS (
        CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)::geography
        END
      ) STORED;
    CREATE INDEX IF NOT EXISTS incident_geog_idx ON incident USING gist (geog);

    ALTER TABLE response_unit
      ADD COLUMN IF NOT EXISTS geog geography(Point, 4326)
      GENERATED ALWAYS AS (
        CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)::geography
        END
      ) STORED;
    CREATE INDEX IF NOT EXISTS response_unit_geog_idx ON response_unit USING gist (geog);

    ALTER TABLE property
      ADD COLUMN IF NOT EXISTS geog geography(Point, 4326)
      GENERATED ALWAYS AS (
        CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)::geography
        END
      ) STORED;
    CREATE INDEX IF NOT EXISTS property_geog_idx ON property USING gist (geog);
  ELSE
    RAISE NOTICE 'PostGIS is not available; the platform will use the portable great-circle path.';
  END IF;
END;
$$;

-- Portable great-circle distance in metres. Used when PostGIS is absent and as a
-- readable reference for the distance semantics the platform relies on.
CREATE OR REPLACE FUNCTION great_circle_metres(
  lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric
) RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN NULL
    ELSE 6371008.8 * 2 * asin(sqrt(
      power(sin(radians(lat2::double precision - lat1::double precision) / 2), 2)
      + cos(radians(lat1::double precision)) * cos(radians(lat2::double precision))
      * power(sin(radians(lon2::double precision - lon1::double precision) / 2), 2)
    ))
  END;
$$;
