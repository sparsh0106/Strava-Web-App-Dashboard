# RideScope project context

## Product

RideScope is a cycling dashboard for a Strava activity export in the site owner's Google Sheet. Visitors sign in with their own Google accounts using identity-only OAuth scopes. A server-owned service account reads the owner's ride Sheet and appends each successful visitor sign-in (verified email and UTC timestamp) to a separate log spreadsheet. The browser receives ride rows and calculates analytics locally; it never receives Google API credentials.

## Architecture and key files

- `server/index.js` verifies Google ID tokens, handles encrypted sessions, appends sign-in rows, reads the cycling Sheet with a server service account, and serves health checks.
- Root `index.js` exports the Express app to Vercel; `vercel.json` runs the build.
- Vite writes production assets to `public/` for Vercel's static asset CDN.
- `src/sheets.ts` calls the app API and normalizes the returned dataset boundary.
- `src/analytics.ts` parses local dates, normalizes ride rows, and computes dataset and trend summaries.
- `src/main.ts` owns hash navigation, dashboard state, view rendering, charts, favorites, ride details, and CSV export.
- `src/types.ts` defines the shared ride and analytics types.
- `src/styles.css` contains the visual system, component styling, responsive layouts, and motion preferences.
- `index.html` loads the app and Google Sans from Google Fonts.

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

Use a warm light surface or a charcoal dark surface with a vermilion red accent. Google Sans is used throughout, including compact numerical labels. The light/dark theme toggle persists the user's choice in browser `localStorage`; light is the default. Layouts should reflow for phones, preserve keyboard focus states, and respect reduced-motion settings. Keep cycling performance views centered on the recorded activity metrics and distance summaries.

Favorites, personal goals, and theme preference stay in browser `localStorage`. Never commit `.env`, `.env.local`, OAuth secrets, or deployment credentials. The app uses keyless workload identity rather than a stored service-account key. Share the cycling spreadsheet with the service account as Viewer and use a separate spreadsheet for sign-in logs, shared as Editor. The Vite client proxies API routes to the Express server during development.

## Vercel deployment

The `sparsh_rides` Vercel project uses `feature/ember-red-ui` as its Production Branch. The serverless-compatible session middleware keeps OAuth state, nonce, and verified identity in an authenticated-encryption, HTTP-only cookie, keyed by `SESSION_SECRET`; this avoids relying on instance memory. Configure Google Workload Identity Federation between Vercel OIDC and a dedicated Google service account; do not create or store a service-account key. Set the service account email, Cloud project number, workload identity pool/provider IDs, cycling Sheet ID, and separate sign-in log Sheet ID in Vercel. Share the cycling Sheet with the service account as Viewer and the log Sheet as Editor. Authorize `https://<deployment-host>/oauth2callback` as a redirect URI in the Google OAuth client. Do not put secrets in source control or build output.
