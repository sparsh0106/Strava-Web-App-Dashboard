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
const SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
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

if (!SHEET_ID || !WIF_CONFIGURED) {
  console.warn("Missing ride Sheet or workload identity configuration. See .env.example.");
}

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

function noStore(res) {
  res.set("Cache-Control", "no-store");
}

function getSheetsApi() {
  if (!serviceAccount) throw new Error("Google Sheets access is not configured on the server.");
  return google.sheets({ version: "v4", auth: serviceAccount });
}

app.get("/api/rides", async (_req, res) => {
  noStore(res);
  try {
    if (!SHEET_ID) return res.status(500).send("Google Sheet is not configured on the server.");

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
    sheetConfigured: Boolean(SHEET_ID && serviceAccount)
  });
});

// Vercel's Express function serves the Vite output alongside the API. Include
// public/** in the function bundle through vercel.json so these files exist at
// runtime; local production uses the same paths.
app.use(express.static(path.join(ROOT, "public")));

app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (req.path.startsWith("/api/")) return next();
  return res.sendFile(path.join(ROOT, "public", "index.html"));
});

if (!process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`RideScope server listening on port ${PORT}`);
  });
}

export default app;
