import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PASSWORD_MIN, PASSWORD_MAX } from "@infraforge/contracts/auth";
import { AuthLayout } from "../components/AuthLayout";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { accountError, requestAccountMail, useAccountFeatures, useMailCooldown } from "../accountFlow";
import { resetPassword } from "../accountClient";
import { authCallback } from "../authCallback";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Page";

export function PasswordResetPage({ reset = false }: { reset?: boolean }) {
  const { features, failed } = useAccountFeatures();
  const [token, setToken] = useState(authCallback.token);
  const [value, setValue] = useState("");
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false), cooldown = useMailCooldown();
  useEffect(() => { authCallback.token = null; }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current || !features?.emailEnabled || !reset && cooldown.seconds > 0 || reset && !token) return;
    if (reset && (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX)) { setError(`Use ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`); return; }
    if (!reset && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) { setError("Enter a valid email address."); return; }
    busy.current = true; setPending(true); setError(null);
    try {
      if (reset) {
        await resetPassword(token!, value); setValue(""); setToken(null); setDone(true);
      } else {
        await requestAccountMail("password_reset", value, features.turnstileSiteKey, window.location.origin);
        setSent(true); cooldown.start();
      }
    } catch (failure) { setError(reset ? "The password could not be reset. The link may be expired or already used. Request a new link below." : accountError(failure)); }
    finally { busy.current = false; setPending(false); }
  };
  return <AuthLayout>
    <p className="if-eyebrow">Password reset</p>
    <h1 className="if-display mt-3 text-[34px] leading-tight">{done ? "Password updated" : sent ? "Check your email" : reset ? "Set a new password" : "Forgot your password?"}</h1>
    {done ? <p role="status" className="mt-4 text-sm text-ink-2">Your password has changed. Sign in with your new password.</p> : <>
      {sent && <p role="status" className="mt-4 text-sm text-ink-2">If eligible, you’ll receive a reset link. Check your inbox and spam folder. Links expire after 30 minutes.</p>}
      {reset && !token ? <Notice tone="fail" role="alert">This reset link is invalid or expired. Request a new link below.</Notice> :
        <form onSubmit={event => void submit(event)} noValidate className="mt-7 flex flex-col gap-4" aria-label={reset ? "Set a new password" : "Request a password reset"}>
          {!sent && <div>
            <label htmlFor="reset-value" className="mb-1.5 block text-sm font-medium text-ink">{reset ? "New password" : "Email"}</label>
            <input id="reset-value" name={reset ? "password" : "email"} type={reset ? "password" : "email"} autoComplete={reset ? "new-password" : "email"}
              required maxLength={reset ? PASSWORD_MAX : 254} value={value} disabled={pending} aria-describedby={reset ? "reset-hint" : undefined}
              onChange={event => setValue(event.target.value)} className="h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent" />
            {reset && <p id="reset-hint" className="mt-2 text-xs text-ink-3">{PASSWORD_MIN}–{PASSWORD_MAX} characters. Use a long, unique passphrase.</p>}
          </div>}
          {!reset && <TurnstileWidget siteKey={features?.turnstileSiteKey ?? null} action="password_reset" />}
          {error && <Notice tone="fail" role="alert">{error}</Notice>}
          <Button type="submit" variant="primary" loading={pending} disabled={pending || !features?.emailEnabled || !reset && cooldown.seconds > 0}>
            {reset ? "Set new password" : sent ? cooldown.seconds ? `Resend in ${cooldown.seconds}s` : "Resend reset link" : "Send reset link"}
          </Button>
          {sent && <Button type="button" variant="ghost" onClick={() => { setSent(false); setError(null); }}>Use another email</Button>}
        </form>}
      {failed && <Notice tone="fail" role="alert">Account options could not be loaded. Reload to try again.</Notice>}
      {features && !features.emailEnabled && <p className="mt-4 text-sm text-ink-2">Password reset is unavailable right now.</p>}
      {reset && <Link to="/forgot-password" className="mt-4 block text-sm text-accent">Request a new reset link</Link>}
    </>}
    <Link to="/signin" className="mt-6 block text-sm text-accent">Back to sign in</Link>
  </AuthLayout>;
}
