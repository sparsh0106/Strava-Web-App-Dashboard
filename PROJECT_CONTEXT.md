# RideScope project context

## Product

RideScope is a public cycling analytics dashboard for a Strava activity export stored in PostgreSQL. Visitors do not sign in. The public, read-only `/api/rides` endpoint returns the rows displayed by the site, so only ride information intended for public viewing should be stored in the database. The server uses `DATABASE_URL`; the browser never receives database credentials.

The API, health count, private analysis endpoint, CSV import, Samsung summary upload, and historical GPS matching include only rides whose distance is strictly greater than 5 km. Unknown or missing distances are excluded. Existing short rows remain in PostgreSQL but are filtered from the app.

## Architecture and key files

- `server/index.js` reads the PostgreSQL `rides` table server-side and provides `/api/rides` and `/api/health`.
- `db/schema.sql` defines the table and date index.
- `scripts/import-csv.js` validates and replaces the table contents from the supplied Strava CSV.
- Root `index.js` exports the Express app to Vercel; `vercel.json` runs the build.
- Vite writes production assets to `public/` for Vercel's static asset CDN.
- `src/data.ts` calls the public app API and builds the client-side dataset.
- `src/analytics.ts` parses and normalizes ride rows and calculates summaries.
- `src/main.ts` owns navigation, dashboard state, views, charts, favorites, ride details, and CSV export.
- `src/types.ts` defines the shared ride and analytics types.
- `src/styles.css` contains the visual system, components, responsive layout, and motion preferences.
- `index.html` loads Google Sans from Google Fonts.
- Samsung Health copies are linked through `samsung_route_links`; the API hides source rows mapped to a different canonical ride, preserving the canonical summary fields.
- Samsung sessions are eligible only when their SDK `dataSource.appId` is `com.sec.android.app.shealth`, they are not auto-detected, and their distance exceeds 5 km. Imported Strava activities and unknown-source sessions are excluded, preventing a planned GPX total from being counted with real segmented watch rides.
- `rides.source_app_id`, `samsung_route_links.source_app_id`, and route/sample `source_record_id` preserve source provenance. Historical source IDs without verified provenance are hidden from dashboard and private route analysis until the Android app refreshes their metadata.

## Data model

The CSV importer expects, in order: `Date`, `Elapsed_Time`, `Moving_Time`, `Distance`, `Elevation`, `Avg_Speed`, `Max_Speed`, `Device`, `HR_max`, `HR_mean`, and `Bike`. Date and time are stored separately. PostgreSQL generates each row's `id`, so manual entries through the table editor need no technical ID. Rows are queried by ID, keeping the import order stable.

Dates are parsed as local calendar components to avoid UTC day shifts. Blank optional numbers and text become SQL `NULL`. Date-only rows do not receive invented start times.

## Analytics behavior

- Mean and median use rides with recorded distance.
- Mode rounds distances to 0.1 km and appears only when there is a unique repeated value.
- Weekly and monthly averages divide recorded distance by active weeks/months in the selected scope.
- The seven-day daily average uses today plus the previous six local calendar days and divides by seven.
- Calendar heat and month totals are based on distance ridden.
- Selecting a calendar date opens `#ride-detail?date=YYYY-MM-DD` with that date's rides and available metrics.
- Cycle cards include average distance per ride; overview includes an interactive weekly distance chart.

## Visual and interaction direction

Google Sans is the default typeface, with eight selectable font faces (Google Sans, Inter, Plus Jakarta, Space Grotesk, Outfit, DM Sans, Fraunces editorial serif, and JetBrains Mono). The app has light and dark themes and twelve accent palettes (Ember, Ocean, Forest, Lavender, Rose, Citrus, Cobalt, Sunset, Emerald, Crimson, Aurora, and Slate). Theme, palette, font face, favorites, and personal goals are stored in browser `localStorage`. Layouts reflow for phones, preserve keyboard focus states, and respect reduced-motion settings.

## Privacy and configuration

The deployed dashboard is public by design. The `rides` table is not directly accessible from the browser, but the public `/api/rides` endpoint exposes all rows to visitors. No visitor account or email is collected. Keep the database connection string out of source control and Vite client code; configure `DATABASE_URL` in `.env.local` for local development and Vercel Environment Variables for deployment. The client fetches on page load and manual Sync, then checks for updates once per minute while visible.

## Vercel deployment

The Vercel project should connect to a Neon PostgreSQL database through the Vercel Marketplace integration. The integration provides `DATABASE_URL` to the selected deployment environments. After connecting it or importing updated ride data, redeploy and check `/api/health` for database readiness and ride count.
