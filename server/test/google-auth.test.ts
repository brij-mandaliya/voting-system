/**
 * Sign in with Google: only accounts already registered with that email can
 * sign in, the redirect round trip is bound to the browser (state, nonce,
 * PKCE), and Google-only accounts may add a password of their own later.
 * Google itself is stubbed at googleAuth.exchange.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import argon2 from "argon2";
import { prisma, startServer, stopServer, U, PASSWORD } from "./helpers";
import { env } from "../src/config";
import { googleAuth, type GoogleIdentity } from "../src/services/google.service";

let base = "";
const realExchange = googleAuth.exchange;
const saved = { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET };

/** What the stubbed Google returns for the next callback; nonce defaults to the attempt's. */
let nextIdentity: Partial<GoogleIdentity> & { email: string };
let lastExchange: { code: string; verifier: string } | null = null;

beforeAll(async () => {
  env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  env.GOOGLE_CLIENT_SECRET = "test-secret";
  base = await startServer();
});
afterAll(async () => {
  env.GOOGLE_CLIENT_ID = saved.id;
  env.GOOGLE_CLIENT_SECRET = saved.secret;
  googleAuth.exchange = realExchange;
  await stopServer();
  await prisma.$disconnect();
});

/* -------------------------- tiny cookie-aware client ------------------------- */
function jar() {
  const store: Record<string, string> = {};
  return {
    store,
    header: () => Object.entries(store).map(([k, v]) => `${k}=${v}`).join("; "),
    csrf: () => store["csrf"] ?? "",
    absorb(res: Response) {
      for (const cookie of res.headers.getSetCookie()) {
        const [pair] = cookie.split(";");
        const i = pair.indexOf("=");
        const value = pair.slice(i + 1).trim();
        if (value) store[pair.slice(0, i).trim()] = value;
        else delete store[pair.slice(0, i).trim()];
      }
    },
  };
}

