import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../contexts/Auth";
import { Button, Card, ErrorBox, LabelledInput } from "../components/ui";
import { AuthLayout } from "../components/AuthLayout";
import { IconEye, IconEyeOff, } from "../components/icons";

/** Messages for the `?error=` codes the Google callback redirects back with. */
const GOOGLE_ERRORS: Record<string, string> = {
  not_registered: "That Google account isn't registered for this event. Use the email you signed up with, or ask an organiser.",
  email_unverified: "Google hasn't verified that email address yet.",
  google_cancelled: "Google sign-in was cancelled.",
  google_expired: "The sign-in attempt expired. Try again.",
  google_failed: "Google sign-in didn't complete. Try again.",
  google_disabled: "Google sign-in isn't set up on this server.",
};

/** Only same-origin relative paths (mirrors the server's check). */
const safeNext = (value: string | null) => (value && value.startsWith("/") && !value.startsWith("//") ? value : null);

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const googleError = params.get("error");
  const providers = useQuery({
    queryKey: ["auth-providers"],
    queryFn: () => api<{ google: boolean }>("/auth/providers"),
    staleTime: Infinity,
  });
  const google = providers.data?.google ?? false;
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await login(identifier, password);
      if (user.mustChangePassword) navigate("/change-password");
      else navigate(next ?? (user.role === "ADMIN" ? "/admin" : "/rooms"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-5">
        <h1 className="text-[22px] font-semibold leading-tight text-ink-950">
          Sign in to TeamVote
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          {google
            ? "Use the Google account of the email you registered with."
            : "Use the username or email your organiser gave you."}
        </p>
      </div>

      <Card className="p-5 sm:p-6">
        {googleError && GOOGLE_ERRORS[googleError] && (
          <div className="mb-4">
            <ErrorBox>{GOOGLE_ERRORS[googleError]}</ErrorBox>
          </div>
        )}
        {google && (
          <>
            <a
              href={`/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`}
              className="flex h-10 w-full items-center justify-center gap-2.5 rounded-lg border border-ink-200 bg-white text-sm font-medium text-ink-900 transition-colors hover:bg-ink-50 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <GoogleMark />
              Continue with Google
            </a>
            <div className="my-5 flex items-center gap-3 text-xs text-ink-500" aria-hidden="true">
              <span className="h-px flex-1 bg-ink-200" />
              or with a password
              <span className="h-px flex-1 bg-ink-200" />
            </div>
          </>
        )}
        <form onSubmit={submit} className="space-y-4">
          <LabelledInput
            label="Username or email"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            autoComplete="username"
            placeholder="you@company.com"
          />
          <LabelledInput
            label="Password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="Enter your password"
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide characters" : "Show characters"}
                title={showPassword ? "Hide password" : "Show password"}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
              >
                {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
              </button>
            }
          />

          {error && <ErrorBox>{error}</ErrorBox>}

          <Button
            type="submit"
            variant={google ? "secondary" : undefined}
            disabled={busy}
            aria-busy={busy}
            className="mt-1 h-10 w-full"
          >
            {busy ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current"
                />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
      </Card>

    </AuthLayout>
  );
}

/** Google's "G" mark, as its sign-in branding guidelines require on the button. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
