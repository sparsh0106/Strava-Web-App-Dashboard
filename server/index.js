import "dotenv/config";
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

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI || !process.env.SESSION_SECRET || !SHEET_ID) {
  console.warn("Missing Google OAuth / sheet environment variables. Copy .env.example to .env and fill them.");
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

app.get("/api/auth/status", async (req, res) => {
  res.json({
    connected: Boolean(req.session.tokens?.access_token || req.session.tokens?.refresh_token)
  });
});

app.get("/auth/google", (req, res) => {
console.log("OAuth Client ID:", process.env.GOOGLE_CLIENT_ID);
console.log("OAuth Redirect URI:", process.env.GOOGLE_REDIRECT_URI);
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES
  });
  res.redirect(url);
});

app.get("/oauth2callback", async (req, res) => {
  try {
    if (!req.query.code || typeof req.query.code !== "string") {
      return res.status(400).send("Missing OAuth authorization code.");
    }
    const { tokens } = await oauth2.getToken(req.query.code);
    req.session.tokens = tokens;
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("Google authorization failed.");
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
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
  try {
    const auth = await getAuthorizedClient(req);
    if (!auth) return res.status(401).send("Google account not connected.");

    const sheets = google.sheets({ version: "v4", auth });

    let range = RANGE_OVERRIDE;

    if (!range) {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
        fields: "sheets(properties(sheetId,title,index))"
      });
      const firstSheet = meta.data.sheets?.sort((a,b) => (a.properties?.index ?? 0) - (b.properties?.index ?? 0))[0];
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

    res.json({ values: result.data.values ?? [] });
  } catch (err) {
    console.error(err);
    const message = err?.response?.data?.error?.message || err?.message || "Failed to read Google Sheet.";
    res.status(500).send(message);
  }
});

app.get("/api/health", (_, res) => {
  res.json({ ok: true, sheetConfigured: Boolean(SHEET_ID) });
});

// Serve Vite production build.
app.use(express.static(path.join(ROOT, "dist")));

app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (req.path.startsWith("/api/") || req.path.startsWith("/auth/") || req.path === "/oauth2callback" || req.path === "/logout") {
    return next();
  }
  res.sendFile(path.join(ROOT, "dist", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Strava dashboard server listening on port ${PORT}`);
});