async function call(j: ReturnType<typeof jar>, path: string, body?: unknown) {
  if (body !== undefined && !j.csrf()) j.absorb(await fetch(`${base}/api/auth/csrf`));
  const res = await fetch(`${base}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: j.header(),
      ...(body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": j.csrf() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  j.absorb(res);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

async function passwordLogin(identifier: string, password: string) {
  const j = jar();
  const res = await call(j, "/auth/login", { identifier, password });
  return { j, ...res };
}

/** Starts a sign-in, then plays Google redirecting back. Returns the final redirect. */
async function googleSignIn(opts: { next?: string; tamperState?: boolean; nonce?: string } = {}) {
  const j = jar();
  const start = await fetch(`${base}/api/auth/google${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ""}`, {
    redirect: "manual",
  });
  j.absorb(start);
  const google = new URL(start.headers.get("location")!);
  const attempt = JSON.parse(decodeURIComponent(j.store["google_oauth"]));
  googleAuth.exchange = async (code, verifier) => {
    lastExchange = { code, verifier };
    return { sub: "1234", emailVerified: true, name: null, nonce: opts.nonce ?? attempt.nonce, ...nextIdentity };
  };
  const state = opts.tamperState ? "forged" : google.searchParams.get("state")!;
  const back = await fetch(`${base}/api/auth/google/callback?code=auth-code&state=${state}`, {
    redirect: "manual",
    headers: { Cookie: j.header() },
  });
  j.absorb(back);
  return { j, google, attempt, status: back.status, location: back.headers.get("location") ?? "" };
}

async function makeUser(overrides: { role?: "ADMIN" | "PARTICIPANT"; mustChangePassword?: boolean; status?: "ACTIVE" | "INACTIVE" } = {}) {
  const username = U("g");
  return prisma.user.create({
    data: {
      name: username,
      username,
      email: `${username}@gmail.test`,
      passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      role: overrides.role ?? "PARTICIPANT",
      mustChangePassword: overrides.mustChangePassword ?? false,
      status: overrides.status ?? "ACTIVE",
    },
  });
}

beforeEach(() => {
  lastExchange = null;
});

describe("Sign in with Google", () => {
  it("advertises the provider only when it is configured", async () => {
    expect((await call(jar(), "/auth/providers")).body).toEqual({ google: true });
  });

  it("sends the browser to Google with state, nonce and an S256 PKCE challenge", async () => {
    const res = await fetch(`${base}/api/auth/google?next=/join/ABC123`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location")!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = url.searchParams;
    expect(p.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(`${env.WEB_ORIGIN}/api/auth/google/callback`);
    expect(p.get("scope")).toBe("openid email profile");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("state")).toBeTruthy();
    expect(p.get("nonce")).toBeTruthy();

    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("google_oauth="))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth\/google/);
  });

  it("signs a registered attendee in and returns them where they were going", async () => {
    const user = await makeUser();
    nextIdentity = { email: user.email };
    const { j, attempt, location } = await googleSignIn({ next: "/join/ABC123" });
    expect(location).toBe("/join/ABC123");
    expect(lastExchange).toEqual({ code: "auth-code", verifier: attempt.verifier });
    expect(j.store["google_oauth"]).toBeUndefined(); // one-time
    const me = await call(j, "/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: user.id, hasPassword: true });
  });

  it("refuses emails nobody registered (no self sign-up)", async () => {
    const before = await prisma.user.count();
    nextIdentity = { email: `${U("stranger")}@gmail.test` };
    const { j, location } = await googleSignIn();
    expect(location).toBe("/login?error=not_registered");
    expect(j.store["session"]).toBeUndefined();
    expect(await prisma.user.count()).toBe(before);
  });

  it("refuses deactivated accounts and unverified emails", async () => {
    const inactive = await makeUser({ status: "INACTIVE" });
    nextIdentity = { email: inactive.email };
    expect((await googleSignIn()).location).toBe("/login?error=not_registered");

    const user = await makeUser();
    nextIdentity = { email: user.email, emailVerified: false };
    const res = await googleSignIn();
    expect(res.location).toBe("/login?error=email_unverified");
    expect(res.j.store["session"]).toBeUndefined();
  });

  it("rejects a callback whose state or nonce doesn't belong to this browser", async () => {
    const user = await makeUser();
    nextIdentity = { email: user.email };
    const forged = await googleSignIn({ tamperState: true });
    expect(forged.location).toBe("/login?error=google_expired");
    expect(lastExchange).toBeNull(); // the code is never redeemed

    const replayed = await googleSignIn({ nonce: "someone-elses-nonce" });
    expect(replayed.location).toBe("/login?error=google_expired");
    expect(replayed.j.store["session"]).toBeUndefined();

    // a callback with no attempt cookie at all (e.g. a link from an attacker)
    const res = await fetch(`${base}/api/auth/google/callback?code=x&state=y`, { redirect: "manual" });
    expect(res.headers.get("location")).toBe("/login?error=google_expired");
  });

  it("reports a cancelled consent screen", async () => {
    const res = await fetch(`${base}/api/auth/google/callback?error=access_denied`, { redirect: "manual" });
    expect(res.headers.get("location")).toBe("/login?error=google_cancelled");
  });

  it("never redirects off-site after sign-in", async () => {
    const user = await makeUser();
    nextIdentity = { email: user.email };
    for (const next of ["//evil.example/x", "https://evil.example", "/\\evil.example"]) {
      expect((await googleSignIn({ next })).location).toBe("/");
    }
  });

  it("retires a pending temporary password once Google proves who the person is", async () => {
    const user = await makeUser({ mustChangePassword: true });
    nextIdentity = { email: user.email };
    const { j } = await googleSignIn();
    const me = await call(j, "/auth/me");
    expect(me.body.user).toMatchObject({ mustChangePassword: false, hasPassword: false });
    // the leaked/printed temporary password no longer works
    expect((await passwordLogin(user.username, PASSWORD)).status).toBe(401);
  });
});

describe("Optional password for Google-only accounts", () => {
  it("can be set once, then works for password sign-in", async () => {
    const user = await makeUser({ mustChangePassword: true });
    nextIdentity = { email: user.email };
    const { j } = await googleSignIn();

    expect((await call(j, "/auth/set-password", { newPassword: "short" })).status).toBe(400);
    expect((await call(j, "/auth/set-password", { newPassword: "my-own-password-1" })).status).toBe(200);
    expect((await call(j, "/auth/me")).body.user.hasPassword).toBe(true);
    expect((await passwordLogin(user.email, "my-own-password-1")).status).toBe(200);

    // from now on it is an ordinary password: changing it needs the current one
    const again = await call(j, "/auth/set-password", { newPassword: "someone-elses-pass" });
    expect(again.status).toBe(409);
    expect((await passwordLogin(user.email, "someone-elses-pass")).status).toBe(401);
  });

  it("requires a session", async () => {
    expect((await call(jar(), "/auth/set-password", { newPassword: "my-own-password-1" })).status).toBe(401);
  });
});

describe("Accounts created while Google sign-in is on", () => {
  async function admin() {
    const user = await makeUser({ role: "ADMIN" });
    return (await passwordLogin(user.username, PASSWORD)).j;
  }

  it("imports attendees without any password to hand out", async () => {
    const j = await admin();
    const email = `${U("att")}@gmail.test`;
    const body = new FormData();
    body.append(
      "file",
      new Blob([`team_name,participant_name,participant_email,participant_username\n${U("Team")},Att,${email},${U("att")}`], { type: "text/csv" }),
      "teams.csv"
    );
    const res = await fetch(`${base}/api/teams/import/commit`, {
      method: "POST",
      headers: { Cookie: j.header(), "X-CSRF-Token": j.csrf() },
      body,
    });
    const result = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(result.participantsCreated).toBe(1);
    expect(result.credentials).toEqual([]);
    const created = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(created).toMatchObject({ hasPassword: false, mustChangePassword: false });

    nextIdentity = { email };
    expect((await googleSignIn()).location).toBe("/");
  });

  it("creates single participants without a password, but admins still get one", async () => {
    const j = await admin();
    const participant = await call(j, "/participants", {
      name: "Solo",
      username: U("solo"),
      email: `${U("solo")}@gmail.test`,
      role: "PARTICIPANT",
    });
    expect(participant.status).toBe(201);
    expect(participant.body.temporaryPassword).toBeNull();

    const adminUser = await call(j, "/participants", {
      name: "Second admin",
      username: U("adm"),
      email: `${U("adm")}@gmail.test`,
      role: "ADMIN",
    });
    expect(typeof adminUser.body.temporaryPassword).toBe("string");
  });

  it("keeps the admin password reset as a fallback for attendees Google can't sign in", async () => {
    const j = await admin();
    const user = await makeUser();
    await prisma.user.update({ where: { id: user.id }, data: { hasPassword: false } });
    const reset = await call(j, `/participants/${user.id}/reset-password`, {});
    expect(reset.status).toBe(200);
    const login = await passwordLogin(user.username, reset.body.temporaryPassword);
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ mustChangePassword: true, hasPassword: true });
  });
});
