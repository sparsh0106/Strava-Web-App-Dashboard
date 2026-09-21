# Strava Sheets Dashboard

A TypeScript + Vite dashboard backed by your private Google Sheet.

## Architecture

Google Sheets → Node OAuth/API layer → TypeScript analytics engine → browser UI

The analytics engine computes:

- yearly / monthly activity
- 3+ day consistency streaks
- bike analysis
- Cycling Fitness Index (CFI)
- ride-level exploration
- all-12-month calendar view

The UI keeps the three runtime technologies:

- WebGPU progressive-enhancement background
- View Transition API page changes
- Pointer / spring physics on KPI cards

## Your Sheet

Spreadsheet ID is already configured in `.env.example`:

`1ystGRESsSCnH5v6IBgA52GSH0G0UB1zk6f1v96fl7_o`

The server discovers the first tab automatically unless `STRAVA_SHEET_RANGE` is set.

## Google Cloud setup

1. Create/select a Google Cloud project.
2. Enable the Google Sheets API.
3. Configure the OAuth consent screen.
4. Create an OAuth 2.0 Client ID of type **Web application**.
5. Add this authorized redirect URI for local development:

`http://localhost:8787/oauth2callback`

6. Copy `.env.example` to `.env`.
7. Fill in:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `SESSION_SECRET`

This app requests only:

`https://www.googleapis.com/auth/spreadsheets.readonly`

## Local development

Requirements: Node 20+.

```bash
npm install
npm run dev
```

Vite runs on `http://localhost:5173`.

The Node OAuth/API server runs on `http://localhost:8787`.

For development, Vite proxies `/auth`, `/oauth2callback`, `/api`, and `/logout` to the Node server.

## Production

Build:

```bash
npm run build
```

Start:

```bash
npm start
```

The production server serves `dist/` and the API from one origin.

## Production hardening

For a real public deployment:

- Store `SESSION_SECRET` in a secret manager.
- Replace Express's in-memory session store with Redis/Postgres.
- Restrict the OAuth consent screen to your intended Google account/domain.
- Keep the OAuth client secret server-side.
- Use HTTPS.
- Consider encrypting stored OAuth tokens if you persist them outside the session store.


## Current architecture decision

The browser never receives the Google OAuth client secret. The Node layer performs the OAuth code exchange and calls the Sheets API server-side. The frontend receives only the sheet values required to compute the dashboard. The app requests `spreadsheets.readonly`.

For a public deployment, replace Express's default in-memory session store with Redis/Postgres and put `SESSION_SECRET` in a real secret manager.
