import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";
import { parse } from "csv-parse/sync";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: [path.join(ROOT, ".env.local"), path.join(ROOT, ".env")] });

const EXPECTED_HEADERS = [
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

function parseDateTime(value, rowNumber) {
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  const match = iso ?? dmy;
  if (!match) throw new Error(`Row ${rowNumber}: Date must be YYYY-MM-DD or DD/MM/YYYY, optionally followed by a time.`);

  const year = Number(iso ? match[1] : match[3]);
  const month = Number(match[2]);
  const day = Number(iso ? match[3] : match[1]);
  const hour = match[4] === undefined ? null : Number(match[4]);
  const minute = match[5] === undefined ? null : Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Row ${rowNumber}: Date is not a valid calendar date.`);
  }
  if (
    (hour !== null && (hour < 0 || hour > 23)) ||
    (minute !== null && (minute < 0 || minute > 59)) ||
    second < 0 || second > 59
  ) {
    throw new Error(`Row ${rowNumber}: time is outside the valid 24-hour range.`);
  }

  return {
    date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    time: hour === null || minute === null
      ? null
      : `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`
  };
}

function parseNumber(value, column, rowNumber) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const number = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(number)) throw new Error(`Row ${rowNumber}: ${column} must be numeric or blank.`);
  return number;
}

function parseRide(record, index) {
  const rowNumber = index + 2;
  const { date, time } = parseDateTime(record.Date, rowNumber);
  return {
    date,
    time,
    elapsedTime: String(record.Elapsed_Time ?? "").trim(),
    movingTime: String(record.Moving_Time ?? "").trim(),
    distance: parseNumber(record.Distance, "Distance", rowNumber),
    elevation: parseNumber(record.Elevation, "Elevation", rowNumber),
    avgSpeed: parseNumber(record.Avg_Speed, "Avg_Speed", rowNumber),
    maxSpeed: parseNumber(record.Max_Speed, "Max_Speed", rowNumber),
    device: String(record.Device ?? "").trim() || null,
    hrMax: parseNumber(record.HR_max, "HR_max", rowNumber),
    hrMean: parseNumber(record.HR_mean, "HR_mean", rowNumber),
    bike: String(record.Bike ?? "").trim() || null
  };
}

async function main() {
  const args = process.argv.slice(2);
  const replaceConfirmed = args.includes("--replace");
  const csvPath = args.find(argument => argument !== "--replace");
  if (!csvPath) throw new Error("Usage: npm run db:import -- --replace path/to/rides.csv");
  if (!replaceConfirmed) {
    throw new Error("This import replaces every existing ride row. Re-run with --replace to confirm.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing. Add your database connection URL to .env.local.");

  const source = await readFile(path.resolve(process.cwd(), csvPath), "utf8");
  const records = parse(source, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: false
  });
  const headers = Object.keys(records[0] ?? {});
  if (EXPECTED_HEADERS.some((header, index) => headers[index] !== header) || headers.length !== EXPECTED_HEADERS.length) {
    throw new Error(`CSV headers must be in this order: ${EXPECTED_HEADERS.join(", ")}`);
  }
  if (records.length === 0) throw new Error("CSV has no ride rows to import.");

  const rides = records.map(parseRide);
  const sql = neon(process.env.DATABASE_URL);
  const schema = await readFile(path.join(ROOT, "db", "schema.sql"), "utf8");
  const statements = schema.split(";").map(statement => statement.trim()).filter(Boolean);
  for (const statement of statements) await sql.query(statement, []);

  const replaceAndInsert = [
    sql`TRUNCATE TABLE rides RESTART IDENTITY`,
    ...rides.map(ride => sql`
      INSERT INTO rides (
        ride_date, start_time, elapsed_time, moving_time,
        distance, elevation, avg_speed, max_speed, device, hr_max, hr_mean, bike
      ) VALUES (
        ${ride.date}, ${ride.time}, ${ride.elapsedTime}, ${ride.movingTime},
        ${ride.distance}, ${ride.elevation}, ${ride.avgSpeed}, ${ride.maxSpeed}, ${ride.device},
        ${ride.hrMax}, ${ride.hrMean}, ${ride.bike}
      )
    `)
  ];
  await sql.transaction(replaceAndInsert);
  console.log(`Imported ${rides.length} rides into PostgreSQL. Existing ride rows were replaced.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
