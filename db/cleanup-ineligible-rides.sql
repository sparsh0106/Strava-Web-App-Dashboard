-- Archive Samsung-import noise and rides missing distance or at/below 5 km.
-- Every affected row is archived before deletion; failed archive checks roll back the transaction.
-- Review current candidate counts before running. Archive tables are private to Neon.

BEGIN;

-- Keep sync uploads from adding child rows between the archive and delete steps.
LOCK TABLE rides, ride_route_points, ride_exercise_samples, samsung_route_links
  IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS ride_cleanup_archive AS
SELECT ride.*, now() AS archived_at, NULL::text AS archive_reason
FROM rides AS ride
WHERE false;

CREATE TABLE IF NOT EXISTS ride_route_points_cleanup_archive AS
SELECT route.*, now() AS archived_at, NULL::text AS archive_reason
FROM ride_route_points AS route
WHERE false;

CREATE TABLE IF NOT EXISTS ride_exercise_samples_cleanup_archive AS
SELECT sample.*, now() AS archived_at, NULL::text AS archive_reason
FROM ride_exercise_samples AS sample
WHERE false;

CREATE TABLE IF NOT EXISTS samsung_route_links_cleanup_archive AS
SELECT link.*, now() AS archived_at, NULL::text AS archive_reason
FROM samsung_route_links AS link
WHERE false;

CREATE UNIQUE INDEX IF NOT EXISTS ride_cleanup_archive_id_uq
  ON ride_cleanup_archive (id);
