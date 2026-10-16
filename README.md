# RideScope

RideScope is a cycling analytics dashboard for a Strava activity export stored in a Google Sheet. The dashboard opens directly; visitors do not need to sign in, and the site does not collect visitor Google accounts or emails.

The Google Sheet stays private. The server reads it with a dedicated, read-only service account through Vercel Workload Identity Federation (WIF). Ride rows are then served by the public dashboard API, so anyone who can visit the site can view the ride data shown in the dashboard.

## Features

- Overview of distance, climbing, ride frequency, and personal records.
- Calendar heatmap based on distance ridden.
- Ride explorer with search, filters, sorting, favorites, details, and CSV export.
- Bike, performance, weekly, monthly, and heart-rate analytics.
- Browser-stored personal goals, light/dark themes, and six color palettes.
- Responsive layout with keyboard and reduced-motion support.

## How data access works

```text
Private cycling Sheet
        │ read-only, server-side WIF
        ▼
RideScope server ── public read-only /api/rides ──► Dashboard
```

There is no visitor OAuth flow, session cookie, sign-in log, or Google sign-out button. The browser never receives Google credentials. Since the dashboard API is public, the rows it returns should only contain ride information you are comfortable sharing publicly.

## Requirements

- Node.js 20 or newer
- A Google Cloud project with the Google Sheets API, Security Token Service API, and IAM Service Account Credentials API enabled
- A Google Sheet with the ride data
- A Google service account and Vercel OIDC workload identity federation

The service account only needs **Viewer** access to the cycling Sheet. Do not create or store a service-account key. Configure keyless access using the [Vercel GCP OIDC guide](https://vercel.com/docs/oidc/gcp).

## Configuration

Copy `.env.example` to `.env` and configure:

```dotenv
STRAVA_SHEET_ID=your-cycling-data-spreadsheet-id
STRAVA_SHEET_RANGE=
GCP_SERVICE_ACCOUNT_EMAIL=ridescope-server@your-project.iam.gserviceaccount.com
GCP_PROJECT_NUMBER=123456789012
GCP_WORKLOAD_IDENTITY_POOL_ID=vercel
GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=vercel
```

Set these values in the Vercel project for the production deployment as well. Configure the Google workload identity provider to trust the Vercel project’s production subject and grant that identity `roles/iam.workloadIdentityUser` on the service account. Share the cycling Sheet with that service account as Viewer. Keep `.env` and `.env.local` out of source control.

If workload identity or the Sheet ID is missing, `/api/rides` will return a configuration error. The dashboard itself no longer asks visitors to sign in.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite client proxies `/api` requests to the Express server at `http://localhost:8787`. The ride API needs valid server-side Google Sheets access to load data.

Useful commands:

```bash
npm run typecheck
npm run build
npm start
```

## Google Sheet format

By default, RideScope reads columns `A:K` from the first tab. The first row is a header.

| Column | Meaning |
| --- | --- |
| A | Ride date, optionally with start time |
| B | Elapsed time |
| C | Moving time |
| D | Distance in km |
| E | Elevation gain in m |
| F | Average speed |
| G | Maximum speed |
| H | Device |
| I | Maximum heart rate |
| J | Average heart rate |
| K | Bike name |

Dates in `DD/MM/YYYY` and `YYYY-MM-DD` formats are supported. Date-only rows work; the hour-of-day view needs a recorded start time.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/rides` | Reads the configured Sheet and returns the rows used by the dashboard. Public and read-only. |
| `GET /api/health` | Reports server health and whether Sheet access is configured. |

API responses are marked `no-store` so a manual sync reads the latest Sheet contents.
