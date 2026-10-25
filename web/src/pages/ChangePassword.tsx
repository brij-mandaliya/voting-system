import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/Auth";
import { Button, Card, ErrorBox, LabelledInput } from "../components/ui";
import { AuthLayout } from "../components/AuthLayout";
import { IconCheck, IconEye, IconEyeOff, } from "../components/icons";
import { api, ApiError } from "../lib/api";
import { Spinner } from "../components/Spinner";

export default function ChangePassword() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // forced: a temporary password must be replaced; first: a Google-only account
  // adds a password (no current one to confirm); otherwise an ordinary change
  const mode = user?.mustChangePassword ? "forced" : user && !user.hasPassword ? "first" : "change";
  const home = user?.role === "ADMIN" ? "/admin" : "/rooms";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 10) return setError("New password must be at least 10 characters");
    setBusy(true);
    try {
      if (mode === "first") await api("/auth/set-password", { body: { newPassword: next } });
      else await api("/auth/change-password", { body: { currentPassword: current, newPassword: next } });
      await refresh();
      navigate(home);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change password");
    } finally {
      setBusy(false);
    }
  };

  const strength = [
    next.length >= 10,
    /[A-Z]/.test(next),
    /[0-9]/.test(next),
    /[^A-Za-z0-9]/.test(next),
  ].filter(Boolean).length;
  const strengthLabel = ["Too short", "Getting there", "Good", "Strong", "Excellent"][strength];

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;

  const copy = {
    forced: {
      title: "Set a new password",
      body: `Welcome, ${user.name.split(" ")[0]}. Your account uses a temporary password. Choose a permanent one to continue.`,
    },
    first: {
      title: "Add a password",
      body: "You sign in with Google. A password is optional: it lets you also sign in with your email and password.",
    },
    change: { title: "Change password", body: "Other devices are signed out after the change." },
  }[mode];

  return (
    <AuthLayout>
      <div className="mb-5">
        <h1 className="text-[22px] font-semibold leading-tight text-ink-950">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">{copy.body}</p>
      </div>

      <Card className="p-5 sm:p-6">
        <form onSubmit={submit} className="space-y-4">
          {mode !== "first" && (
            <LabelledInput
              label={mode === "forced" ? "Temporary password" : "Current password"}
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoComplete="current-password"
              placeholder={mode === "forced" ? "Enter the password you were given" : "Enter your current password"}
            />
          )}
          <div>
            <LabelledInput
              label="New password"
              hint="Min 10 characters"
              type={showPassword ? "text" : "password"}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              autoComplete="new-password"
              placeholder="Create a strong password"
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide characters" : "Show characters"}
                  title={showPassword ? "Hide password" : "Show password"}
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                >
                  {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              }
            />
            {next.length > 0 && (
              <div className="mt-2 flex items-center gap-3">
                <div className="flex flex-1 gap-1" aria-hidden="true">
                  {[1, 2, 3, 4].map((step) => (
                    <span
                      key={step}
                      className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                        strength >= step
                          ? strength <= 2
                            ? "bg-gold-400"
                            : "bg-jade-500"
                          : "bg-ink-100"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[11px] font-medium text-ink-500" aria-live="polite">
                  {strengthLabel}
                </span>
              </div>
            )}
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-400">
              <IconCheck size={12} className={next.length >= 10 ? "text-jade-500" : "text-ink-300"} />
              At least 10 characters
            </p>
          </div>

          {error && <ErrorBox>{error}</ErrorBox>}

          <Button type="submit" disabled={busy} aria-busy={busy} className="mt-1 w-full py-3">
            {busy ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
                />
                Saving…
              </>
            ) : (
              "Save password"
            )}
          </Button>
        </form>
      </Card>
      {mode !== "forced" && (
        <Link to={home} className="mt-4 inline-block text-sm font-medium text-ink-700 hover:text-ink-950">
          Cancel
        </Link>
      )}
    </AuthLayout>
  );
}
