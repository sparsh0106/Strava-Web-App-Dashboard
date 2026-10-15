# RideScope

**RideScope** is a private, interactive cycling analytics dashboard for a Strava activity export stored in a personal Google Sheet.

It turns a simple Sheet into a clear command center for distance, climbing, consistency, performance, bike usage, and ride-level exploration. The Google OAuth exchange and Sheet API calls stay on the Node server; the browser only receives the rows needed to calculate local analytics.

---

## What it does

RideScope currently includes:

- **Overview command center** with key stats, interactive weekly distance bars, seasonal rhythm, recent rides, and personal records.
- **Interactive annual calendar** whose red heatmap measures daily ride time; selecting a date opens a shareable ride-details page.
- **Distance analytics** with mean, median, mode, active-week and active-month averages, and a seven-day daily average through today.
- **Bike analysis** with distance share, ride counts, average distance per ride, speed, elevation, and bike-specific ride filtering.
- **Consistency analysis** with current and historical 3+ day streaks.
- **Weekly and monthly pattern views** built from timezone-safe local calendar dates.
- **Speed/elevation profile** with binned terrain analysis and elevation-per-kilometer statistics.
- **Heart-rate zone view** for rows that contain average HR.
- **Ten-ride rolling progression metrics** for average speed, moving time, and cumulative distance.
- **Ride explorer** with search, bike filters, sorting, pagination, favorites, detail drawers, and CSV export.
- **Personal goals** for distance, ride count, and elevation. Goals are stored in the browser and never written to the Sheet.
- **Data-quality panel** showing coverage for distance, elevation, HR, moving time, and optional start time.
- **Responsive mobile navigation**, accessible labels and focus states, and reduced-motion support.

The application is intentionally dependency-light: the charts and interaction layer use browser-native SVG, CSS, and DOM APIs.

## Visual system

RideScope uses a **light vermilion** visual language: warm white surfaces, charcoal text, and confident red accents inspired by Strava’s activity dashboard. Layouts reflow for phone screens, with touch-sized controls and scrollable data tables.

The interface uses a familiar Google-style type system from Google Fonts:

- **Roboto** for headings, navigation, metrics, and body copy
- **Roboto Mono** for compact measurements and chart labels

The CSS includes system fallbacks for both families, so the dashboard remains usable if font loading is delayed or unavailable.

---

## Architecture

```text
Google OAuth
     │
     ▼
Node/Express server ── Google Sheets API (read-only)
     │
     ▼
Normalized ride rows
     │
     ▼
TypeScript analytics engine
     │
     ▼
Vite browser UI + SVG/CSS visualizations
```

### Project layout

```text
.
├── index.html                 Browser entry document
├── PROJECT_CONTEXT.md         Durable product and implementation context
├── server/index.js            OAuth, Sheet API, session, production server
├── src/
│   ├── analytics.ts           Parsing, normalization, and derived analytics
│   ├── main.ts                State, views, interactions, and rendering
│   ├── sheets.ts              Browser API client
│   ├── styles.css             Design system, layout, motion, responsive rules
│   └── types.ts               Shared domain types
├── .env.example               Safe configuration template
├── package.json               Development and build scripts
└── vite.config.ts             Vite + Tailwind + development proxy
```

---

## Requirements

- Node.js 20 or newer
- A Google Cloud project
- A Google Sheet containing a Strava activity export
- A Google OAuth 2.0 **Web application** client

The Sheet is read-only from the application’s perspective. The app does not write rides, goals, or settings back to Google Sheets.

---

## Google Cloud and OAuth setup

1. Create or select a Google Cloud project.
2. Enable the **Google Sheets API**.
3. Configure the OAuth consent screen.
4. Create an OAuth 2.0 client ID with application type **Web application**.
5. Add this local redirect URI:

   ```text
   http://localhost:8787/oauth2callback
   ```

6. Copy `.env.example` to `.env`.
7. Fill in the OAuth and Sheet values:

   ```dotenv
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=http://localhost:8787/oauth2callback
   SESSION_SECRET=use-a-long-random-value
   STRAVA_SHEET_ID=your-spreadsheet-id
   # Optional: pin a specific tab/range. Leave blank to use the first tab.
   STRAVA_SHEET_RANGE=
   ```

8. Make sure the Google account used for OAuth has access to the configured Sheet.

The OAuth client secret is only read by the Node server. It is never bundled into the Vite frontend.

---

## Local development

Install dependencies:

```bash
npm install
```

Start both the Vite client and the API server:

```bash
npm run dev
```

Open:

- Frontend: `http://localhost:5173`
- API/OAuth server: `http://localhost:8787`

Vite proxies `/auth`, `/oauth2callback`, `/api`, and `/logout` to the Node server.

Useful checks:

```bash
npm run typecheck
npm run build
npm run check
```

`npm run check` runs the TypeScript check and a production Vite build.

---

## Production

Build the frontend:

```bash
npm run build
```

Start the combined server:

