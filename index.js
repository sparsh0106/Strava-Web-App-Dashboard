import express from "express";
import routes from "./server/index.js";

// Vercel detects Express from a root entrypoint that creates and exports the app.
// Keep the API implementation in server/index.js and mount it here.
const app = express();
app.use(routes);

export default app;
