-- 0013 Spatial lookup for the command map (master system prompt §35).
--
-- 0009 created GiST indexes on a generated geography column, and only where
-- PostGIS is installed. Nothing ever queried them: the one proximity query in
-- the platform computed a great-circle distance over every row in the table and
-- sorted the result, which is a sequential scan whether PostGIS is present or
-- not.
--
-- The command map is what makes that matter, because a map asks for "everything
-- inside this rectangle" several times a minute. These indexes serve the
-- portable path - the one every deployment without PostGIS uses, and the one
-- the platform must be fully functional on.

-- Latitude leads, because a bounding box on the ground is narrow in latitude
-- and the planner can range-scan it before filtering longitude. Partial, because
-- most rows in both tables never carry a coordinate at all: an incident reported
-- by address has none, and a unit that has not reported its position has none.
CREATE INDEX incident_position_idx ON incident (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX response_unit_position_idx ON response_unit (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- The map reads live incidents only, and there are far fewer of those than
-- there are incidents. Ordering by severity is what a command room wants first.
CREATE INDEX incident_active_severity_idx ON incident (severity, reported_at DESC)
  WHERE status IN ('REPORTED','VERIFIED','DISPATCHED','ON_SCENE','CONTAINED');
