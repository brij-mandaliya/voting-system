import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { env, publicUrl } from "../config";

/** What the app needs from a verified Google ID token. */
export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  nonce: string | null;
}

const base64url = (buf: Buffer) => buf.toString("base64url");

export const googleAuth = {
  redirectUri: () => `${publicUrl()}/api/auth/google/callback`,

  /** One-time values for a sign-in attempt: CSRF state, replay nonce, PKCE verifier. */
  newAttempt() {
    const codeVerifier = base64url(crypto.randomBytes(32));
    return {
      state: base64url(crypto.randomBytes(24)),
      nonce: base64url(crypto.randomBytes(24)),
      codeVerifier,
      codeChallenge: base64url(crypto.createHash("sha256").update(codeVerifier).digest()),
    };
  },

  authUrl(attempt: { state: string; nonce: string; codeChallenge: string }) {
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: googleAuth.redirectUri(),
      response_type: "code",
      scope: "openid email profile",
      state: attempt.state,
      nonce: attempt.nonce,
      code_challenge: attempt.codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  /**
   * Trades the authorization code for tokens and verifies the ID token's
   * signature, issuer, audience and expiry. Replaced in tests.
   */
  async exchange(code: string, codeVerifier: string): Promise<GoogleIdentity> {
    const client = new OAuth2Client({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: googleAuth.redirectUri(),
    });
    const { tokens } = await client.getToken({ code, codeVerifier });
    if (!tokens.id_token) throw new Error("Google returned no ID token");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID! });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error("Google ID token has no subject or email");
    return {
      sub: p.sub,
      email: p.email.toLowerCase(),
      emailVerified: p.email_verified === true,
      name: p.name ?? null,
      nonce: p.nonce ?? null,
    };
  },
};
