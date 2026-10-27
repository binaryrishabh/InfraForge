import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Eye, EyeOff } from "lucide-react";
import { PASSWORD_MAX, passwordAcceptable } from "@infraforge/contracts/auth";
import { AuthLayout } from "../components/AuthLayout";
import { SocialSignIn } from "../components/SocialSignIn";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { PasswordChecklist } from "../components/PasswordChecklist";
import { useAuthStore } from "../store/auth.store";
import { CredentialError, signupFailure } from "../credentials";
import { accountError, asCredentialError, requestAccountMail, useAccountFeatures, useAuthProviders, useMailCooldown } from "../accountFlow";
import { authCallback } from "../authCallback";
import { confirmHandoff, useHandoff, useUsernameAvailability } from "../signupHandoff";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Page";

type Step =
  | { kind: "email" }
  | { kind: "waiting"; email: string }
  | { kind: "linkOpened"; email: string; emailProof: string }
  | { kind: "linkFailed" }
  | { kind: "details"; email: string; emailProof: string | null };

const USERNAME_HINT: Record<string, { text: string; tone: string }> = {
  idle: { text: "3–30 characters. Start with a letter; use letters, numbers or underscores.", tone: "text-ink-3" },
  invalid: { text: "Use 3–30 letters, numbers or underscores, starting with a letter.", tone: "text-fail" },
  checking: { text: "Checking availability…", tone: "text-ink-3" },
  available: { text: "Available.", tone: "text-ok" },
  taken: { text: "That username is taken. Try another.", tone: "text-fail" },
  unknown: { text: "Availability could not be checked; it is checked again when you continue.", tone: "text-ink-3" },
};

