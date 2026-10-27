import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PASSWORD_MAX, passwordAcceptable } from "@infraforge/contracts/auth";
import { PasswordChecklist } from "../components/PasswordChecklist";
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
    if (reset && !passwordAcceptable(value)) { setError("Meet every password rule below."); return; }
    if (!reset && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) { setError("Enter a valid email address."); return; }
    busy.current = true; setPending(true); setError(null);
    try {
      if (reset) {
        await resetPassword(token!, value); setValue(""); setToken(null); setDone(true);
      } else {
        await requestAccountMail("password_reset", value, features.turnstileSiteKey, window.location.origin);
        setSent(true); cooldown.start();
      }
    } catch (failure) {
      const code = (failure as { response?: { data?: { code?: string } } }).response?.data?.code;
      setError(!reset ? accountError(failure)
        : code === "PASSWORD_COMPROMISED" ? "This password appeared in a data breach. Choose another."
        : code === "PASSWORD_TOO_WEAK" ? "Meet every password rule below."
        : "The password could not be reset. The link may be expired or already used. Request a new link below.");
    }
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
            {reset && <PasswordChecklist password={value} id="reset-hint" />}
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
