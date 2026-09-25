import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import session from "express-session";
import { google } from "googleapis";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8787);
const SHEET_ID = process.env.STRAVA_SHEET_ID;
const RANGE_OVERRIDE = process.env.STRAVA_SHEET_RANGE || "";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

if (
  !process.env.GOOGLE_CLIENT_ID ||
  !process.env.GOOGLE_CLIENT_SECRET ||
  !process.env.GOOGLE_REDIRECT_URI ||
  !process.env.SESSION_SECRET ||
  !SHEET_ID
) {
  console.warn("Missing Google OAuth / Sheet environment variables. Copy .env.example to .env and fill them in.");
}

const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const app = express();
app.set("trust proxy", 1);

app.use(session({
  secret: process.env.SESSION_SECRET || "development-only-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 12
  }
}));

function noStore(res) {
  res.set("Cache-Control", "no-store");
}

app.get("/api/auth/status", (req, res) => {
  noStore(res);
  res.json({
    connected: Boolean(req.session.tokens?.access_token || req.session.tokens?.refresh_token),
    sheetConfigured: Boolean(SHEET_ID)
  });
});

app.get("/auth/google", (req, res) => {
  const state = crypto.randomBytes(24).toString("hex");
  req.session.oauthState = state;
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state
  });
  res.redirect(url);
});

app.get("/oauth2callback", async (req, res) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const returnedState = typeof req.query.state === "string" ? req.query.state : null;
    if (!code || !returnedState || !req.session.oauthState || returnedState !== req.session.oauthState) {
      delete req.session.oauthState;
      return res.status(400).send("Invalid or expired Google authorization request.");
    }

    delete req.session.oauthState;
    const { tokens } = await oauth2.getToken(code);
    req.session.tokens = tokens;
    return res.redirect("/");
  } catch (error) {
    console.error("Google authorization failed:", error instanceof Error ? error.message : error);
    return res.status(500).send("Google authorization failed.");
  }
});

app.post("/logout", (req, res) => {
  noStore(res);
  req.session.destroy(error => {
    if (error) return res.status(500).json({ ok: false });
    return res.json({ ok: true });
  });
});

async function getAuthorizedClient(req) {
  const tokens = req.session.tokens;
  if (!tokens) return null;
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials(tokens);
  client.on("tokens", updated => {
    req.session.tokens = { ...req.session.tokens, ...updated };
  });
  return client;
}

app.get("/api/rides", async (req, res) => {
  noStore(res);
  try {
    if (!SHEET_ID) return res.status(500).send("Google Sheet is not configured on the server.");
    const auth = await getAuthorizedClient(req);
    if (!auth) return res.status(401).send("Google account not connected.");

    const sheets = google.sheets({ version: "v4", auth });
    let range = RANGE_OVERRIDE;

    if (!range) {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
        fields: "sheets(properties(sheetId,title,index))"
      });
      const firstSheet = meta.data.sheets
        ?.slice()
        .sort((a, b) => (a.properties?.index ?? 0) - (b.properties?.index ?? 0))[0];
      const title = firstSheet?.properties?.title;
      if (!title) return res.status(500).send("Could not determine the first sheet tab.");
      range = `'${title.replace(/'/g, "''")}'!A:K`;
    }

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range,
      majorDimension: "ROWS",
      valueRenderOption: "FORMATTED_VALUE"
    });

    return res.json({
      values: result.data.values ?? [],
      syncedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Sheet read failed:", error instanceof Error ? error.message : error);
    const message = error?.response?.data?.error?.message || error?.message || "Failed to read Google Sheet.";
    return res.status(500).send(message);
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, sheetConfigured: Boolean(SHEET_ID) });
});

// Serve the Vite production build when the app is started in production mode.
app.use(express.static(path.join(ROOT, "dist")));

app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (
    req.path.startsWith("/api/") ||
    req.path.startsWith("/auth/") ||
    req.path === "/oauth2callback" ||
    req.path === "/logout"
  ) {
    return next();
  }
  return res.sendFile(path.join(ROOT, "dist", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RideScope server listening on port ${PORT}`);
});
