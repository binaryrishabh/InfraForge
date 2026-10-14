import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import { useAuthStore } from "../store/auth.store";
import { API_URL } from "../../../client/httpClient";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Page";

const PROVIDERS = [
  { id: "github", label: "Continue with GitHub" },
  { id: "google", label: "Continue with Google" },
] as const;

export function SignInPage() {
  const signIn = useAuthStore((state) => state.signIn);
  const [providers, setProviders] = useState<string[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`${API_URL}/auth/providers`, { signal: abort.signal, credentials: "include" })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data) => setProviders(data.providers))
      .catch(() => { if (!abort.signal.aborted) setError("Sign-in is unavailable right now. Try again later."); });
    return () => abort.abort();
  }, []);
  const start = async (provider: "google" | "github") => {
    setPending(provider); setError(null);
    try { await signIn(provider); }
    catch { setError("Sign-in could not be started. Try again."); setPending(null); }
  };
  const available = PROVIDERS.filter((p) => providers?.includes(p.id));
  return (
    <AuthLayout>
      <p className="if-eyebrow">Sign in</p>
      <h1 className="if-display mt-3 text-[38px]">Your workbench is waiting.</h1>
      <p className="mt-3 text-[15px] text-ink-2">Designs, challenge attempts and run reports are saved to your account. A new account is created the first time you sign in.</p>
      <div className="mt-8 flex flex-col gap-3">
        {available.map((provider) => (
          <Button key={provider.id} size="lg" variant={provider.id === "github" ? "primary" : "secondary"} className="w-full"
            loading={pending === provider.id} disabled={pending !== null} onClick={() => void start(provider.id)}>
            {provider.label}
          </Button>
        ))}
        {providers === null && !error && <p role="status" className="text-sm text-ink-3">Loading sign-in options…</p>}
        {providers?.length === 0 && <Notice tone="warn" role="status" title="Sign-in is not configured">This environment has no sign-in provider yet.</Notice>}
        {error && <Notice tone="fail" role="alert">{error}</Notice>}
      </div>
      <p className="mt-8 text-sm text-ink-3"><Link to="/" className="font-medium text-accent underline-offset-2 hover:underline">Back to the overview</Link></p>
    </AuthLayout>
  );
}
