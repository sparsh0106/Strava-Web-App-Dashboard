# RideScope project context

## Product

RideScope is a public cycling analytics dashboard for a Strava activity export held in the site owner's private Google Sheet. Visitors do not sign in. The public read-only `/api/rides` endpoint returns the rows displayed by the site, so only ride information intended for public viewing should be stored in that Sheet/range. The server reads the Sheet with a read-only service account through keyless Vercel Workload Identity Federation (WIF); the browser never receives Google credentials.

## Architecture and key files

- `server/index.js` reads the private ride Sheet server-side with Google Sheets API and provides `/api/rides` and `/api/health`. There is no visitor OAuth, session, sign-in logging, or logout flow.
- Root `index.js` exports the Express app to Vercel; `vercel.json` runs the build.
- Vite writes production assets to `public/` for Vercel's static asset CDN.
- `src/sheets.ts` calls the public app API and builds the client-side dataset.
- `src/analytics.ts` parses and normalizes ride rows and calculates summaries.
- `src/main.ts` owns navigation, dashboard state, views, charts, favorites, ride details, and CSV export.
- `src/types.ts` defines the shared ride and analytics types.
- `src/styles.css` contains the visual system, components, responsive layout, and motion preferences.
- `index.html` loads Google Sans from Google Fonts.

## Sheet columns

The default source range is columns `A:K`: date/time, elapsed time, moving time, distance in km, elevation in m, average speed, maximum speed, device, maximum heart rate, average heart rate, and bike name. The first row is a header. Dates are parsed as local calendar components to avoid UTC day shifts.

## Analytics behavior

- Mean and median use rides with recorded distance.
- Mode rounds distances to 0.1 km and appears only when there is a unique repeated value.
- Weekly and monthly averages divide recorded distance by active weeks/months in the selected scope.
- The seven-day daily average uses today plus the previous six local calendar days and divides by seven.
- Calendar heat and month totals are based on distance ridden.
- Selecting a calendar date opens `#ride-detail?date=YYYY-MM-DD` with that date's rides and available metrics.
- Cycle cards include average distance per ride; overview includes an interactive weekly distance chart.

## Visual and interaction direction

Google Sans is used throughout. The app has light and dark themes and six accent palettes (Ember, Ocean, Forest, Lavender, Rose, Citrus). Theme, palette, favorites, and personal goals are stored in browser `localStorage`. Layouts reflow for phones, preserve keyboard focus states, and respect reduced-motion settings.

## Privacy and configuration

The dashboard is public by design. The cycling Sheet itself stays private and is shared with the server's service account as Viewer. Its rows are exposed through `/api/rides`, so do not include fields that should remain private. No visitor account or email is collected. Use Vercel WIF instead of a stored service-account key, and do not commit `.env`, `.env.local`, or deployment credentials.

Required server settings are `STRAVA_SHEET_ID`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GCP_PROJECT_NUMBER`, `GCP_WORKLOAD_IDENTITY_POOL_ID`, and `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`. `STRAVA_SHEET_RANGE` optionally selects an explicit tab/range. The Vite client proxies `/api` to the local Express server during development.

## Vercel deployment

The `sparsh_rides` Vercel project uses `feature/ember-red-ui` as its Production Branch. Configure Vercel OIDC with a Google Cloud workload identity pool/provider. Allow only the intended Vercel production subject to impersonate the dedicated service account, grant it `roles/iam.workloadIdentityUser`, and share the ride Sheet with that account as Viewer. Never create or commit a service-account key.