CREATE UNIQUE INDEX IF NOT EXISTS ride_route_points_cleanup_archive_pk
  ON ride_route_points_cleanup_archive (ride_id, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS ride_exercise_samples_cleanup_archive_pk
  ON ride_exercise_samples_cleanup_archive (ride_id, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS samsung_route_links_cleanup_archive_pk
  ON samsung_route_links_cleanup_archive (source_record_id);

WITH cleanup AS (
  SELECT ride.id,
    CASE
      WHEN ride.auto_detected IS TRUE THEN 'auto-detected'
      WHEN EXISTS (
        SELECT 1 FROM samsung_route_links AS link
        WHERE link.source_record_id = ride.source_record_id
          AND link.ride_id <> ride.id
      ) THEN 'linked Samsung duplicate'
      WHEN ride.distance IS NULL THEN 'missing distance'
      ELSE '5 km or shorter'
    END AS archive_reason
  FROM rides AS ride
  WHERE ride.auto_detected IS TRUE
     OR ride.distance IS NULL
     OR ride.distance <= 5
     OR EXISTS (
       SELECT 1 FROM samsung_route_links AS link
       WHERE link.source_record_id = ride.source_record_id
         AND link.ride_id <> ride.id
     )
)
INSERT INTO ride_cleanup_archive
SELECT ride.*, now(), cleanup.archive_reason
FROM rides AS ride
JOIN cleanup USING (id)
ON CONFLICT (id) DO NOTHING;

WITH cleanup AS (
  SELECT ride.id,
    CASE
      WHEN ride.auto_detected IS TRUE THEN 'auto-detected'
      WHEN EXISTS (
        SELECT 1 FROM samsung_route_links AS link
        WHERE link.source_record_id = ride.source_record_id
          AND link.ride_id <> ride.id
      ) THEN 'linked Samsung duplicate'
      WHEN ride.distance IS NULL THEN 'missing distance'
      ELSE '5 km or shorter'
    END AS archive_reason
  FROM rides AS ride
  WHERE ride.auto_detected IS TRUE
     OR ride.distance IS NULL
     OR ride.distance <= 5
     OR EXISTS (
       SELECT 1 FROM samsung_route_links AS link
       WHERE link.source_record_id = ride.source_record_id
         AND link.ride_id <> ride.id
     )
)
INSERT INTO ride_route_points_cleanup_archive
SELECT route.*, now(), cleanup.archive_reason
FROM ride_route_points AS route
JOIN cleanup ON cleanup.id = route.ride_id
ON CONFLICT (ride_id, sequence) DO NOTHING;

WITH cleanup AS (
  SELECT ride.id,
    CASE
      WHEN ride.auto_detected IS TRUE THEN 'auto-detected'
      WHEN EXISTS (
        SELECT 1 FROM samsung_route_links AS link
        WHERE link.source_record_id = ride.source_record_id
          AND link.ride_id <> ride.id
      ) THEN 'linked Samsung duplicate'
      WHEN ride.distance IS NULL THEN 'missing distance'
      ELSE '5 km or shorter'
    END AS archive_reason
  FROM rides AS ride
  WHERE ride.auto_detected IS TRUE
     OR ride.distance IS NULL
     OR ride.distance <= 5
     OR EXISTS (
       SELECT 1 FROM samsung_route_links AS link
       WHERE link.source_record_id = ride.source_record_id
         AND link.ride_id <> ride.id
     )
)
INSERT INTO ride_exercise_samples_cleanup_archive
SELECT sample.*, now(), cleanup.archive_reason
FROM ride_exercise_samples AS sample
JOIN cleanup ON cleanup.id = sample.ride_id
ON CONFLICT (ride_id, sequence) DO NOTHING;

WITH cleanup AS (
  SELECT ride.id
  FROM rides AS ride
  WHERE ride.auto_detected IS TRUE
     OR ride.distance IS NULL
     OR ride.distance <= 5
     OR EXISTS (
       SELECT 1 FROM samsung_route_links AS link
       WHERE link.source_record_id = ride.source_record_id
         AND link.ride_id <> ride.id
     )
)
INSERT INTO samsung_route_links_cleanup_archive
SELECT link.*, now(), 'target ride archived'
FROM samsung_route_links AS link
JOIN cleanup ON cleanup.id = link.ride_id
ON CONFLICT (source_record_id) DO NOTHING;

DO $$
DECLARE
  remaining_candidates integer;
BEGIN
  SELECT count(*)::integer
  INTO remaining_candidates
  FROM rides AS ride
  WHERE ride.auto_detected IS TRUE
     OR ride.distance IS NULL
     OR ride.distance <= 5
     OR EXISTS (
       SELECT 1 FROM samsung_route_links AS link
       WHERE link.source_record_id = ride.source_record_id
         AND link.ride_id <> ride.id
     );

  IF remaining_candidates = 0 THEN
    RAISE EXCEPTION 'Cleanup matched no ride rows; transaction cancelled.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM rides AS ride
    WHERE (ride.auto_detected IS TRUE
       OR ride.distance IS NULL
       OR ride.distance <= 5
       OR EXISTS (
         SELECT 1 FROM samsung_route_links AS link
         WHERE link.source_record_id = ride.source_record_id
           AND link.ride_id <> ride.id
       ))
      AND NOT EXISTS (
        SELECT 1 FROM ride_cleanup_archive AS archived WHERE archived.id = ride.id
      )
  ) THEN
    RAISE EXCEPTION 'Ride archive is incomplete; transaction cancelled.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ride_route_points AS route
    JOIN rides AS ride ON ride.id = route.ride_id
    WHERE (ride.auto_detected IS TRUE
       OR ride.distance IS NULL
       OR ride.distance <= 5
       OR EXISTS (
         SELECT 1 FROM samsung_route_links AS link
         WHERE link.source_record_id = ride.source_record_id
           AND link.ride_id <> ride.id
       ))
      AND NOT EXISTS (
        SELECT 1 FROM ride_route_points_cleanup_archive AS archived
        WHERE archived.ride_id = route.ride_id AND archived.sequence = route.sequence
      )
  ) THEN
    RAISE EXCEPTION 'GPS archive is incomplete; transaction cancelled.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ride_exercise_samples AS sample
    JOIN rides AS ride ON ride.id = sample.ride_id
    WHERE (ride.auto_detected IS TRUE
       OR ride.distance IS NULL
       OR ride.distance <= 5
       OR EXISTS (
         SELECT 1 FROM samsung_route_links AS link
         WHERE link.source_record_id = ride.source_record_id
           AND link.ride_id <> ride.id
       ))
      AND NOT EXISTS (
        SELECT 1 FROM ride_exercise_samples_cleanup_archive AS archived
        WHERE archived.ride_id = sample.ride_id AND archived.sequence = sample.sequence
      )
  ) THEN
    RAISE EXCEPTION 'Exercise sample archive is incomplete; transaction cancelled.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM samsung_route_links AS link
    JOIN rides AS ride ON ride.id = link.ride_id
    WHERE (ride.auto_detected IS TRUE
       OR ride.distance IS NULL
       OR ride.distance <= 5
       OR EXISTS (
         SELECT 1 FROM samsung_route_links AS duplicate_link
         WHERE duplicate_link.source_record_id = ride.source_record_id
           AND duplicate_link.ride_id <> ride.id
       ))
      AND NOT EXISTS (
        SELECT 1 FROM samsung_route_links_cleanup_archive AS archived
        WHERE archived.source_record_id = link.source_record_id
      )
  ) THEN
    RAISE EXCEPTION 'Samsung link archive is incomplete; transaction cancelled.';
  END IF;
END $$;

DELETE FROM rides AS ride
WHERE ride.auto_detected IS TRUE
   OR ride.distance IS NULL
   OR ride.distance <= 5
   OR EXISTS (
     SELECT 1 FROM samsung_route_links AS link
     WHERE link.source_record_id = ride.source_record_id
       AND link.ride_id <> ride.id
   );

COMMIT;

SELECT
  (SELECT count(*)::integer FROM rides) AS remaining_rides,
  (SELECT count(*)::integer FROM ride_cleanup_archive) AS archived_rides,
  (SELECT count(*)::integer FROM ride_route_points_cleanup_archive) AS archived_gps_points,
  (SELECT count(*)::integer FROM ride_exercise_samples_cleanup_archive) AS archived_exercise_samples;
