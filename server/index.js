import crypto from "node:crypto";
import dotenv from "dotenv";
import express from "express";
import { google } from "googleapis";
import { ExternalAccountClient } from "google-auth-library";
import { getVercelOidcToken } from "@vercel/oidc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: [path.join(ROOT, ".env.local"), path.join(ROOT, ".env")] });
const PORT = Number(process.env.PORT || 8787);
const SHEET_ID = process.env.STRAVA_SHEET_ID;
const RANGE_OVERRIDE = process.env.STRAVA_SHEET_RANGE || "";
const SIGNIN_LOG_SHEET_ID = process.env.SIGNIN_LOG_SHEET_ID;
const SIGNIN_LOG_RANGE = process.env.SIGNIN_LOG_SHEET_RANGE || "'Sign-ins'!A:B";
const IDENTITY_SCOPES = ["openid", "email"];
const SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const SERVICE_ACCOUNT_EMAIL = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
const GCP_PROJECT_NUMBER = process.env.GCP_PROJECT_NUMBER;
const WIF_POOL_ID = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
const WIF_PROVIDER_ID = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
const WIF_CONFIGURED = Boolean(
  SERVICE_ACCOUNT_EMAIL && GCP_PROJECT_NUMBER && WIF_POOL_ID && WIF_PROVIDER_ID
);
const WIF_PROVIDER_RESOURCE = WIF_CONFIGURED
  ? `projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL_ID}/providers/${WIF_PROVIDER_ID}`
  : null;
const SESSION_COOKIE = "ridescope_session";
const SESSION_MAX_AGE = 60 * 60 * 12;
const SESSION_KEY = crypto.createHash("sha256")
  .update(process.env.SESSION_SECRET || "development-only-secret")
  .digest();

if (
  !process.env.GOOGLE_CLIENT_ID ||
  !process.env.GOOGLE_CLIENT_SECRET ||
  !process.env.GOOGLE_REDIRECT_URI ||
  !process.env.SESSION_SECRET ||
  !SHEET_ID ||
  !SIGNIN_LOG_SHEET_ID ||
  !WIF_CONFIGURED
) {
  console.warn("Missing Google OAuth, workload identity, ride Sheet, or sign-in log configuration. See .env.example.");
}

const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
const serviceAccount = WIF_CONFIGURED
  ? ExternalAccountClient.fromJSON({
      type: "external_account",
      audience: `//iam.googleapis.com/${WIF_PROVIDER_RESOURCE}`,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      token_url: "https://sts.googleapis.com/v1/token",
      service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SERVICE_ACCOUNT_EMAIL}:generateAccessToken`,
      scopes: SHEETS_SCOPES,
      subject_token_supplier: {
        getSubjectToken: () => getVercelOidcToken({
          audience: `https://iam.googleapis.com/${WIF_PROVIDER_RESOURCE}`
        })
      }
    })
  : null;

const app = express();
app.set("trust proxy", 1);

function readSession(cookieHeader = "") {
  const cookie = cookieHeader
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) return {};

  try {
    const payload = Buffer.from(cookie.slice(SESSION_COOKIE.length + 1), "base64url");
    if (payload.length < 30) return {};
    const decipher = crypto.createDecipheriv("aes-256-gcm", SESSION_KEY, payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    const plaintext = Buffer.concat([
      decipher.update(payload.subarray(28)),
      decipher.final()
    ]);
    const sessionData = JSON.parse(plaintext.toString("utf8"));
    if (
      !sessionData ||
      typeof sessionData !== "object" ||
      Array.isArray(sessionData) ||
      typeof sessionData._expiresAt !== "number" ||
      sessionData._expiresAt <= Date.now()
    ) return {};
    delete sessionData._expiresAt;
    return sessionData;
  } catch {
    return {};
  }
}

