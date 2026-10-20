CREATE TABLE IF NOT EXISTS rides (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_date date NOT NULL,
  start_time time,
  elapsed_time text NOT NULL DEFAULT '',
  moving_time text NOT NULL DEFAULT '',
  distance numeric(12, 3),
  elevation numeric(12, 3),
  avg_speed numeric(12, 3),
  max_speed numeric(12, 3),
  device text,
  hr_max numeric(8, 2),
  hr_mean numeric(8, 2),
  bike text,
  source_system text NOT NULL DEFAULT 'manual',
  auto_detected boolean NOT NULL DEFAULT false,
  source_record_id text,
  source_fingerprint text,
  activity_type text,
  title text,
  comment text,
  duration_seconds numeric(12, 3),
  calories_kcal numeric(12, 3)
);

ALTER TABLE rides ADD COLUMN IF NOT EXISTS source_system text NOT NULL DEFAULT 'manual';
ALTER TABLE rides ADD COLUMN IF NOT EXISTS auto_detected boolean NOT NULL DEFAULT false;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS source_record_id text;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS source_fingerprint text;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS activity_type text;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS comment text;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS duration_seconds numeric(12, 3);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS calories_kcal numeric(12, 3);

CREATE INDEX IF NOT EXISTS rides_ride_date_idx ON rides (ride_date);
CREATE UNIQUE INDEX IF NOT EXISTS rides_source_record_idx
  ON rides (source_system, source_record_id)
  WHERE source_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ride_route_points (
  ride_id bigint NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence >= 0),
  recorded_at timestamptz NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  altitude_meters numeric(10, 3),
  PRIMARY KEY (ride_id, sequence)
);

-- Private per-second/per-sample exercise metrics used by individual ride analysis.
CREATE TABLE IF NOT EXISTS ride_exercise_samples (
  ride_id bigint NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence >= 0),
  recorded_at timestamptz NOT NULL,
  heart_rate_bpm numeric(8, 2),
  cadence_rpm numeric(8, 2),
  power_watts numeric(10, 2),
  speed_meters_per_second numeric(10, 4),
  PRIMARY KEY (ride_id, sequence)
);

-- Links Samsung Health sessions to their canonical RideScope rows during the
-- GPS-only history reconciliation. This does not change ride summary fields.
CREATE TABLE IF NOT EXISTS samsung_route_links (
  source_record_id text PRIMARY KEY,
  ride_id bigint NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS samsung_route_links_ride_id_idx
  ON samsung_route_links (ride_id);
