import dotenv from "dotenv";
import express from "express";
import { neon } from "@neondatabase/serverless";
import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: [path.join(ROOT, ".env.local"), path.join(ROOT, ".env")] });
const PORT = Number(process.env.PORT || 8787);
const DATABASE_URL = process.env.DATABASE_URL;
const SAMSUNG_SYNC_TOKEN = process.env.SYNC_TOKEN;
const ROUTE_VIEW_PASSWORD = process.env.ROUTE_VIEW_PASSWORD;
const sql = DATABASE_URL ? neon(DATABASE_URL) : null;
const ROUTE_COOKIE = "ridescope_private_access";
const ROUTE_SESSION_SECONDS = 12 * 60 * 60;

const RIDE_HEADERS = [
  "Date",
  "Elapsed_Time",
  "Moving_Time",
  "Distance",
  "Elevation",
  "Avg_Speed",
  "Max_Speed",
  "Device",
  "HR_max",
  "HR_mean",
  "Bike"
];

if (!DATABASE_URL) {
  console.warn("DATABASE_URL is not configured. See README.md to connect PostgreSQL.");
}

const app = express();
// Leave headroom below Vercel Functions' 4.5 MB request limit.
app.use(express.json({ limit: "4mb" }));

function noStore(res) {
  res.set("Cache-Control", "no-store");
}

function asRow(values) {
  return values.map(value => value === null || value === undefined ? "" : String(value));
}

