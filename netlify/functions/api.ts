/**
 * Netlify Function entry point.
 *
 * The whole Express API is reused as-is via `serverless-http` — no business
 * logic is duplicated here. Point `/api/*` at this function (see netlify.toml)
 * and Express receives the original `/api/...` path.
 *
 * Serverless constraints (see README "Deploy on Netlify"):
 *  - Socket.IO cannot run here, so realtime degrades to the client's polling.
 *  - In-memory rate limiting / account lockout are best-effort per instance.
 *  - Requests are bounded by the Netlify function timeout.
 */
import serverless from "serverless-http";
import { createApp } from "../../server/src/app";

const app = createApp();

/**
 * Response content types that must be base64-encoded for the Lambda/Netlify
 * response envelope (file downloads: CSV/XLSX templates and result exports).
 */
const BINARY_CONTENT_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
  "text/csv",
];

export const handler = serverless(app, { binary: BINARY_CONTENT_TYPES });
