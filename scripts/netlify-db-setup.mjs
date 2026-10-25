/**
 * Build-time database setup for Netlify.
 *
 * Applies pending Prisma migrations and (optionally) creates the first admin.
 * No-ops when DATABASE_URL is absent, so deploy previews / branch builds that
 * have no database attached do not fail the build.
 *
 * Scoping note: only set DATABASE_URL (and ADMIN_*) for the "production"
 * deploy context in Netlify, otherwise every preview build would migrate the
 * same database.
 */
import { execFileSync } from "node:child_process";

const hasDb = Boolean(process.env.DATABASE_URL);
if (!hasDb) {
  console.log("[netlify-db-setup] DATABASE_URL not set — skipping migrations.");
  process.exit(0);
}

const run = (args) => {
  console.log(`[netlify-db-setup] npx ${args.join(" ")}`);
  execFileSync("npx", args, { stdio: "inherit", env: process.env });
};

run(["prisma", "migrate", "deploy", "--schema", "server/prisma/schema.prisma"]);

if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  run(["tsx", "server/prisma/bootstrap-admin.ts"]);
} else {
  console.log("[netlify-db-setup] ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin bootstrap.");
}