function isAuthorizedSync(req) {
  const authorization = req.get("authorization") || "";
  const match = /^Bearer (.+)$/i.exec(authorization);
  if (!SAMSUNG_SYNC_TOKEN || SAMSUNG_SYNC_TOKEN.length < 32 || !match) return false;

  const expected = Buffer.from(SAMSUNG_SYNC_TOKEN);
  const supplied = Buffer.from(match[1]);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function routeSessionSignature(expiresAt) {
  return createHmac("sha256", ROUTE_VIEW_PASSWORD).update(String(expiresAt)).digest("hex");
}

function hasPrivateRouteAccess(req) {
  if (!ROUTE_VIEW_PASSWORD || ROUTE_VIEW_PASSWORD.length < 16) return false;
  const cookieHeader = req.get("cookie") || "";
  const token = cookieHeader.split(";").map(value => value.trim())
    .find(value => value.startsWith(`${ROUTE_COOKIE}=`))?.slice(ROUTE_COOKIE.length + 1);
  if (!token) return false;
  const [expiresText, signature] = token.split(".");
  const expiresAt = Number(expiresText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000) || !signature) return false;
  const expected = Buffer.from(routeSessionSignature(expiresAt));
  const supplied = Buffer.from(signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalNumber(value, name, min, max) {
  if (value === null || value === undefined) return null;
  if (!isFiniteNumber(value) || value < min || value > max) {
    throw new TypeError(`${name} must be a finite number between ${min} and ${max}.`);
  }
  return value;
}

function requiredText(value, name, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${name} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function optionalText(value, name, maxLength) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new TypeError(`${name} must be a string of at most ${maxLength} characters.`);
  }
  return value;
}

function validTimestamp(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${name} must be an ISO 8601 timestamp.`);
  }
  return value;
}

function durationText(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function normalizeSamsungSync(body) {
  if (!body || body.schemaVersion !== 1 || !Array.isArray(body.rides)) {
    throw new TypeError("Expected schemaVersion 1 and a rides array.");
  }
  if (body.rides.length < 1 || body.rides.length > 25) {
    throw new TypeError("Each sync request must contain between 1 and 25 rides.");
  }
  const timezone = requiredText(body.timezone, "timezone", 64);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new TypeError("timezone must be a valid IANA time zone.");
  }

  const seenIds = new Set();
  let routePointCount = 0;
  let exerciseSampleCount = 0;
  const rides = body.rides.map((ride, rideIndex) => {
    const prefix = `rides[${rideIndex}]`;
    if (!ride || typeof ride !== "object" || Array.isArray(ride)) {
      throw new TypeError(`${prefix} must be an object.`);
    }
    const sourceRecordId = requiredText(ride.sourceRecordId, `${prefix}.sourceRecordId`, 255);
    if (seenIds.has(sourceRecordId)) throw new TypeError(`Duplicate sourceRecordId in request: ${sourceRecordId}.`);
    seenIds.add(sourceRecordId);

    const startTime = validTimestamp(ride.startTime, `${prefix}.startTime`);
    const endTime = validTimestamp(ride.endTime, `${prefix}.endTime`);
    if (Date.parse(endTime) < Date.parse(startTime)) throw new TypeError(`${prefix}.endTime must be after startTime.`);
    const durationSeconds = optionalNumber(ride.durationSeconds, `${prefix}.durationSeconds`, 0, 172800);
    const elapsedSeconds = optionalNumber(ride.elapsedSeconds, `${prefix}.elapsedSeconds`, 0, 172800);
    if (durationSeconds === null || elapsedSeconds === null) {
      throw new TypeError(`${prefix} must include durationSeconds and elapsedSeconds.`);
    }
    const movingTimeSeconds = ride.movingTimeSeconds === null || ride.movingTimeSeconds === undefined
      ? durationSeconds
      : optionalNumber(ride.movingTimeSeconds, `${prefix}.movingTimeSeconds`, 0, 172800);

    const points = ride.routePoints ?? [];
    if (!Array.isArray(points) || points.length > 20000) {
      throw new TypeError(`${prefix}.routePoints must be an array with at most 20000 points.`);
    }
    routePointCount += points.length;
    if (routePointCount > 50000) throw new TypeError("Each sync request is limited to 50000 route points.");
    const routePoints = points.map((point, pointIndex) => {
      if (!point || typeof point !== "object" || Array.isArray(point)) {
        throw new TypeError(`${prefix}.routePoints[${pointIndex}] must be an object.`);
      }
      if (!Number.isSafeInteger(point.sequence) || point.sequence < 0) {
        throw new TypeError(`${prefix}.routePoints[${pointIndex}].sequence must be a non-negative integer.`);
      }
      const latitude = optionalNumber(point.latitude, `${prefix}.routePoints[${pointIndex}].latitude`, -90, 90);
      const longitude = optionalNumber(point.longitude, `${prefix}.routePoints[${pointIndex}].longitude`, -180, 180);
      if (latitude === null || longitude === null) throw new TypeError(`${prefix}.routePoints[${pointIndex}] needs latitude and longitude.`);
      return {
        sequence: point.sequence,
        timestamp: validTimestamp(point.timestamp, `${prefix}.routePoints[${pointIndex}].timestamp`),
        latitude,
        longitude,
        altitude_meters: optionalNumber(point.altitudeMeters, `${prefix}.routePoints[${pointIndex}].altitudeMeters`, -12000, 100000)
      };
    });
    const sequences = new Set(routePoints.map(point => point.sequence));
    if (sequences.size !== routePoints.length) throw new TypeError(`${prefix}.routePoints contains duplicate sequence values.`);

    const rawSamples = ride.exerciseSamples ?? [];
    if (!Array.isArray(rawSamples) || rawSamples.length > 50000) {
      throw new TypeError(`${prefix}.exerciseSamples must be an array with at most 50000 samples.`);
    }
    exerciseSampleCount += rawSamples.length;
    if (exerciseSampleCount > 50000) throw new TypeError("Each sync request is limited to 50000 exercise samples.");
    const exerciseSamples = rawSamples.map((sample, sampleIndex) => {
      if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
        throw new TypeError(`${prefix}.exerciseSamples[${sampleIndex}] must be an object.`);
      }
      if (!Number.isSafeInteger(sample.sequence) || sample.sequence < 0) {
        throw new TypeError(`${prefix}.exerciseSamples[${sampleIndex}].sequence must be a non-negative integer.`);
      }
      return {
        sequence: sample.sequence,
        timestamp: validTimestamp(sample.timestamp, `${prefix}.exerciseSamples[${sampleIndex}].timestamp`),
        heart_rate_bpm: optionalNumber(sample.heartRateBpm, `${prefix}.exerciseSamples[${sampleIndex}].heartRateBpm`, 0, 300),
        cadence_rpm: optionalNumber(sample.cadenceRpm, `${prefix}.exerciseSamples[${sampleIndex}].cadenceRpm`, 0, 500),
        power_watts: optionalNumber(sample.powerWatts, `${prefix}.exerciseSamples[${sampleIndex}].powerWatts`, 0, 5000),
        speed_meters_per_second: optionalNumber(sample.speedMetersPerSecond, `${prefix}.exerciseSamples[${sampleIndex}].speedMetersPerSecond`, 0, 100)
      };
    });
    const sampleSequences = new Set(exerciseSamples.map(sample => sample.sequence));
    if (sampleSequences.size !== exerciseSamples.length) throw new TypeError(`${prefix}.exerciseSamples contains duplicate sequence values.`);
    const replaceRoutePoints = ride.replaceRoutePoints === undefined ? true : ride.replaceRoutePoints;
    const replaceExerciseSamples = ride.replaceExerciseSamples === undefined ? true : ride.replaceExerciseSamples;
    if (typeof replaceRoutePoints !== "boolean" || typeof replaceExerciseSamples !== "boolean") {
      throw new TypeError(`${prefix} replacement flags must be boolean values.`);
    }

    return {
      source_record_id: sourceRecordId,
      source_fingerprint: requiredText(ride.fingerprint, `${prefix}.fingerprint`, 128),
      activity_type: requiredText(ride.activityType, `${prefix}.activityType`, 100),
      title: optionalText(ride.title, `${prefix}.title`, 500),
      comment: optionalText(ride.comment, `${prefix}.comment`, 4000),
      start_time: startTime,
      end_time: endTime,
      duration_seconds: durationSeconds,
      elapsed_seconds: elapsedSeconds,
      elapsed_time: durationText(elapsedSeconds),
      moving_time: durationText(movingTimeSeconds),
      device_name: optionalText(ride.deviceName, `${prefix}.deviceName`, 100) ?? "Watch",
      distance_meters: optionalNumber(ride.distanceMeters, `${prefix}.distanceMeters`, 0, 2000000),
      elevation_gain_meters: optionalNumber(ride.elevationGainMeters, `${prefix}.elevationGainMeters`, 0, 100000),
      calories_kcal: optionalNumber(ride.caloriesKcal, `${prefix}.caloriesKcal`, 0, 100000),
      mean_speed_meters_per_second: optionalNumber(ride.meanSpeedMetersPerSecond, `${prefix}.meanSpeedMetersPerSecond`, 0, 100),
      max_speed_meters_per_second: optionalNumber(ride.maxSpeedMetersPerSecond, `${prefix}.maxSpeedMetersPerSecond`, 0, 100),
      mean_heart_rate_bpm: optionalNumber(ride.meanHeartRateBpm, `${prefix}.meanHeartRateBpm`, 0, 300),
      max_heart_rate_bpm: optionalNumber(ride.maxHeartRateBpm, `${prefix}.maxHeartRateBpm`, 0, 300),
      bike_name: optionalText(ride.bikeName, `${prefix}.bikeName`, 200) ?? "Fuji",
      route_points: routePoints,
      exercise_samples: exerciseSamples,
      replace_route_points: replaceRoutePoints,
      replace_exercise_samples: replaceExerciseSamples
    };
  });

  if (routePointCount + exerciseSampleCount > 50000) {
    throw new TypeError("Each sync request is limited to 50000 total route and exercise samples.");
  }
  return { timezone, rides, routePointCount, exerciseSampleCount };
}

app.get("/api/rides", async (_req, res) => {
  noStore(res);
  if (!sql) {
    return res.status(500).send(
      process.env.VERCEL
        ? "PostgreSQL is not configured on Vercel. Connect your database and set DATABASE_URL."
        : "PostgreSQL is not configured on the server. Set DATABASE_URL in .env.local."
    );
  }

  try {
    const rides = await sql`
      SELECT
        CASE
          WHEN start_time IS NULL THEN to_char(ride_date, 'YYYY-MM-DD')
          ELSE to_char(ride_date, 'YYYY-MM-DD') || ' ' || to_char(start_time, 'HH24:MI:SS')
        END AS activity_date,
        id AS database_id,
        elapsed_time,
        moving_time,
        distance,
        elevation,
        avg_speed,
        max_speed,
        device,
        hr_max,
        hr_mean,
        bike,
        duration_seconds,
        calories_kcal,
        source_system,
        activity_type,
        title
      FROM rides
      ORDER BY id ASC
    `;

    return res.json({
      values: [RIDE_HEADERS, ...rides.map(ride => asRow([
        ride.activity_date,
        ride.elapsed_time,
        ride.moving_time,
        ride.distance,
        ride.elevation,
        ride.avg_speed,
        ride.max_speed,
        ride.device,
        ride.hr_max,
        ride.hr_mean,
        ride.bike
      ]))],
      rides: rides.map(ride => ({
        databaseId: String(ride.database_id),
        durationSeconds: ride.duration_seconds,
        caloriesKcal: ride.calories_kcal,
        sourceSystem: ride.source_system,
        activityType: ride.activity_type,
        title: ride.title
      })),
      syncedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("PostgreSQL ride query failed:", error instanceof Error ? error.message : error);
    return res.status(500).send(
      "Could not read rides from PostgreSQL. Check /api/health and confirm the rides table has been imported."
    );
  }
});

app.post("/api/route-access", (req, res) => {
  noStore(res);
  if (!ROUTE_VIEW_PASSWORD || ROUTE_VIEW_PASSWORD.length < 16) {
    return res.status(503).json({ ok: false, error: "Private ride analysis is not configured on the server." });
  }
  const supplied = Buffer.from(typeof req.body?.password === "string" ? req.body.password : "");
  const expected = Buffer.from(ROUTE_VIEW_PASSWORD);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ ok: false, error: "That password did not unlock private ride analysis." });
  }
  const expiresAt = Math.floor(Date.now() / 1000) + ROUTE_SESSION_SECONDS;
  const signature = routeSessionSignature(expiresAt);
  const secure = req.secure || req.get("x-forwarded-proto") === "https";
  res.set("Set-Cookie", `${ROUTE_COOKIE}=${expiresAt}.${signature}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${ROUTE_SESSION_SECONDS}${secure ? "; Secure" : ""}`);
  return res.json({ ok: true, expiresAt });
});

app.post("/api/route-access/logout", (_req, res) => {
  noStore(res);
  const secure = _req.secure || _req.get("x-forwarded-proto") === "https";
  res.set("Set-Cookie", `${ROUTE_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure ? "; Secure" : ""}`);
  return res.json({ ok: true });
});

app.get("/api/rides/:rideId/analysis", async (req, res) => {
  noStore(res);
  if (!hasPrivateRouteAccess(req)) return res.status(401).json({ ok: false, error: "Unlock private ride analysis to view this data." });
  if (!sql) return res.status(503).json({ ok: false, error: "Database is not configured on the server." });
  if (!/^\d{1,18}$/.test(req.params.rideId)) return res.status(400).json({ ok: false, error: "Invalid ride ID." });

  try {
    const rideId = req.params.rideId;
    const [ride] = await sql`SELECT id, duration_seconds, calories_kcal, source_system, activity_type, title FROM rides WHERE id = ${rideId}`;
    if (!ride) return res.status(404).json({ ok: false, error: "Ride not found." });
    const [routePoints, exerciseSamples] = await Promise.all([
      sql`SELECT recorded_at, latitude, longitude, altitude_meters FROM ride_route_points WHERE ride_id = ${rideId} ORDER BY sequence ASC`,
      sql`SELECT recorded_at, heart_rate_bpm, cadence_rpm, power_watts, speed_meters_per_second FROM ride_exercise_samples WHERE ride_id = ${rideId} ORDER BY sequence ASC`
    ]);
    return res.json({
      ok: true,
      ride: {
        databaseId: String(ride.id),
        durationSeconds: ride.duration_seconds,
        caloriesKcal: ride.calories_kcal,
        sourceSystem: ride.source_system,
        activityType: ride.activity_type,
        title: ride.title
      },
      routePoints: routePoints.map(point => ({
        timestamp: point.recorded_at,
        latitude: Number(point.latitude),
        longitude: Number(point.longitude),
        altitudeMeters: point.altitude_meters === null ? null : Number(point.altitude_meters)
      })),
      exerciseSamples: exerciseSamples.map(sample => ({
        timestamp: sample.recorded_at,
        heartRateBpm: sample.heart_rate_bpm === null ? null : Number(sample.heart_rate_bpm),
        cadenceRpm: sample.cadence_rpm === null ? null : Number(sample.cadence_rpm),
        powerWatts: sample.power_watts === null ? null : Number(sample.power_watts),
        speedMetersPerSecond: sample.speed_meters_per_second === null ? null : Number(sample.speed_meters_per_second)
      }))
    });
  } catch (error) {
    console.error("Private ride analysis query failed:", error instanceof Error ? error.message : error);
    return res.status(500).json({ ok: false, error: "Could not load private ride analysis." });
  }
});

app.get("/api/health", async (_req, res) => {
  noStore(res);
  if (!sql) {
    return res.status(503).json({
      ok: false,
      databaseConfigured: false,
      databaseReady: false,
      missingSettings: ["DATABASE_URL"]
    });
  }

  try {
    const [result] = await sql`SELECT count(*)::int AS ride_count FROM rides`;
    return res.json({
      ok: true,
      databaseConfigured: true,
      databaseReady: true,
      rideCount: result.ride_count,
      missingSettings: []
    });
  } catch (error) {
    console.error("PostgreSQL health check failed:", error instanceof Error ? error.message : error);
    return res.status(503).json({
      ok: false,
      databaseConfigured: true,
      databaseReady: false,
      message: "Database connection failed or the rides table has not been created."
    });
  }
});

app.post("/api/sync/samsung", async (req, res) => {
  noStore(res);
  if (!isAuthorizedSync(req)) {
    const configured = Boolean(SAMSUNG_SYNC_TOKEN && SAMSUNG_SYNC_TOKEN.length >= 32);
    return res.status(configured ? 401 : 503).json({
      ok: false,
      error: configured ? "Unauthorized." : "Samsung sync is not configured on the server."
    });
  }
  if (!sql) return res.status(503).json({ ok: false, error: "Database is not configured on the server." });

  let sync;
  try {
    sync = normalizeSamsungSync(req.body);
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Invalid sync payload." });
  }

  const serialized = JSON.stringify(sync.rides);
  try {
    const transaction = await sql.transaction(tx => [
      tx`
        WITH incoming AS (
          SELECT * FROM jsonb_to_recordset(${serialized}::jsonb) AS ride(
            source_record_id text,
            source_fingerprint text,
            activity_type text,
            title text,
            comment text,
            start_time timestamptz,
            end_time timestamptz,
            duration_seconds numeric,
            elapsed_seconds numeric,
            elapsed_time text,
            moving_time text,
            device_name text,
            distance_meters double precision,
            elevation_gain_meters double precision,
            calories_kcal double precision,
            mean_speed_meters_per_second double precision,
            max_speed_meters_per_second double precision,
            mean_heart_rate_bpm double precision,
            max_heart_rate_bpm double precision,
            bike_name text,
            route_points jsonb
          )
        )
        INSERT INTO rides (
          ride_date, start_time, elapsed_time, moving_time, distance, elevation,
          avg_speed, max_speed, device, hr_max, hr_mean, bike, source_system,
          source_record_id, source_fingerprint, activity_type, title, comment,
          duration_seconds, calories_kcal
        )
        SELECT
          (incoming.start_time AT TIME ZONE ${sync.timezone})::date,
          (incoming.start_time AT TIME ZONE ${sync.timezone})::time,
          incoming.elapsed_time,
          incoming.moving_time,
          incoming.distance_meters / 1000.0,
          incoming.elevation_gain_meters,
          incoming.mean_speed_meters_per_second * 3.6,
          incoming.max_speed_meters_per_second * 3.6,
          incoming.device_name,
          incoming.max_heart_rate_bpm,
          incoming.mean_heart_rate_bpm,
          incoming.bike_name,
          'samsung_health',
          incoming.source_record_id,
          incoming.source_fingerprint,
          incoming.activity_type,
          incoming.title,
          incoming.comment,
          incoming.duration_seconds,
          incoming.calories_kcal
        FROM incoming
        ON CONFLICT (source_system, source_record_id) WHERE source_record_id IS NOT NULL
        DO UPDATE SET
          ride_date = EXCLUDED.ride_date,
          start_time = EXCLUDED.start_time,
          elapsed_time = EXCLUDED.elapsed_time,
          moving_time = EXCLUDED.moving_time,
          distance = EXCLUDED.distance,
          elevation = EXCLUDED.elevation,
          avg_speed = EXCLUDED.avg_speed,
          max_speed = EXCLUDED.max_speed,
          device = EXCLUDED.device,
          hr_max = EXCLUDED.hr_max,
          hr_mean = EXCLUDED.hr_mean,
          bike = EXCLUDED.bike,
          source_fingerprint = EXCLUDED.source_fingerprint,
          activity_type = EXCLUDED.activity_type,
          title = EXCLUDED.title,
          comment = EXCLUDED.comment,
          duration_seconds = EXCLUDED.duration_seconds,
          calories_kcal = EXCLUDED.calories_kcal
        RETURNING source_record_id
      `,
      tx`
        WITH incoming AS (
          SELECT * FROM jsonb_to_recordset(${serialized}::jsonb) AS ride(
            source_record_id text,
            route_points jsonb,
            replace_route_points boolean
          )
        )
        DELETE FROM ride_route_points AS route
        USING rides AS saved, incoming
        WHERE route.ride_id = saved.id
          AND saved.source_system = 'samsung_health'
          AND saved.source_record_id = incoming.source_record_id
          AND incoming.replace_route_points
          AND jsonb_array_length(incoming.route_points) > 0
      `,
      tx`
        WITH incoming AS (
          SELECT * FROM jsonb_to_recordset(${serialized}::jsonb) AS ride(
            source_record_id text,
            route_points jsonb
          )
        ), points AS (
          SELECT incoming.source_record_id, point.*
          FROM incoming
          CROSS JOIN LATERAL jsonb_to_recordset(incoming.route_points) AS point(
            sequence integer,
            timestamp timestamptz,
            latitude double precision,
            longitude double precision,
            altitude_meters double precision
          )
        )
        INSERT INTO ride_route_points (ride_id, sequence, recorded_at, latitude, longitude, altitude_meters)
        SELECT saved.id, points.sequence, points.timestamp, points.latitude, points.longitude, points.altitude_meters
        FROM points
        JOIN rides AS saved
          ON saved.source_system = 'samsung_health'
         AND saved.source_record_id = points.source_record_id
        ON CONFLICT (ride_id, sequence)
        DO UPDATE SET
          recorded_at = EXCLUDED.recorded_at,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          altitude_meters = EXCLUDED.altitude_meters
      `,
      tx`
        WITH incoming AS (
          SELECT * FROM jsonb_to_recordset(${serialized}::jsonb) AS ride(
            source_record_id text,
            exercise_samples jsonb,
            replace_exercise_samples boolean
          )
        )
        DELETE FROM ride_exercise_samples AS sample
        USING rides AS saved, incoming
        WHERE sample.ride_id = saved.id
          AND saved.source_system = 'samsung_health'
          AND saved.source_record_id = incoming.source_record_id
          AND incoming.replace_exercise_samples
          AND jsonb_array_length(incoming.exercise_samples) > 0
      `,
      tx`
        WITH incoming AS (
          SELECT * FROM jsonb_to_recordset(${serialized}::jsonb) AS ride(
            source_record_id text,
            exercise_samples jsonb
          )
        ), samples AS (
          SELECT incoming.source_record_id, item.*
          FROM incoming
          CROSS JOIN LATERAL jsonb_to_recordset(incoming.exercise_samples) AS item(
            sequence integer,
            timestamp timestamptz,
            heart_rate_bpm double precision,
            cadence_rpm double precision,
            power_watts double precision,
            speed_meters_per_second double precision
          )
        )
        INSERT INTO ride_exercise_samples (ride_id, sequence, recorded_at, heart_rate_bpm, cadence_rpm, power_watts, speed_meters_per_second)
        SELECT saved.id, samples.sequence, samples.timestamp, samples.heart_rate_bpm, samples.cadence_rpm, samples.power_watts, samples.speed_meters_per_second
        FROM samples
        JOIN rides AS saved
          ON saved.source_system = 'samsung_health'
         AND saved.source_record_id = samples.source_record_id
        ON CONFLICT (ride_id, sequence)
        DO UPDATE SET
          recorded_at = EXCLUDED.recorded_at,
          heart_rate_bpm = EXCLUDED.heart_rate_bpm,
          cadence_rpm = EXCLUDED.cadence_rpm,
          power_watts = EXCLUDED.power_watts,
          speed_meters_per_second = EXCLUDED.speed_meters_per_second
      `
    ]);
    return res.json({
      ok: true,
      ridesSynced: transaction[0].length,
      routePointsSynced: sync.routePointCount,
      exerciseSamplesSynced: sync.exerciseSampleCount
    });
  } catch (error) {
    console.error("Samsung ride sync failed:", error instanceof Error ? error.name : "Unknown error");
    return res.status(500).json({ ok: false, error: "Could not save Samsung Health rides. Retry the sync." });
  }
});

// Vercel's Express function serves the Vite output alongside the API. Include
// public/** in the function bundle through vercel.json so these files exist at
// runtime; local production uses the same paths.
app.use(express.static(path.join(ROOT, "public")));

app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (req.path.startsWith("/api/")) return next();
  return res.sendFile(path.join(ROOT, "public", "index.html"));
});

if (!process.env.VERCEL) {
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`RideScope server listening on http://127.0.0.1:${PORT}`);
  });
}

export default app;