/* Email first, then username and password. The emailed link may be opened on another
device: this tab waits and continues by itself, and the link page offers to finish there. */
export function SignupPage() {
  const navigate = useNavigate();
  const { signUp } = useAuthStore();
  const { features, failed } = useAccountFeatures();
  const providers = useAuthProviders();
  const cooldown = useMailCooldown();
  const [linkProof] = useState(authCallback.emailProof);
  const [stored, setStep] = useState<Step>(linkProof ? { kind: "linkOpened", email: "", emailProof: linkProof } : { kind: "email" });
  // Without email delivery (local development) signup goes straight to the details form.
  const step: Step = features && !features.emailEnabled && stored.kind === "email" ? { kind: "details", email: "", emailProof: null } : stored;
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ username?: string; password?: string }>({});
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);
  const availability = useUsernameAvailability(step.kind === "details" ? username : "");

  // The link page confirms the email for whichever device started signup.
  useEffect(() => {
    authCallback.emailProof = null;
    if (!linkProof) return;
    let active = true;
    confirmHandoff(linkProof)
      .then(({ email: confirmed }) => { if (active) setStep({ kind: "linkOpened", email: confirmed, emailProof: linkProof }); })
      .catch(() => { if (active) setStep({ kind: "linkFailed" }); });
    return () => { active = false; };
  }, [linkProof]);

  useHandoff(step.kind === "waiting",
    (confirmed, emailProof) => { setError(null); setStep({ kind: "details", email: confirmed, emailProof }); },
    () => { setStep({ kind: "email" }); setError("Your signup link expired. Enter your email to get a new one."); });

  const run = async (label: string, work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true; setPending(label); setError(null);
    try { await work(); } finally { busy.current = false; setPending(null); }
  };

  const sendLink = (event?: FormEvent) => {
    event?.preventDefault();
    const address = step.kind === "waiting" ? step.email : email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setError("Enter a valid email address."); return; }
    if (cooldown.seconds > 0) return;
    void run("send", async () => {
      try {
        await requestAccountMail("signup", address, features?.turnstileSiteKey ?? null, window.location.origin);
        cooldown.start(); setStep({ kind: "waiting", email: address });
      } catch (caught) { setError(accountError(caught)); }
    });
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (step.kind !== "details") return;
    const problems = {
      ...(availability === "invalid" || !username.trim() ? { username: USERNAME_HINT.invalid!.text } : {}),
      ...(availability === "taken" ? { username: USERNAME_HINT.taken!.text } : {}),
      ...(!passwordAcceptable(password) ? { password: "Meet every password rule below." } : {}),
    };
    setFieldError(problems);
    if (Object.keys(problems).length) return;
    void run("create", async () => {
      try {
        await signUp({ username: username.trim(), email: step.email, password }, { emailProof: step.emailProof ?? undefined });
        setPassword(""); navigate("/home", { replace: true });
      } catch (caught) {
        const failure = asCredentialError(caught);
        if (!(failure instanceof CredentialError)) { setError("Your account was created, but signing in failed. Sign in to continue."); return; }
        if (failure.code === "SIGNUP_SIGNIN_FAILED") { setError("Your account is ready. Sign in to continue."); return; }
        if (failure.code === "INVALID_EMAIL_PROOF") { setStep({ kind: "linkFailed" }); return; }
        if (failure.code === "PASSWORD_COMPROMISED") { setFieldError({ password: "This password appeared in a data breach. Choose another." }); return; }
        if (failure.code === "PASSWORD_TOO_WEAK") { setFieldError({ password: "Meet every password rule below." }); return; }
        if (failure.status === 429) { setError("Too many attempts. Wait a moment before trying again."); return; }
        const { message, ...fields } = signupFailure(failure.code);
        setFieldError(fields as typeof fieldError); setError(message ?? null);
      }
    });
  };

  const emailFlow = !!features?.emailEnabled;

  const title = step.kind === "waiting" ? "Check your email"
    : step.kind === "linkOpened" ? "Email confirmed"
    : step.kind === "linkFailed" ? "This link has expired"
    : step.kind === "details" ? "Choose your username and password" : "Make room for your ideas.";

  return (
    <AuthLayout>
      <p className="if-eyebrow">Sign up</p>
      <h1 className="if-display mt-3 text-[34px] leading-tight">{title}</h1>

      {step.kind === "email" && <form className="mt-7 flex flex-col gap-4" onSubmit={sendLink} noValidate aria-label="Start signup with your email">
        <p className="text-sm text-ink-2">Start with your email. We'll send a link to confirm it, then you choose a username and password.</p>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="signup-email">Email</label>
          <input id="signup-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254}
            value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} disabled={pending !== null}
            className="h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60" />
        </div>
        {emailFlow && <TurnstileWidget siteKey={features?.turnstileSiteKey ?? null} action="signup" />}
        {error && <Notice tone="fail" role="alert">{error}</Notice>}
        {failed && <Notice tone="fail" role="alert">Account options could not be loaded. Reload to try again.</Notice>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending === "send"} disabled={pending !== null || !features}>Send confirmation link</Button>
        {!features && !failed && <p role="status" className="text-xs text-ink-3">Loading sign-up options…</p>}
      </form>}

      {step.kind === "waiting" && <div className="mt-6 flex flex-col gap-4">
        <p className="text-sm text-ink-2">We sent a link to <strong className="text-ink">{step.email}</strong>. Open it on any device — your phone is fine.</p>
        <Notice tone="info" role="status" title="Keep this tab open">This page continues by itself as soon as the link is opened. Links expire after 30 minutes. Check spam if it hasn't arrived.</Notice>
        <p role="status" className="flex items-center gap-2 text-xs text-ink-3"><span className="size-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />Waiting for confirmation…</p>
        {emailFlow && cooldown.seconds === 0 && <TurnstileWidget siteKey={features?.turnstileSiteKey ?? null} action="signup" />}
        {error && <Notice tone="fail" role="alert">{error}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" loading={pending === "send"} disabled={pending !== null || cooldown.seconds > 0} onClick={() => sendLink()}>
            {cooldown.seconds ? `Resend in ${cooldown.seconds}s` : "Resend link"}</Button>
          <Button type="button" variant="ghost" onClick={() => { setStep({ kind: "email" }); setError(null); }}>Use a different email</Button>
        </div>
      </div>}

      {step.kind === "linkOpened" && <div className="mt-6 flex flex-col gap-4">
        {!step.email ? <p role="status" className="text-sm text-ink-3">Confirming your email…</p> : <>
          <p className="flex items-center gap-2 text-sm text-ink"><CheckCircle2 size={18} className="text-ok" aria-hidden="true" />{step.email} is confirmed.</p>
          <p className="text-sm text-ink-2">If you started on another device or tab, go back to it — it has already moved on to the next step. You can close this page.</p>
          <Button type="button" variant="secondary" onClick={() => setStep({ kind: "details", email: step.email, emailProof: step.emailProof })}>Finish on this device instead</Button>
        </>}
      </div>}

      {step.kind === "linkFailed" && <div className="mt-6 flex flex-col gap-4">
        <p className="text-sm text-ink-2">This signup link is invalid, already used or more than 30 minutes old.</p>
        <Button type="button" variant="primary" onClick={() => { setStep({ kind: "email" }); setError(null); }}>Get a new link</Button>
      </div>}

      {step.kind === "details" && <form className="mt-7 flex flex-col gap-4" onSubmit={create} noValidate aria-label="Create your account">
        {step.emailProof ? <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Email</p>
          <p className="flex items-center gap-2 text-sm text-ink"><CheckCircle2 size={16} className="text-ok" aria-hidden="true" />{step.email}<span className="text-xs text-ink-3">confirmed</span></p>
        </div> : <div>
          <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="signup-email-direct">Email</label>
          <input id="signup-email-direct" type="email" autoComplete="email" value={step.email} maxLength={254}
            onChange={(e) => setStep({ ...step, email: e.target.value })}
            className="h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        </div>}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="signup-username">Username</label>
          <input id="signup-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={30} autoFocus
            value={username} onChange={(e) => { setUsername(e.target.value); setFieldError((f) => ({ ...f, username: undefined })); }}
            aria-invalid={!!fieldError.username || availability === "taken" || availability === "invalid"} aria-describedby="signup-username-hint"
            className="h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent aria-[invalid=true]:border-fail" />
          <p id="signup-username-hint" role="status" className={`mt-1.5 text-xs ${fieldError.username ? "text-fail" : USERNAME_HINT[availability]!.tone}`}>
            {fieldError.username ?? USERNAME_HINT[availability]!.text}</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="signup-password">Password</label>
          <div className="relative">
            <input id="signup-password" name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" maxLength={PASSWORD_MAX}
              value={password} onChange={(e) => { setPassword(e.target.value); setFieldError((f) => ({ ...f, password: undefined })); }}
              aria-invalid={!!fieldError.password} aria-describedby="signup-password-rules"
              className="h-11 w-full rounded-md border border-line bg-surface px-3 pr-11 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent aria-[invalid=true]:border-fail" />
            <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-3 hover:text-ink">
              {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</button>
          </div>
          {fieldError.password && <p role="alert" className="mt-1.5 text-xs text-fail">{fieldError.password}</p>}
          <PasswordChecklist password={password} id="signup-password-rules" />
        </div>
        {error && <Notice tone="fail" role="alert">{error}</Notice>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending === "create"}
          disabled={pending !== null || availability === "checking" || availability === "taken"}>Create account</Button>
      </form>}

      {step.kind === "email" && <SocialSignIn providers={providers} pending={pending} onSignIn={(p) => void run(p, () => useAuthStore.getState().signIn(p).catch(() => setError("Sign-in could not be started. Try again.")))} />}
      <p className="mt-6 text-sm text-ink-3">Already have an account? <Link to="/signin" className="font-medium text-accent underline-offset-2 hover:underline">Sign in</Link></p>
    </AuthLayout>
  );
}
