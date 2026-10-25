import { Router } from "express";
import { authService } from "../services/auth.service";
import { attachUser, CSRF_COOKIE, SESSION_COOKIE, ensureCsrfCookie } from "../middleware/auth";
import { loginLimiter } from "../middleware/rateLimit";
import { requireAuth, requirePermission } from "../middleware/auth";
import { loginSchema, changePasswordSchema, setPasswordSchema } from "@voting/shared";
import { wrap, parseBody } from "./helpers";
import { env, googleEnabled } from "../config";
import { googleAuth } from "../services/google.service";

/** Short-lived cookie tying a Google redirect back to the browser that started it. */
const GOOGLE_COOKIE = "google_oauth";
const GOOGLE_COOKIE_PATH = "/api/auth/google";
const GOOGLE_ATTEMPT_MS = 10 * 60_000;

/** Only same-origin relative paths, so `next` can never send someone off-site. */
function safeNext(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value.slice(0, 500)
    : "/";
}

const r = Router();

r.get("/providers", (_req, res) => {
  res.json({ google: googleEnabled() });
});

r.get("/google", (req, res) => {
  if (!googleEnabled()) return res.redirect("/login?error=google_disabled");
  const attempt = googleAuth.newAttempt();
  const payload = { state: attempt.state, nonce: attempt.nonce, verifier: attempt.codeVerifier, next: safeNext(req.query.next) };
  res.cookie(GOOGLE_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    // Lax, not Strict: the cookie must come back on Google's top-level redirect
    sameSite: "lax",
    path: GOOGLE_COOKIE_PATH,
    maxAge: GOOGLE_ATTEMPT_MS,
  });
  res.redirect(googleAuth.authUrl(attempt));
});

r.get("/google/callback", wrap(async (req, res) => {
  const fail = (error: string) => res.redirect(`/login?error=${error}`);
  let attempt: { state?: string; nonce?: string; verifier?: string; next?: string } = {};
  try {
    attempt = JSON.parse(req.cookies?.[GOOGLE_COOKIE] ?? "{}");
  } catch {
    // treated as a missing attempt below
  }
  res.clearCookie(GOOGLE_COOKIE, { path: GOOGLE_COOKIE_PATH });
  if (!googleEnabled()) return fail("google_disabled");
  if (req.query.error) return fail("google_cancelled"); // e.g. the user pressed Cancel
  const { code, state } = req.query;
  if (typeof code !== "string" || typeof state !== "string" || !attempt.state || !attempt.verifier || state !== attempt.state) {
    return fail("google_expired");
  }
  let identity;
  try {
    identity = await googleAuth.exchange(code, attempt.verifier);
  } catch (e) {
    console.error("google sign-in failed", e);
    return fail("google_failed");
  }
  if (!identity.nonce || identity.nonce !== attempt.nonce) return fail("google_expired");
  const result = await authService.googleSignIn(identity, req.ip ?? "", req.headers["user-agent"] ?? "", res);
  if (!result.ok) return fail(result.error);
  res.redirect(safeNext(attempt.next));
}));

r.get("/csrf", ensureCsrfCookie, (_req, res) => {
  res.json({ csrfCookie: CSRF_COOKIE, ok: true });
});

r.post("/login", loginLimiter, ensureCsrfCookie, wrap(async (req, res) => {
  const { identifier, password } = parseBody(loginSchema, req.body);
  const user = await authService.login(identifier, password, req.ip ?? "", req.headers["user-agent"] ?? "", res);
  res.json({ user });
}));

r.post("/logout", wrap(async (req, res) => {
  await authService.logout(req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
}));

r.post("/logout-all", requireAuth, wrap(async (req, res) => {
  await authService.logoutAll(req.user!.id, req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
}));

r.post("/change-password", requireAuth, wrap(async (req, res) => {
  const { currentPassword, newPassword } = parseBody(changePasswordSchema, req.body);
  if (req.user!.mustChangePassword === false && env.NODE_ENV !== "test") {
    // ordinary change flow still allowed
  }
  await authService.changePassword(req.user!.id, currentPassword, newPassword, req.cookies?.[SESSION_COOKIE]);
  res.json({ ok: true });
}));

r.post("/set-password", requireAuth, wrap(async (req, res) => {
  const { newPassword } = parseBody(setPasswordSchema, req.body);
  await authService.setPassword(req.user!.id, newPassword, req.cookies?.[SESSION_COOKIE]);
  res.json({ ok: true });
}));

r.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default r;