function writeSession(res, sessionData, destroyed, hadCookie) {
  const secure = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  const attributes = `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  if (destroyed || Object.keys(sessionData).length === 0) {
    if (destroyed || hadCookie) {
      res.append("Set-Cookie", `${SESSION_COOKIE}=; ${attributes}; Max-Age=0`);
    }
    return;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", SESSION_KEY, iv);
  const sessionPayload = { ...sessionData, _expiresAt: Date.now() + SESSION_MAX_AGE * 1000 };
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(sessionPayload), "utf8"),
    cipher.final()
  ]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  res.append("Set-Cookie", `${SESSION_COOKIE}=${payload}; ${attributes}; Max-Age=${SESSION_MAX_AGE}`);
}

app.use((req, res, next) => {
  const hadCookie = req.headers.cookie?.split(";")
    .some(value => value.trim().startsWith(`${SESSION_COOKIE}=`)) ?? false;
  const sessionData = readSession(req.headers.cookie);
  let destroyed = false;
  req.session = sessionData;
  Object.defineProperty(req.session, "destroy", {
    enumerable: false,
    value: callback => {
      destroyed = true;
      for (const key of Object.keys(sessionData)) delete sessionData[key];
      callback?.(null);
    }
  });

  const end = res.end;
  res.end = function (...args) {
    if (!res.headersSent) writeSession(res, sessionData, destroyed, hadCookie);
    return end.apply(this, args);
  };
  next();
});

function noStore(res) {
  res.set("Cache-Control", "no-store");
}

app.get("/api/auth/status", (req, res) => {
  noStore(res);
  res.json({
    connected: Boolean(req.session.user?.sub && req.session.user?.email),
    email: req.session.user?.email,
    sheetConfigured: Boolean(SHEET_ID && serviceAccount)
  });
});

app.get("/auth/google", (req, res) => {
  if (!serviceAccount || !SIGNIN_LOG_SHEET_ID) {
    return res.status(503).send("Google sign-in is not configured on the server yet.");
  }
  const state = crypto.randomBytes(24).toString("hex");
  const nonce = crypto.randomBytes(24).toString("hex");
  req.session.oauthState = state;
  req.session.oauthNonce = nonce;
  const url = oauth2.generateAuthUrl({
    prompt: "select_account",
    scope: IDENTITY_SCOPES,
    state,
    nonce
  });
  res.redirect(url);
});

app.get("/oauth2callback", async (req, res) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const returnedState = typeof req.query.state === "string" ? req.query.state : null;
    if (!code || !returnedState || !req.session.oauthState || returnedState !== req.session.oauthState) {
      delete req.session.oauthState;
      delete req.session.oauthNonce;
      return res.status(400).send("Invalid or expired Google authorization request.");
    }

    const expectedNonce = req.session.oauthNonce;
    delete req.session.oauthState;
    delete req.session.oauthNonce;
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.id_token) return res.status(401).send("Google did not return a sign-in identity.");

    const ticket = await oauth2.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const identity = ticket.getPayload();
    if (
      !expectedNonce ||
      identity?.nonce !== expectedNonce ||
      !identity.sub ||
      !identity.email ||
      identity.email_verified !== true
    ) {
      return res.status(401).send("Google did not return a valid, verified email address.");
    }

    try {
      await recordSignIn(identity.email);
    } catch (error) {
      console.error("Sign-in log append failed:", error instanceof Error ? error.message : error);
      return res.status(503).send("Sign-in could not be recorded. Please try again later.");
    }

    req.session.user = { sub: identity.sub, email: identity.email };
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

function getSheetsApi() {
  if (!serviceAccount) throw new Error("Google Sheets service account is not configured on the server.");
  return google.sheets({ version: "v4", auth: serviceAccount });
}

async function recordSignIn(email) {
  if (!SIGNIN_LOG_SHEET_ID) throw new Error("Sign-in log Sheet is not configured on the server.");
  const sheets = getSheetsApi();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SIGNIN_LOG_SHEET_ID,
    range: SIGNIN_LOG_RANGE,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[email, new Date().toISOString()]]
    }
  });
}

app.get("/api/rides", async (req, res) => {
  noStore(res);
  try {
    if (!SHEET_ID) return res.status(500).send("Google Sheet is not configured on the server.");
    if (!req.session.user?.sub) return res.status(401).send("Google account not connected.");

    const sheets = getSheetsApi();
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
  res.json({
    ok: true,
    sheetConfigured: Boolean(SHEET_ID && serviceAccount),
    signinLogConfigured: Boolean(SIGNIN_LOG_SHEET_ID && serviceAccount)
  });
});

// Vercel's Express function serves the Vite output alongside the API. Include
// public/** in the function bundle through vercel.json so these files exist at
// runtime; local production uses the same paths.
app.use(express.static(path.join(ROOT, "public")));

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
  return res.sendFile(path.join(ROOT, "public", "index.html"));
});

if (!process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`RideScope server listening on port ${PORT}`);
  });
}

export default app;
