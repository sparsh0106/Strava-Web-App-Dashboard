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

## Samsung Health sync

The Android app in **android/** reads Samsung Health cycling sessions, previews them, and uploads selected date ranges to the server-side API. The API writes summaries to `rides` and ordered GPS samples to `ride_route_points` in Neon. Existing Strava rows remain intact. Samsung source IDs make uploads idempotent: retrying a batch updates the same ride rather than adding a duplicate. If route permission is declined, summaries still sync; a later sync with route access fills in the route.

Samsung supplies moving time as unavailable, so it remains blank. The app does not infer missing metrics. Recorded GPS points are stored exactly in Neon. The dashboard currently displays the ride summaries; route points are not exposed by a public route endpoint yet.

### Configure and run the Android app

1. Open **android/** in Android Studio and sync Gradle. The project uses the Samsung Health Data SDK AAR at **android/app/libs/** and includes its Kotlin Parcelize and Gson runtime dependencies; the licensed AAR is ignored by Git. If the local copy is missing, download the SDK from [Samsung Developer](https://developer.samsung.com/health/data/overview.html), accept its terms, and copy the API AAR into that folder.
2. Use a physical Android 10+ Samsung phone with Samsung Health 6.30.2 or later. Samsung Health Data SDK does not support emulators. Enable **Developer Mode (Samsung Health Data SDK) → Data Read** in Samsung Health; see Samsung's [developer mode guide](https://developer.samsung.com/health/data/guide/developer-mode.html).
3. In the Vercel project, add `SYNC_TOKEN` to the Production environment. Use a long random value and keep it private. The server also needs its existing `DATABASE_URL` Neon integration.
4. Run `npm run db:migrate-samsung` once against the same Neon database configured for Vercel, with `DATABASE_URL` set in `.env.local`. It adds source metadata and the route-points table without deleting existing rides. If you prefer Neon SQL Editor, run [`db/schema.sql`](db/schema.sql) there.
5. Re-deploy after setting the Vercel environment variable. The Android app uses `https://sparshrides.vercel.app/api/sync/samsung`.
6. Run the app, choose the date range, tap **Fetch rides**, and grant Samsung exercise access. Grant route access if you want GPS tracks.
7. Paste the same `SYNC_TOKEN` into the app and tap **Sync**. It is encrypted at rest with Android Keystore. The app uploads batches of 20, and interrupted batches can be retried safely.

Samsung requires app verification before public distribution; see its [verification guide](https://developer.samsung.com/health/data/guide/app-verification.html). Local testing on your own phone can use Samsung Health developer mode.

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
3. Create the `rides` table using [`db/schema.sql`](db/schema.sql), or run the CSV importer below, which creates the table if needed. Run `npm run db:migrate-samsung` to add Samsung sync columns and route storage.
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
| `POST /api/sync/samsung` | Upserts Samsung ride summaries and route points. Requires `Authorization: Bearer <SYNC_TOKEN>`; route data is stored in `ride_route_points`. |

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

---

## 👤 Author

**Sparsh Agarwal** — [GitHub](https://github.com/sparsh0106) · [LinkedIn](https://www.linkedin.com/in/sparsh-agarwal-4b443b304/)
