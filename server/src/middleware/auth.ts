import type { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import { env } from "../config";
import { sessionRepo } from "../repositories/session.repo";
import { roleHas, type Permission, type Role } from "@voting/shared";
import { HttpError, forbidden, unauthorized } from "../utils/errors";
import { sha256 as sha } from "../utils/codes";

export const SESSION_COOKIE = "session";
export const CSRF_COOKIE = "csrf";

export function sessionCookieOptions(maxAgeMs: number) {  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeMs,
  };
}

/** Resolves the session cookie to req.user (or 401 for API-bound guards). */
export async function attachUser(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) return next();
  let session;
  try {
    session = await sessionRepo.findValid(sha(token));
  } catch (e) {
    return next(e);
  }
  if (!session || session.expiresAt < new Date()) return next();
  if (session.user.status !== "ACTIVE" || session.user.deletedAt) return next();
  // sliding expiry: an active user is never logged out mid-event (renewed at most
  // once per half-TTL, so this is one extra write every few hours, not per request)
  const ttlMs = env.SESSION_TTL_HOURS * 3600_000;
  if (session.expiresAt.getTime() - Date.now() < ttlMs / 2) {
    await sessionRepo.extend(session.id, new Date(Date.now() + ttlMs)).catch(() => {});
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(ttlMs));
  }
  req.user = {
    id: session.user.id,
    name: session.user.name,
    username: session.user.username,
    email: session.user.email,
    role: session.user.role as Role,
    status: session.user.status,
    mustChangePassword: session.user.mustChangePassword,
    hasPassword: session.user.hasPassword,
    teamId: session.user.teamId,
  };
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

/** Auth endpoints reachable while a temporary password is still in place. */
const PASSWORD_CHANGE_ALLOWED = new Set([
  "/auth/me",
  "/auth/csrf",
  "/auth/providers",
  "/auth/change-password",
  "/auth/logout",
  "/health",
]);

/** Server-side enforcement of mustChangePassword (the UI redirect alone is bypassable). */
export function requirePasswordChanged(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.mustChangePassword || PASSWORD_CHANGE_ALLOWED.has(req.path)) return next();
  next(new HttpError(403, "Change your temporary password to continue", "PASSWORD_CHANGE_REQUIRED"));
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roleHas(req.user.role, permission)) return next(forbidden(`Missing permission: ${permission}`));
    next();
  };
}

/* --------------------------------- CSRF -------------------------------- */

export function ensureCsrfCookie(req: Request, res: Response, next: NextFunction) {
  if (!req.cookies?.[CSRF_COOKIE]) {
    res.cookie(CSRF_COOKIE, crypto.randomBytes(24).toString("base64url"), {
      httpOnly: false,
      secure: env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    });
  }
  next();
}

export function verifyCsrf(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get("x-csrf-token");
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next(forbidden("CSRF token missing or invalid"));
  }
  next();
}
