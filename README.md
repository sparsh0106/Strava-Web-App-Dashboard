# RideScope

RideScope turns a Strava activity export into a polished, interactive cycling dashboard. Ride records live in Neon PostgreSQL, the server reads them through a private connection, and the website refreshes its view automatically.

**Live dashboard:** [sparshrides.vercel.app](https://sparshrides.vercel.app)

## How ride data reaches the site

```text
Add or edit a ride in Neon
          ↓
      Neon Postgres
          ↓  server-side DATABASE_URL
      RideScope API
          ↓  public, read-only response
       Dashboard
```

The normal workflow is simple: add a row in Neon’s table editor, save it, and RideScope picks it up on its next sync. While the site is open, it checks for database changes about once a minute. Use **Sync** to refresh immediately, or reload the page. Adding a ride does not require a code change, CSV import, or Vercel deployment.

> **Privacy:** RideScope has no visitor sign-in. Its read-only `GET /api/rides` endpoint returns the ride data used by the dashboard to anyone who visits the site. Store only information you are comfortable making public. The database connection string stays on the server and is never sent to the browser.

## Add a ride

1. Open the project’s Neon database and select the `rides` table.
2. Open the table editor and add a row.
3. Enter the ride’s date and any available metrics. Leave `id` blank; PostgreSQL generates it.
4. Save the row, then wait for the next automatic sync or press **Sync** on the dashboard.

The required field is `ride_date`. Time, duration, distance, elevation, speed, heart rate, device, and bike can be left empty when unknown. Do not estimate missing values; blank optional values are handled as unavailable data.

The `rides` table is also manageable with SQL in Neon’s SQL editor. For example, inspect recent rides with:

```sql
SELECT id, ride_date, distance, elevation, bike
FROM rides
ORDER BY ride_date DESC, id DESC
LIMIT 20;
```

## Samsung Health reader and export

The Android prototype in **android/** reads cycling exercise sessions from Samsung Health and lets you preview them before saving an export. It does not connect to Neon or upload anything.

- JSON includes ride summaries and ordered GPS points when Samsung Health has them and route access is granted.
- CSV includes summaries only.
- Samsung's available session duration, elapsed start-to-end time, distance, elevation, calories, speed, and heart-rate values are kept as separate fields. Moving time is exported as unavailable because this API does not provide it.
- Declining route permission still allows ride summaries to be read and exported.
- Source record IDs and deterministic fingerprints are included to support later de-duplication.

### Build and use the Android prototype

1. Install Android Studio with Android SDK Platform 35 and a Java 17 or newer JDK.
2. Download the Samsung Health Data SDK from [Samsung Developer](https://developer.samsung.com/health/data/overview.html). Review and accept Samsung's SDK license yourself, then copy its API AAR file into **android/app/libs/**. That licensed binary is ignored by Git and must not be committed.
3. Install Gradle 8.13, then run **gradle wrapper --gradle-version 8.13** from the **android/** directory to create the project wrapper. See the [Gradle wrapper guide](https://docs.gradle.org/current/userguide/gradle_wrapper.html).
4. Open the **android/** directory in Android Studio and sync the Gradle project.
5. Use a physical Android 10+ phone with Samsung Health 6.30.2 or newer installed and set up. Samsung Health Data SDK does not support Android emulators. In Samsung Health, open **Settings → About Samsung Health**, tap the version line quickly 10 times, then enable **Developer Mode (Samsung Health Data SDK) → Data Read**. See Samsung's [developer mode guide](https://developer.samsung.com/health/data/guide/developer-mode.html).
6. Run the app on the phone. Choose a date range, tap **Fetch rides**, and grant exercise access. GPS access is requested separately and is optional.
7. Review the ride list, then save JSON for routes or CSV for summaries using the file picker.

The first build is for local testing. Samsung requires app verification before public distribution; see its [verification guide](https://developer.samsung.com/health/data/guide/app-verification.html). Check the exported data against known rides before any upload work is started. GPS tracks in JSON contain the recorded coordinates exactly.

## Dashboard features

- Overview of ride distance, elevation, frequency, pace, recent activity, and personal records.
- Calendar heatmap, weekly and monthly trends, and ride-by-ride exploration.
- Bike, consistency, goal, performance, terrain, time-of-day, and heart-rate views.
- Search, sorting, filters, favorites, ride details, and CSV export.
- Light and dark themes, six accent palettes, and personal goals saved in the browser.
- Responsive layouts, keyboard-friendly controls, and reduced-motion support.

Some analytics need complete source data. For example, hour-of-day charts need a real start time; date-only rides stay date-only rather than receiving an invented time.

## Database and deployment setup

The production deployment uses Neon PostgreSQL through the Vercel Marketplace integration. Vercel provides the server with `DATABASE_URL` for the environments selected in the integration. The application does not need or use Google Sheets.

To connect a new deployment:

1. Add Neon to the Vercel project from the Vercel Marketplace and choose the required environments (Production, and Preview if desired).
2. Confirm the project has a `DATABASE_URL` environment variable. Keep it server-side; do not add it to frontend code or a `VITE_` variable.
3. Create the `rides` table using [`db/schema.sql`](db/schema.sql), or run the CSV importer below, which creates the table if needed.
4. Deploy the app and open `/api/health`. A working connection returns `databaseReady: true` and a `rideCount`.

The existing production app is at [sparshrides.vercel.app](https://sparshrides.vercel.app). Useful live checks:

- [Database health and ride count](https://sparshrides.vercel.app/api/health)
- [Read-only ride data API](https://sparshrides.vercel.app/api/rides)

## Initial CSV import

Use the importer to load or intentionally replace the initial dataset. It validates the full file before modifying the table. The `--replace` flag is required because this operation truncates existing rows and resets generated IDs. **Do not run this command just to add one new ride**; use the Neon table editor instead.

1. Install the project dependencies as described under [Local development](#local-development).
2. Create a `.env.local` file in the project root containing your Neon connection string:

   ```dotenv
   DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
   ```

3. Run the importer with the CSV path:

   ```bash
   npm run db:import -- --replace "/path/to/Strava dataset.csv"
   ```

The importer reports the number of imported rows without printing the ride contents or database connection string. Never commit `.env.local` or paste a database URL into source code.

## Local development

Requirements: Node.js and npm.

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite serves the frontend and proxies `/api` requests to the local Express server. Set `DATABASE_URL` in `.env.local` if the local app should read your Neon database. Without it, the server starts but the ride API reports that PostgreSQL is not configured.

Useful commands:

```bash
npm run build       # type-check and create the production frontend in public/
npm run typecheck   # TypeScript checks only
npm start           # run the production Express app locally
npm run db:import -- --replace "/path/to/rides.csv"  # replace all database rows
```

## Data model

The importer expects a CSV with these exact headers, in this order:

| CSV header | Database column | Meaning |
| --- | --- | --- |
| `Date` | `ride_date`, `start_time` | `YYYY-MM-DD` or `DD/MM/YYYY`, optionally followed by a time |
| `Elapsed_Time` | `elapsed_time` | Total elapsed duration |
| `Moving_Time` | `moving_time` | Moving duration |
| `Distance` | `distance` | Kilometres |
| `Elevation` | `elevation` | Metres climbed |
| `Avg_Speed` | `avg_speed` | Average speed from the source |
| `Max_Speed` | `max_speed` | Maximum speed from the source |
| `Device` | `device` | Recording device |
| `HR_max` | `hr_max` | Maximum recorded heart rate |
| `HR_mean` | `hr_mean` | Average recorded heart rate |
| `Bike` | `bike` | Bike name |

PostgreSQL generates the `id`. `ride_date` is required; `start_time` and metric fields may be `NULL`. The schema and date index are in [`db/schema.sql`](db/schema.sql). Blank CSV values become `NULL`. CSV dates are interpreted as local calendar dates to avoid shifting a ride to another day.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/rides` | Returns the rows used by the dashboard. Public and read-only. Responses use `Cache-Control: no-store`. |
| `GET /api/health` | Reports whether the database is configured and reachable, and how many rides are present. It does not return credentials. |

## Project structure

| Path | Responsibility |
| --- | --- |
| `src/main.ts` | Navigation, views, charts, dashboard state, ride details, and CSV export |
| `src/analytics.ts` | Ride normalization and derived analytics |
| `src/data.ts` | Loads ride rows from the application API |
| `src/types.ts` | Shared ride and analytics types |
| `src/styles.css` | Themes, responsive components, and animation system |
| `server/index.js` | Express API and server-side Neon queries |
| `db/schema.sql` | PostgreSQL table and index definition |
| `scripts/import-csv.js` | Validated, explicit CSV replacement import |
| `vercel.json` | Vercel build and function configuration |

## Troubleshooting

- **Dashboard says the database is not configured:** confirm `DATABASE_URL` is available to the Vercel Production environment, then redeploy.
- **Health check says the database is not ready:** confirm the database is reachable and the `rides` table exists. Open the Vercel function logs for server-side error details.
- **The ride count is zero or a ride is missing:** check the Neon `rides` table and confirm the row was saved. Press **Sync** or reload the dashboard.
- **Changes are not visible yet:** the open page checks about once a minute; use **Sync** to fetch immediately. API responses are not cached.
- **A view is empty:** some charts require optional source values. Date-only rows, for example, do not appear in time-of-day analytics.
