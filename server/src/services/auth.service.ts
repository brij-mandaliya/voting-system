import crypto from "node:crypto";
import { env, googleEnabled } from "../config";
import { sessionRepo } from "../repositories/session.repo";
import { userRepo } from "../repositories/user.repo";
import { audit } from "../repositories/audit.repo";
import { generateTemporaryPassword, randomToken, sha256 } from "../utils/codes";
import { HttpError, unauthorized } from "../utils/errors";
import { SESSION_COOKIE, sessionCookieOptions } from "../middleware/auth";
import { checkAccountLockout, recordLoginFailure, recordLoginSuccess } from "../middleware/rateLimit";
import { hashPassword, needsRehash, verifyPassword } from "../utils/password";
import type { Response } from "express";
import type { User } from "@prisma/client";
import type { GoogleIdentity } from "./google.service";

const TTL_MS = () => env.SESSION_TTL_HOURS * 3600_000;

/** Why a Google sign-in was refused; the login page shows a matching message. */
export type GoogleSignInError = "not_registered" | "email_unverified";

type SessionUser = Omit<User, "passwordHash">;

async function startSession(user: SessionUser, ip: string, userAgent: string, res: Response) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + TTL_MS());
  await sessionRepo.create(user.id, sha256(token), expiresAt, ip, userAgent);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(TTL_MS()));
}

const sessionUser = (user: SessionUser) => ({
  id: user.id,
  name: user.name,
  username: user.username,
  email: user.email,
  role: user.role,
  mustChangePassword: user.mustChangePassword,
  hasPassword: user.hasPassword,
});

/** A hash nobody knows the password for (Google-only accounts). */
const unusablePasswordHash = () => hashPassword(crypto.randomBytes(32).toString("base64url"));

export const authService = {
  buildCookieOptions: sessionCookieOptions,

  async login(identifier: string, password: string, ip: string, userAgent: string, res: Response) {
    checkAccountLockout(identifier, ip);
    let user = await userRepo.findByIdentifier(identifier);
    if (user) {
      const ok = await verifyPassword(user.passwordHash, password);
      if (!ok) user = null as never;
    }
    if (!user) {
      recordLoginFailure(identifier, ip);
      audit({ action: "auth.login_failed", entityType: "user", entityId: identifier, ip });
      throw unauthorized("Invalid credentials");
    }
    if (user.status !== "ACTIVE") {
      throw unauthorized("Invalid credentials"); // generic: don't reveal deactivated state
    }
    recordLoginSuccess(identifier, ip);
    if (needsRehash(user.passwordHash)) {
      // upgrade legacy hash parameters in the background; never overwrite a
      // password that was changed or reset after this login verified it
      const { id, passwordHash: verified } = user;
      hashPassword(password)
        .then((passwordHash) => userRepo.replacePasswordHashIf(id, verified, passwordHash))
        .catch((e) => console.error("password rehash failed", e));
    }

    await startSession(user, ip, userAgent, res);
    audit({
      actorId: user.id,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      ip,
    });
    return sessionUser(user);
  },

  /**
   * Signs in the account already registered with this (Google-verified) email.
   * There is no self sign-up: an unknown email is refused. A pending temporary
   * password is retired, since Google has now proven who the person is.
   */
  async googleSignIn(identity: GoogleIdentity, ip: string, userAgent: string, res: Response): Promise<
    { ok: true } | { ok: false; error: GoogleSignInError }
  > {
    if (!identity.emailVerified) {
      audit({ action: "auth.google_refused", entityType: "user", entityId: identity.email, after: { reason: "email_unverified" }, ip });
      return { ok: false, error: "email_unverified" };
    }
    let user = await userRepo.findByEmail(identity.email);
    if (!user || user.status !== "ACTIVE") {
      audit({ action: "auth.google_refused", entityType: "user", entityId: identity.email, after: { reason: "not_registered" }, ip });
      return { ok: false, error: "not_registered" };
    }
    if (user.mustChangePassword) {
      user = await userRepo.update(user.id, {
        passwordHash: await unusablePasswordHash(),
        mustChangePassword: false,
        hasPassword: false,
      });
    }
    await startSession(user, ip, userAgent, res);
    audit({ actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id, after: { method: "google" }, ip });
    return { ok: true };
  },

  /** First password for a Google-only account (no current password exists). */
  async setPassword(userId: string, newPassword: string, token?: string) {
    const user = await userRepo.findById(userId);
    if (!user) throw unauthorized();
    if (user.hasPassword) throw new HttpError(409, "This account already has a password; change it instead");
    const passwordHash = await hashPassword(newPassword);
    const { count } = await userRepo.setFirstPassword(user.id, passwordHash);
    if (count === 0) throw new HttpError(409, "This account already has a password; change it instead");
    if (token) await sessionRepo.deleteAllForUser(userId, sha256(token));
    audit({ actorId: userId, action: "auth.password_set", entityType: "user", entityId: userId });
  },

  /**
   * Login material for a newly created account. With Google sign-in enabled,
   * non-admin accounts get no password at all (nothing to hand out or leak);
   * otherwise a temporary password that must be changed on first login.
   */
  async initialCredentials(role: User["role"]) {
    if (googleEnabled() && role !== "ADMIN") {
      return {
        temporaryPassword: null,
        data: { passwordHash: await unusablePasswordHash(), mustChangePassword: false, hasPassword: false },
      };
    }
    const temporaryPassword = generateTemporaryPassword();
    return {
      temporaryPassword,
      data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, hasPassword: true },
    };
  },

  async logout(token: string | undefined) {
    if (token) await sessionRepo.delete(sha256(token));
  },

  async logoutAll(userId: string, exceptToken?: string) {
    await sessionRepo.deleteAllForUser(userId, exceptToken ? sha256(exceptToken) : undefined);
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string, token?: string) {
    const user = await userRepo.findByIdWithPassword(userId);
    if (!user) throw unauthorized();
    const ok = await verifyPassword(user.passwordHash, currentPassword);
    if (!ok) throw new HttpError(400, "Current password is incorrect");
    const passwordHash = await hashPassword(newPassword);
    await userRepo.update(user.id, { passwordHash, mustChangePassword: false, hasPassword: true });
    // invalidate other sessions; keep the current one
    if (token) await sessionRepo.deleteAllForUser(userId, sha256(token));
    audit({ actorId: userId, action: "auth.password_changed", entityType: "user", entityId: userId });
  },

  /** Hash for temporary credentials (import/reset). */
  hashPassword,
  generateTemporaryPassword,
};
