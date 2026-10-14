import { Button } from "@/ui/Button";

const PROVIDERS = [{ id: "github", label: "Continue with GitHub" }, { id: "google", label: "Continue with Google" }] as const;
export function SocialSignIn({ providers, pending, onSignIn }: {
  providers: string[]; pending: string | null; onSignIn: (provider: "github" | "google") => void;
}) {
  const available = PROVIDERS.filter((provider) => providers.includes(provider.id));
  if (!available.length) return null;
  return <div className="mt-6 border-t border-line pt-5">
    <p className="mb-3 text-xs text-ink-3">Or continue with</p>
    <div className="flex flex-col gap-2">{available.map((provider) => <Button key={provider.id} size="lg" variant="secondary" className="w-full"
      loading={pending === provider.id} disabled={pending !== null} onClick={() => onSignIn(provider.id)}>{provider.label}</Button>)}</div>
  </div>;
}
