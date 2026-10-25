import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string(),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  SESSION_TTL_HOURS: z.coerce.number().default(12),
  REDIS_URL: z.string().optional(),
  IMPORT_MAX_FILE_MB: z.coerce.number().default(5),
  IMPORT_MAX_ROWS: z.coerce.number().default(5000),
  /**
   * Express "trust proxy": which hops may set X-Forwarded-For. Default trusts
   * only a reverse proxy on the same host (loopback). Private ranges are NOT
   * trusted by default: at a venue the attendees themselves are on 192.168.x /
   * 10.x and could otherwise spoof their IP. Behind a load balancer, set its
   * subnet or a hop count ("1"); never "true" on an internet-facing API.
   */
  TRUST_PROXY: z.string().default("loopback"),
  /**
   * Sign in with Google (OpenID Connect). When both are set, attendees sign in
   * with the Google account matching their imported email and get no password.
   */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /**
   * Public origin of the app as users open it (scheme + host, no trailing
   * slash). Google redirects back to `${PUBLIC_URL}/api/auth/google/callback`.
   * Defaults to WEB_ORIGIN.
   */
  PUBLIC_URL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

export function trustProxySetting(): boolean | number | string {
  const v = env.TRUST_PROXY.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

export const googleEnabled = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const publicUrl = () => (env.PUBLIC_URL ?? env.WEB_ORIGIN).replace(/\/+$/, "");
