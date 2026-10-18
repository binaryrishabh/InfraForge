import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LOGIN_ERROR, PASSWORD_MIN, PASSWORD_MAX, type AuthCapabilities } from "@infraforge/contracts/auth";
import { AuthLayout } from "../components/AuthLayout";
import { SocialSignIn } from "../components/SocialSignIn";
import { useAuthStore } from "../store/auth.store";
import { CredentialError, signupErrors, signupFailure, type FieldErrors } from "../credentials";
import { API_URL } from "../../../client/httpClient";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Page";

type Field = "username" | "email" | "password" | "identifier";
export function SignInPage({ mode = "signin" }: { mode?: "signin" | "signup" }) {
  const signup = mode === "signup";
  const navigate = useNavigate();
  const { signIn, signInCredentials, signUp } = useAuthStore();
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState({ username: "", email: "", password: "", identifier: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  useEffect(() => {
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
    if (busy.current || !capabilities?.credentials) return;
    const invalid = signup ? signupErrors(fields) : {
      ...(!fields.identifier.trim() ? { identifier: "Enter your username or email." } : {}),
      ...(!fields.password || fields.password.length > PASSWORD_MAX ? { password: "Enter your password." } : {}),
    };
    setErrors(invalid); setError(null);
    const first = Object.keys(invalid)[0];
    if (first) { event.currentTarget.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus(); return; }
    busy.current = true; setPending("credentials");
    try {
      if (signup) await signUp(fields); else await signInCredentials(fields.identifier, fields.password);
      setFields((prev) => ({ ...prev, password: "" }));
      navigate("/home", { replace: true });
    } catch (failure) {
      if (failure instanceof CredentialError) {
        if (failure.status === 429) setError("Too many attempts. Wait a moment before trying again.");
        else if (signup) { const { message, ...fieldErrors } = signupFailure(failure.code); setErrors(fieldErrors); setError(message ?? null); }
        else setError(LOGIN_ERROR);
      } else setError("Your session could not be loaded. Try signing in again.");
    } finally { busy.current = false; setPending(null); }
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
      <h1 className="if-display mt-3 text-[34px] leading-tight">{signup ? "Make room for your ideas." : "Your workbench is waiting."}</h1>
      <p className="mt-3 text-sm text-ink-2">{signup ? "Create an account to save designs, attempts and reports." : "Continue with your username or email."}</p>
      <form className="mt-7 flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate aria-label={signup ? "Create an account" : "Sign in with a password"}>
        {signup ? <>
          {field("username", "Username", "username", "3–30 characters. Start with a letter; use letters, numbers or underscores.")}
          {field("email", "Email", "email")}
        </> : field("identifier", "Username or email", "username")}
        {field("password", "Password", signup ? "new-password" : "current-password", signup ? `${PASSWORD_MIN}–${PASSWORD_MAX} characters. A long, unique passphrase works well.` : undefined)}
        {error && <Notice tone="fail" role="alert">{error}</Notice>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending === "credentials"} disabled={pending !== null || !capabilities?.credentials}>{signup ? "Create account" : "Sign in"}</Button>
        {capabilities === null && !error && <p role="status" className="text-xs text-ink-3">Loading sign-in options…</p>}
      </form>
      <SocialSignIn providers={capabilities?.providers ?? []} pending={pending} onSignIn={(provider) => void startSocial(provider)} />
      <p className="mt-6 text-sm text-ink-3">{signup ? "Already have an account? " : "New here? "}<Link to={signup ? "/signin" : "/signup"} className="font-medium text-accent underline-offset-2 hover:underline">{signup ? "Sign in" : "Create an account"}</Link></p>
      <p className="mt-4 text-xs text-ink-3"><Link to="/" className="underline-offset-2 hover:underline">Back to the overview</Link></p>
    </AuthLayout>
  );
}