```bash
npm start
```

The production Express server serves both `dist/` and the API from one origin. The `start` script is cross-platform and sets `NODE_ENV=production` before loading the server.

---

## Source Sheet format

The default range is the first tab, columns `A:K`:

| Column | Meaning | Example |
| --- | --- | --- |
| A | Ride date, optionally followed by time | `04/07/2025 06:35` |
| B | Elapsed time | `01:42:18` |
| C | Moving time | `01:31:05` |
| D | Distance (km) | `42.73` |
| E | Elevation gain (m) | `684` |
| F | Average speed (km/h) | `28.1` |
| G | Maximum speed (km/h) | `51.8` |
| H | Device | `Garmin Edge 830` |
| I | Maximum heart rate | `176` |
| J | Average heart rate | `148` |
| K | Bike name | `Firefox MTB` |

The first row is treated as a header. Date-only rows are fully supported. If column A includes a clock time, RideScope enables the hour-of-day view; otherwise that page explains why it remains intentionally blank rather than fabricating a time.

Both `DD/MM/YYYY` and `YYYY-MM-DD` date prefixes are recognized. Dates are parsed into local calendar components so weekday and month analytics do not drift because of UTC parsing.

---

## Analytics notes

### Distance summary definitions

- **Mean and median** use recorded ride distances; rows with a missing distance are excluded.
- **Mode** groups distances to the nearest 0.1 km and displays a value only when it is the unique most common repeated distance.
- **Weekly and monthly averages** divide the recorded distance total by the number of active calendar weeks or months in the selected scope.
- **Seven-day average** is the total distance from today and the previous six local calendar days divided by seven, so rest days count as zero-distance days.
- **Calendar heat** sums moving time for each day. If moving time is missing, elapsed time is used for that ride.

### Rolling progression

The progression view uses the current ride and up to nine previous rides. This rolling ten-ride window is less noisy than a single-ride comparison. Cumulative distance is shown separately to preserve training-volume context.

### Data quality

Missing values are preserved as missing rather than silently converted to zero. The rail reports coverage for distance, elevation, heart rate, moving time, and optional start time.

---

## Browser-only behavior

The following preferences are stored in `localStorage` and never leave the browser:

- Favorite ride IDs
- Personal goal targets

The current page is represented in the URL hash, so browser Back/Forward navigation works between dashboard views.

CSV export respects the active year/all-time scope, bike filter, search query, and sort order. The export is generated locally in the browser.

---

## API endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/auth/status` | Reports whether the session has Google tokens. |
| `GET /auth/google` | Starts the Google OAuth flow. |
| `GET /oauth2callback` | Validates OAuth state and exchanges the code. |
| `GET /api/rides` | Reads the configured Sheet and returns rows plus sync time. |
| `POST /logout` | Destroys the current session. |
| `GET /api/health` | Lightweight server health check. |

API responses are marked `no-store` so a sync does not get confused with a cached response.

---

## Privacy and production hardening

The default development setup uses Express’s in-memory session store. Before deploying publicly:

- Store `SESSION_SECRET` in a secret manager.
- Replace the in-memory session store with Redis, Postgres, or another durable store.
- Restrict the OAuth consent screen to the intended account or Workspace domain.
- Use HTTPS and set the production environment securely.
- Keep `.env` out of source control; it is already ignored.
- Consider encrypting OAuth tokens if they are moved out of the session store.
- Add rate limiting and centralized request logging at the deployment edge.

The frontend never receives the Google OAuth client secret.

---

## Browser support and accessibility

The dashboard works in modern evergreen browsers. Enhancements are progressive:

- View Transitions are used when supported.
- `prefers-reduced-motion` disables nonessential animation.
- Focus-visible outlines, semantic landmarks, labels, and Escape-to-close behavior are included.
- Charts expose labels/tooltips and remain understandable without animation.

---

## Troubleshooting

### The app asks to connect again

The OAuth session may have expired or the server may have restarted while using the in-memory session store. Sign in again, or configure a durable session store for production.

### The Sheet loads but no rides appear

Check that:

- The first row is a header.
- Column A contains valid dates.
- The date format is recognized.
- The Sheet contains values in the expected columns.
- The selected Google account can access the Sheet.

Then use **Sync** in the top bar.

### Hour-of-day is blank

This is expected when column A contains dates without clock times. Add a time to the source date or add a dedicated time column and extend the normalizer before relying on that view.

---

## Development workflow

Work on a feature branch, keep commits focused, and run the checks before pushing:

```bash
git switch -c feature/your-change
npm run check
git add <files>
git commit -m "feat: describe the change"
git push -u origin feature/your-change
```

Recommended commit prefixes:

- `feat:` — new user-facing functionality
- `fix:` — bug fix
- `refactor:` — internal cleanup without behavior change
- `docs:` — documentation and project guidance
- `chore:` — tooling or maintenance

Do not commit `.env`, OAuth secrets, session secrets, or generated `dist/` files.
