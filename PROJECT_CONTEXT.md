# RideScope project context

## Product

RideScope is a private cycling dashboard. It reads a Strava activity export from a Google Sheet through a Node/Express server. Google OAuth and Sheets access stay on the server; the browser receives normalized ride rows and calculates analytics locally. The Sheet is read-only.

## Architecture and key files

- `server/index.js` handles OAuth, sessions, health checks, and Google Sheets reads.
- Root `index.js` exports the Express app to Vercel; `vercel.json` runs the build.
- Vite writes production assets to `public/` for Vercel's static asset CDN.
- `src/sheets.ts` calls the app API and normalizes the returned dataset boundary.
- `src/analytics.ts` parses local dates, normalizes ride rows, and computes dataset and trend summaries.
- `src/main.ts` owns hash navigation, dashboard state, view rendering, charts, favorites, ride details, and CSV export.
- `src/types.ts` defines the shared ride and analytics types.
- `src/styles.css` contains the visual system, component styling, responsive layouts, and motion preferences.
- `index.html` loads the app and Roboto / Roboto Mono from Google Fonts.

## Sheet columns

The default source is columns `A:K`: date/time, elapsed time, moving time, distance in km, elevation in m, average speed, maximum speed, device, maximum heart rate, average heart rate, and bike name. The first row is a header. Date parsing uses local calendar components to avoid UTC day shifts.

## Analytics behavior

- Mean and median are calculated from rides with a recorded distance.
- Mode rounds distances to 0.1 km and is shown only when there is a unique repeated value.
- Weekly and monthly averages divide recorded distance by active weeks/months in the selected scope.
- The seven-day daily average uses today plus the preceding six local calendar days and divides by all seven days.
- Calendar heat is based on summed moving time by date; elapsed time is the fallback when moving time is missing.
- Selecting a calendar date opens `#ride-detail?date=YYYY-MM-DD`, which lists every ride and available metric for that date.
- Cycle cards include average distance per ride, calculated from rows with recorded distance.
- Overview includes an interactive weekly distance chart; chart marks expose hover tooltips.

## Visual and interaction direction

Use a light warm-white surface with charcoal text and a vermilion red accent. Roboto is the main typeface and Roboto Mono is reserved for compact numerical labels. Layouts should reflow for phones, preserve keyboard focus states, and respect reduced-motion settings. Keep cycling performance views centered on the recorded activity metrics and distance summaries.

Favorites and personal goals stay in browser `localStorage`. Never commit `.env` or credentials. The Vite client proxies API routes to the Express server during development.

## Vercel deployment

The `sparsh_rides` Vercel project uses `feature/ember-red-ui` as its Production Branch. The serverless-compatible session middleware keeps OAuth state and tokens in an authenticated-encryption, HTTP-only cookie, keyed by `SESSION_SECRET`; this avoids relying on instance memory. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `SESSION_SECRET`, and `STRAVA_SHEET_ID` in the Vercel project, then authorize `https://<deployment-host>/oauth2callback` as a redirect URI in the Google OAuth client. Do not put secrets in source control or build output.
