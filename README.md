# RideScope

RideScope is a cycling analytics dashboard for a Strava activity export stored in PostgreSQL. The browser calls a read-only API on the app server; database credentials never enter the client bundle.

## Features

- Overview of distance, climbing, ride frequency, and personal records.
- Calendar heatmap based on distance ridden.
- Ride explorer with search, filters, sorting, favorites, details, and CSV export.
- Bike, performance, weekly, monthly, and heart-rate analytics.
- Browser-stored personal goals, light/dark themes, and six color palettes.
- Responsive layout with keyboard and reduced-motion support.

## Data flow

```text
CSV export ── one-time import ──► PostgreSQL (Neon)
                                       │
                                       ▼
                              RideScope server
                                       │
                             public read-only API
                                       ▼
                                  Dashboard
```

The dashboard API is public and returns ride rows to every visitor. Keep only data in the database that you are comfortable showing on the deployed site. The database itself stays protected by its server-side connection string. There are no visitor accounts or write endpoints.

## Connect PostgreSQL on Vercel

RideScope uses Neon Postgres, which can be added to a Vercel project through the [Vercel Marketplace](https://vercel.com/marketplace/neon/neon). The integration makes the database available to the project as `DATABASE_URL`.

1. In the Vercel dashboard, open this project and add Neon from **Storage** or the Marketplace. Choose the project and environments that should get the database connection.
2. Confirm that `DATABASE_URL` is available for **Production**. If you want Preview deployments to work too, include **Preview**.
3. In the Neon console, open the SQL editor. You can inspect and manage the imported rows there with ordinary SQL, for example `SELECT * FROM rides ORDER BY ride_date;`.
4. After the import below, redeploy the Vercel app so Production uses the new code and database environment variable.

Vercel's storage integrations provision databases and inject their credentials as environment variables. See [Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage) and [Neon on Vercel](https://vercel.com/marketplace/neon/neon).

## Import the CSV

The importer accepts the supplied Strava CSV format and creates the `rides` table if it does not exist. Use it once to seed the initial 223 rides. It replaces the rows already in that table, so it requires the explicit `--replace` flag. **Do not rerun it to add new rides**; enter those directly in the hosted table editor.

For a local import, put the pooled Neon connection string in `.env.local` (never commit this file):

```dotenv
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

Then run:

```bash
npm install
npm run db:import -- --replace "/path/to/Strava dataset.csv"
```

The command validates the CSV before changing the database and reports the number of imported rows. It does not print ride contents or the connection string. The table layout is also documented in [`db/schema.sql`](db/schema.sql).

After the initial import, add one ride per row in the Neon table editor. Fill in the ride fields and leave `id` blank; PostgreSQL generates it. The deployed app reads the database on page load, when you use **Sync**, and automatically checks for changes about once a minute while the page is open. Adding a ride does not require another import or deployment. You can view or edit the records in Neon, or run SQL such as `SELECT * FROM rides ORDER BY ride_date;`.

You can verify the connection and import at `/api/health`; it reports whether the database is configured and how many rides are present. `/api/rides` returns the rows used by the dashboard.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` requests to the Express server at `http://127.0.0.1:8787`. Set `DATABASE_URL` in `.env.local` to use your hosted database locally.

Useful commands:

```bash
npm run typecheck
npm run build
npm start
```

## CSV format

The importer expects these headers in this order:

| CSV column | Stored field | Meaning |
| --- | --- | --- |
| `Date` | `ride_date`, `start_time` | `DD/MM/YYYY` or `YYYY-MM-DD`, optionally with a clock time |
| `Elapsed_Time` | `elapsed_time` | Elapsed duration |
| `Moving_Time` | `moving_time` | Moving duration |
| `Distance` | `distance` | Distance in km |
| `Elevation` | `elevation` | Elevation gain in m |
| `Avg_Speed` | `avg_speed` | Average speed |
| `Max_Speed` | `max_speed` | Maximum speed |
| `Device` | `device` | Recording device |
| `HR_max` | `hr_max` | Maximum heart rate |
| `HR_mean` | `hr_mean` | Average heart rate |
| `Bike` | `bike` | Bike name |

Blank optional values are stored as SQL `NULL`. The current dataset has date-only rides, so the hour-of-day analysis remains empty until real start times are included in the source data.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/rides` | Reads the PostgreSQL `rides` table and returns the rows used by the dashboard. Public and read-only. |
| `GET /api/health` | Checks database configuration, table readiness, and ride count without revealing credentials. |

API responses are marked `no-store` so a manual refresh reads the latest database contents.
