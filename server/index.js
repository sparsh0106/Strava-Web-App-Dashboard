import dotenv from "dotenv";
import express from "express";
import { neon } from "@neondatabase/serverless";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: [path.join(ROOT, ".env.local"), path.join(ROOT, ".env")] });
const PORT = Number(process.env.PORT || 8787);
const DATABASE_URL = process.env.DATABASE_URL;
const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

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

function noStore(res) {
  res.set("Cache-Control", "no-store");
}

function asRow(values) {
  return values.map(value => value === null || value === undefined ? "" : String(value));
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
        elapsed_time,
        moving_time,
        distance,
        elevation,
        avg_speed,
        max_speed,
        device,
        hr_max,
        hr_mean,
        bike
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
      syncedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("PostgreSQL ride query failed:", error instanceof Error ? error.message : error);
    return res.status(500).send(
      "Could not read rides from PostgreSQL. Check /api/health and confirm the rides table has been imported."
    );
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
