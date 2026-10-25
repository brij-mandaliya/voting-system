/**
 * Production admin bootstrap. Unlike prisma/seed.ts (which creates demo rooms,
 * teams and sample users), this creates ONLY the first admin account and is
 * idempotent, so it is safe to run on every deploy.
 *
 * Set ADMIN_EMAIL + ADMIN_PASSWORD (and optionally ADMIN_USERNAME/ADMIN_NAME)
 * as environment variables. If ADMIN_PASSWORD is not set the script exits
 * without changing anything.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("[bootstrap-admin] ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping.");
    return;
  }
  const username = (process.env.ADMIN_USERNAME?.trim() || "admin").toLowerCase();
  const name = process.env.ADMIN_NAME?.trim() || "System Admin";

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });
  if (existing) {
    console.log(`[bootstrap-admin] admin already exists (@${existing.username}) — skipping.`);
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const admin = await prisma.user.create({
    data: { name, username, email, passwordHash, role: "ADMIN", mustChangePassword: false },
  });
  console.log(`[bootstrap-admin] created admin @${admin.username} (${admin.email}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
