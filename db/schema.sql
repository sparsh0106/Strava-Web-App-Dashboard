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
  bike text
);

CREATE INDEX IF NOT EXISTS rides_ride_date_idx ON rides (ride_date);
