import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import { useAuthStore } from "../store/auth.store";
import { API_URL } from "../../../client/httpClient";

export function SignInPage() {
  const signIn = useAuthStore((state) => state.signIn);
  const [providers, setProviders] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`${API_URL}/auth/providers`, { signal: abort.signal, credentials: "include" })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data) => setProviders(data.providers))
      .catch(() => { if (!abort.signal.aborted) setError("Sign-in is unavailable. Please try again later."); });
    return () => abort.abort();
  }, []);
  const start = async (provider: "google" | "github") => {
    setLoading(true); setError(null);
    try { await signIn(provider); }
    catch { setError("Sign-in could not be started. Please try again."); setLoading(false); }
  };
  return <AuthLayout>
    <div className="mb-8">
      <h1 className="text-2xl font-semibold text-[#EDF1F7] mb-2">Welcome back</h1>
      <p className="text-sm text-[#677185]">Sign in to save designs and run your infrastructure.</p>
    </div>
    <div className="space-y-4">
      {providers?.includes("google") && <button disabled={loading} onClick={() => void start("google")}
        className="w-full h-11 rounded-lg bg-[#5B8CFF] text-sm font-medium text-[#081018] hover:bg-[#7AA2FF] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2">
        Continue with Google
      </button>}
      {providers?.includes("github") && <button disabled={loading} onClick={() => void start("github")}
        className="w-full h-11 rounded-lg border border-[#273042] text-sm text-[#EDF1F7] hover:bg-[#1C1F26] disabled:opacity-50 flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2">
        Continue with GitHub
      </button>}
      {providers === null && !error && <p role="status" className="text-sm text-[#AAB4C5]">Loading sign-in options…</p>}
      {providers?.length === 0 && <p role="status" className="text-sm text-[#AAB4C5]">Sign-in is not configured for this environment yet.</p>}
      {error && <p role="alert" className="text-sm text-[#F0564A]">{error}</p>}
    </div>
    <p className="mt-6 text-xs text-[#677185]">New here? Your account is created when you first sign in.</p>
    <Link to="/" className="mt-4 inline-block text-xs text-[#5B8CFF] hover:underline">Back to InfraForge</Link>
  </AuthLayout>;
}
