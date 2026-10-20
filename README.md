# RideScope

RideScope turns Strava exports and Samsung Health rides into a polished, interactive cycling dashboard. Ride records live in Neon PostgreSQL, the server reads them through a private connection, and the website refreshes its view automatically.

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

> **Privacy:** The dashboard's ride summaries remain public through `GET /api/rides`. Exact GPS coordinates and timestamped heart-rate, speed, cadence, and power samples are served only by a password-protected private analysis API. Set `ROUTE_VIEW_PASSWORD` in Vercel Production to enable it. No third-party map provider receives route coordinates.

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

The Android app in **android/** reads Samsung Health cycling sessions and uploads new rides to the server-side API. New rides store summaries in `rides`, ordered GPS points in `ride_route_points`, and measured workout samples in `ride_exercise_samples`. Samsung source IDs make these uploads idempotent. If route access is declined, summaries still sync; a later sync with route access fills in route data. Historical reconciliation is separate: **Sync previous GPS routes only** checks every Samsung session, including sessions without GPS, against existing RideScope rides by start time and distance. Confirmed Samsung copies are linked to the existing row and hidden from the dashboard; available GPS points are attached to that row. It skips unmatched or ambiguous sessions, does not create ride rows, and never changes distance, speed, heart rate, or any other summary field. Near-identical Samsung records from the same workout are coalesced before upload, while all their Samsung source IDs are retained so old duplicate rows can be hidden together.

Samsung provides a session duration plus start and end timestamps, but no separate moving-time field. RideScope uses the start/end difference for `Elapsed_Time` and Samsung's session duration for `Moving_Time`. Synced Samsung sessions are labeled `Device = Watch` and `Bike = Fuji`; distance is stored in kilometres, elevation in metres, and speeds in kilometres per hour. Heart-rate fields use Samsung's mean and maximum values. Missing Samsung metrics remain unavailable. Individual ride analysis shows summary values, an exact route map, GPS-derived elevation profile, and any heart-rate, speed, cadence, or power samples Samsung recorded. The precise route and sample charts require the private-view password; the server uses a short-lived HttpOnly cookie and does not send coordinates to a map tile service.

### Configure and run the Android app

1. Open **android/** in Android Studio and sync Gradle. The project uses the Samsung Health Data SDK AAR at **android/app/libs/** and includes its Kotlin Parcelize and Gson runtime dependencies; the licensed AAR is ignored by Git. If the local copy is missing, download the SDK from [Samsung Developer](https://developer.samsung.com/health/data/overview.html), accept its terms, and copy the API AAR into that folder.
2. Use a physical Android 10+ Samsung phone with Samsung Health 6.30.2 or later. Samsung Health Data SDK does not support emulators. Enable **Developer Mode (Samsung Health Data SDK) → Data Read** in Samsung Health; see Samsung's [developer mode guide](https://developer.samsung.com/health/data/guide/developer-mode.html).
3. In the Vercel project, add `SYNC_TOKEN` to the Production environment. Use a long random value and keep it private. The server also needs its existing `DATABASE_URL` Neon integration.
4. Run `npm run db:migrate-samsung` once against the same Neon database configured for Vercel, with `DATABASE_URL` set in `.env.local`. It adds source metadata, route points, and workout-sample storage without deleting existing rides. If you prefer Neon SQL Editor, run [`db/schema.sql`](db/schema.sql) there.
5. Add a strong random `ROUTE_VIEW_PASSWORD` (at least 16 characters; 32+ recommended) to the Vercel Production environment. This is separate from `SYNC_TOKEN`. Re-deploy after setting the environment variables. The Android app uses `https://sparshrides.vercel.app/api/sync/samsung`.
6. Run the app and grant Samsung exercise access; grant route access if you want GPS tracks.
7. Paste the same `SYNC_TOKEN` into the app and enable **Automatic sync**. The token is encrypted at rest with Android Keystore. On first enable, rides from earlier dates in the last 30 days are treated as history; today's rides remain eligible for upload.
8. Tap **Sync previous GPS routes only** to reconcile historical Samsung sessions with existing RideScope rides and attach any missing GPS points. Grant Samsung exercise-location access when asked. This also hides confirmed duplicate Samsung rows, even when a copy has no GPS. It leaves existing ride summary fields unchanged and reports unmatched or ambiguous sessions.
9. WorkManager checks for new rides about every 15 minutes while the app is closed, and Android may delay checks for battery saving. Android's periodic work minimum is 15 minutes, so reliable five-minute background polling isn't supported by the standard scheduler. **Check for new rides now** runs an immediate check.

Samsung requires app verification before public distribution; see its [verification guide](https://developer.samsung.com/health/data/guide/app-verification.html). Local testing on your own phone can use Samsung Health developer mode.

## Dashboard features

- Overview of ride distance, elevation, frequency, pace, recent activity, and personal records.
- Calendar heatmap, weekly and monthly trends, and ride-by-ride exploration.
- Bike, consistency, goal, performance, terrain, time-of-day, and heart-rate views.
- Search, sorting, filters, favorites, ride details, and CSV export.
- Individual ride analysis with measured workout charts, an exact private route map, and route elevation profile.
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
| `POST /api/route-access` | Checks `ROUTE_VIEW_PASSWORD` and sets a short-lived HttpOnly private-analysis session cookie. |
| `POST /api/route-access/logout` | Clears the private-analysis session cookie. |
| `GET /api/rides/:id/analysis` | Returns exact GPS points and actual workout samples. Requires the private-analysis session cookie. |
| `GET /api/health` | Reports whether the database is configured and reachable, and how many rides are visible after confirmed Samsung duplicates are hidden. It does not return credentials. |
| `POST /api/sync/samsung` | Upserts Samsung ride summaries, route points, and recorded exercise samples. Requires `Authorization: Bearer <SYNC_TOKEN>`. |
| `POST /api/sync/samsung/routes` | Matches Samsung history (including sessions without GPS) to existing rides, links confirmed duplicate source rows, and inserts available route points only; ride summaries are never changed. Requires `Authorization: Bearer <SYNC_TOKEN>`. |

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
| `scripts/migrate-samsung.js` | Safe additive migration for Samsung metadata, route points, and measured exercise samples |
| `scripts/import-csv.js` | Validated, explicit CSV replacement import |
| `vercel.json` | Vercel build and function configuration |

## Troubleshooting

- **Dashboard says the database is not configured:** confirm `DATABASE_URL` is available to the Vercel Production environment, then redeploy.
- **Health check says the database is not ready:** confirm the database is reachable and the `rides` table exists. Open the Vercel function logs for server-side error details.
- **Android reports that the Samsung upload endpoint was not found (HTTP 404):** the deployed Vercel project is running server code without `POST /api/sync/samsung`. Deploy the latest repository version to the Production environment, then use **Check for new rides now** or wait for the next background check.
- **The ride count is zero or a ride is missing:** check the Neon `rides` table and confirm the row was saved. Press **Sync** or reload the dashboard.
- **Changes are not visible yet:** the open page checks about once a minute; use **Sync** to fetch immediately. API responses are not cached.
- **A view is empty:** some charts require optional source values. Date-only rows, for example, do not appear in time-of-day analytics.

---

## 👤 Author

**Sparsh Agarwal** — [GitHub](https://github.com/sparsh0106) · [LinkedIn](https://www.linkedin.com/in/sparsh-agarwal-4b443b304/)
