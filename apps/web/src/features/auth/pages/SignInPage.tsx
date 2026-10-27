import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LOGIN_ERROR, PASSWORD_MIN, PASSWORD_MAX, type AuthCapabilities } from "@infraforge/contracts/auth";
import { AuthLayout } from "../components/AuthLayout";
import { SocialSignIn } from "../components/SocialSignIn";
import { useAuthStore } from "../store/auth.store";
import { CredentialError, signinFailure, signupErrors, signupFailure, type FieldErrors } from "../credentials";
import { API_URL } from "../../../client/httpClient";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Page";
import { accountError, asCredentialError, requestAccountMail, useAccountFeatures, useMailCooldown } from "../accountFlow";
import { sendVerificationEmail } from "../accountClient";
import { authCallback } from "../authCallback";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { obtainTurnstileToken } from "../turnstileToken";

type Field = "username" | "email" | "password" | "identifier";
export function SignInPage({ mode = "signin" }: { mode?: "signin" | "signup" }) {
  const signup = mode === "signup";
  const navigate = useNavigate();
  const { signIn, signInCredentials, signUp } = useAuthStore();
  const { features, failed } = useAccountFeatures();
  const [proof, setProof] = useState(authCallback.emailProof);
  const [emailSent, setEmailSent] = useState(false);
  const cooldown = useMailCooldown();
  const emailOnly = signup && !!features?.emailEnabled && !proof;
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState({ username: "", email: "", password: "", identifier: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  // Accounts created before email confirmation was required must confirm before signing in.
  const [unverified, setUnverified] = useState<"needed" | "sent" | null>(null);
  const verifyCooldown = useMailCooldown();
  const [returned] = useState(() => {
    if (typeof window === "undefined" || signup) return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("verified") === "1" ? (params.get("error") ? "failed" : "confirmed") : null;
  });
  useEffect(() => {
    authCallback.emailProof = null;
    const abort = new AbortController();
    fetch(`${API_URL}/auth/providers`, { signal: abort.signal, credentials: "include" })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data: AuthCapabilities) => setCapabilities(data))
      .catch(() => { if (!abort.signal.aborted) setError("Sign-in is unavailable right now. Try again later."); });
    return () => abort.abort();
  }, []);
  const startSocial = async (provider: "google" | "github") => {
    if (busy.current) return;
    busy.current = true; setPending(provider); setError(null);
    try { await signIn(provider); }
    catch { setError("Sign-in could not be started. Try again."); busy.current = false; setPending(null); }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current || !capabilities?.credentials || signup && !features || emailOnly && cooldown.seconds > 0) return;
    const invalid = signup ? (emailOnly ? { email: signupErrors(fields).email } : signupErrors(fields)) : {
      ...(!fields.identifier.trim() ? { identifier: "Enter your username or email." } : {}),
      ...(!fields.password || fields.password.length > PASSWORD_MAX ? { password: "Enter your password." } : {}),
    };
    setErrors(invalid); setError(null); setUnverified(null);
    const first = Object.keys(invalid).find(key => invalid[key as Field]);
    if (first) { event.currentTarget.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus(); return; }
    busy.current = true; setPending("credentials");
    try {
      if (emailOnly) {
        await requestAccountMail("signup", fields.email, features!.turnstileSiteKey, window.location.origin);
        setEmailSent(true); cooldown.start(); return;
      }
      if (signup) {
        const turnstileToken = !proof && features?.turnstileSiteKey ? await obtainTurnstileToken("signup") : undefined;
        await signUp(fields, { emailProof: proof ?? undefined, turnstileToken });
        setProof(null);
      } else await signInCredentials(fields.identifier, fields.password);
      setFields((prev) => ({ ...prev, password: "" }));
      navigate("/home", { replace: true });
    } catch (caught) {
      const failure = asCredentialError(caught);
      if (failure instanceof CredentialError) {
        if (failure.status === 429) setError("Too many attempts. Wait a moment before trying again.");
        else if (failure.code === "INVALID_EMAIL_PROOF") setError("This signup link is invalid or expired. Request a new link below.");
        else if (failure.code === "SIGNUP_SIGNIN_FAILED") { setFields(prev => ({ ...prev, password: "" })); setError("Your account is ready. Sign in to continue."); }
        else if (!signup && signinFailure(failure.code, failure.status) === "unverified") setUnverified("needed");
        else if (failure.status === 403 && signup) setError(accountError(failure));
        else if (signup) { const { message, ...fieldErrors } = signupFailure(failure.code); setErrors(fieldErrors); setError(message ?? null); }
        else setError(LOGIN_ERROR);
      } else setError(signup ? accountError(failure) : "Your session could not be loaded. Try signing in again.");
    } finally { busy.current = false; setPending(null); }
  };
  const sendConfirmation = async () => {
    if (busy.current || verifyCooldown.seconds) return;
    busy.current = true; setPending("verify"); setError(null);
    try {
      await sendVerificationEmail(fields.identifier.trim().toLowerCase(), `${window.location.origin}/signin?verified=1`);
      setUnverified("sent"); verifyCooldown.start();
    } catch (caught) { setError(accountError(caught)); }
    finally { busy.current = false; setPending(null); }
  };
  const field = (name: Field, label: string, autoComplete: string, hint?: string) => (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor={`auth-${name}`}>{label}</label>
      <input id={`auth-${name}`} name={name} type={name === "password" ? "password" : name === "email" ? "email" : "text"}
        autoComplete={autoComplete} autoCapitalize="none" spellCheck={false} required
        maxLength={name === "password" ? PASSWORD_MAX : name === "username" ? 30 : 254}
        value={fields[name]} disabled={pending !== null} aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `auth-${name}-error` : hint ? `auth-${name}-hint` : undefined}
        onChange={(event) => { setFields((prev) => ({ ...prev, [name]: event.target.value })); setErrors((prev) => ({ ...prev, [name]: undefined })); }}
        className="h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent aria-[invalid=true]:border-fail disabled:opacity-60" />
      {errors[name] ? <p id={`auth-${name}-error`} role="alert" className="mt-1.5 text-xs text-fail">{errors[name]}</p>
        : hint && <p id={`auth-${name}-hint`} className="mt-1.5 text-xs text-ink-3">{hint}</p>}
    </div>
  );
  return (
    <AuthLayout>
      <p className="if-eyebrow">{signup ? "Sign up" : "Sign in"}</p>
      <h1 className="if-display mt-3 text-[34px] leading-tight">{emailSent ? "Check your email" : proof && signup ? "Finish creating your account." : signup ? "Make room for your ideas." : "Your workbench is waiting."}</h1>
      <p className="mt-3 text-sm text-ink-2">{emailSent ? "If eligible, you’ll receive a signup link. Check your inbox and spam folder. Links expire after 30 minutes." : emailOnly ? "First, confirm your email. You’ll choose a username and password after opening the link." : signup ? "Create an account to save designs, attempts and reports." : "Continue with your username or email."}</p>
      <form className="mt-7 flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate aria-label={signup ? "Create an account" : "Sign in with a password"}>
        {!emailSent && (!signup || features) && (signup ? <>
          {!emailOnly && field("username", "Username", "username", "3–30 characters. Start with a letter; use letters, numbers or underscores.")}
          {field("email", proof ? "Email from your signup link" : "Email", "email")}
        </> : field("identifier", "Username or email", "username"))}
        {!emailSent && !emailOnly && (!signup || features) && field("password", "Password", signup ? "new-password" : "current-password", signup ? `${PASSWORD_MIN}–${PASSWORD_MAX} characters. A long, unique passphrase works well.` : undefined)}
        {signup && !proof && <TurnstileWidget siteKey={features?.turnstileSiteKey ?? null} action="signup" />}
        {returned === "confirmed" && !unverified && <Notice tone="ok" role="status">Email confirmed. Sign in to continue.</Notice>}
        {returned === "failed" && !unverified && <Notice tone="fail" role="alert">That confirmation link is invalid or expired. Sign in to get a new one.</Notice>}
        {unverified && <Notice tone="warn" role="alert" title="Confirm your email to sign in">
          {unverified === "sent" ? "Check your inbox and spam folder for the confirmation link, then sign in again."
            : fields.identifier.includes("@") ? "We need to confirm this email address once before you can sign in with a password."
            : "Enter your email address instead of your username, then press Sign in again to get a confirmation link."}
          {fields.identifier.includes("@") && <div className="mt-3"><Button type="button" variant="secondary" size="sm" loading={pending === "verify"}
            disabled={pending !== null || verifyCooldown.seconds > 0} onClick={() => void sendConfirmation()}>
            {verifyCooldown.seconds ? `Send again in ${verifyCooldown.seconds}s` : unverified === "sent" ? "Send again" : "Send confirmation link"}</Button></div>}
        </Notice>}
        {error && <Notice tone="fail" role="alert">{error}</Notice>}
        {failed && <Notice tone="fail" role="alert">Account options could not be loaded. Reload to try again.</Notice>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending === "credentials"} disabled={pending !== null || !capabilities?.credentials || signup && !features || emailOnly && cooldown.seconds > 0}>{emailOnly && cooldown.seconds ? `Resend in ${cooldown.seconds}s` : emailSent ? "Resend signup link" : emailOnly ? "Send signup link" : signup ? "Create account" : "Sign in"}</Button>
        {proof && signup && <Link to="/signup" reloadDocument className="text-sm text-accent">Request a new signup link</Link>}
        {emailSent && <Button type="button" variant="ghost" onClick={() => { setEmailSent(false); setError(null); }}>Use another email</Button>}
        {(capabilities === null || signup && !features) && !error && !failed && <p role="status" className="text-xs text-ink-3">Loading sign-in options…</p>}
      </form>
      {!signup && features?.emailEnabled && <Link to="/forgot-password" className="mt-4 block text-sm text-accent">Forgot password?</Link>}
      <SocialSignIn providers={capabilities?.providers ?? []} pending={pending} onSignIn={(provider) => void startSocial(provider)} />
      <p className="mt-6 text-sm text-ink-3">{signup ? "Already have an account? " : "New here? "}<Link to={signup ? "/signin" : "/signup"} className="font-medium text-accent underline-offset-2 hover:underline">{signup ? "Sign in" : "Create an account"}</Link></p>
      <p className="mt-4 text-xs text-ink-3"><Link to="/" className="underline-offset-2 hover:underline">Back to the overview</Link></p>
    </AuthLayout>
  );
}
