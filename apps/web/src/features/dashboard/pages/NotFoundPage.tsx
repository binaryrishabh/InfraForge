import { Link } from "react-router-dom";
import { Wordmark } from "@/ui/Brand";
import { ButtonLink } from "@/ui/Button";
import { useAuthStore } from "@/features/auth/store/auth.store";

export function NotFoundPage() {
  const signedIn = useAuthStore((s) => s.status === "authenticated");
  return (
    <div className="flex min-h-dvh flex-col bg-bg px-4 text-ink sm:px-8">
      <header className="py-5"><Link to="/" aria-label="InfraForge" className="rounded-md"><Wordmark /></Link></header>
      <main id="main" tabIndex={-1} className="outline-none mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center pb-24">
        <p className="if-num text-sm text-ink-3">404</p>
        <h1 className="if-display mt-2 text-[40px]">Nothing is drawn here.</h1>
        <p className="mt-3 text-[16px] text-ink-2">The page you asked for does not exist, or the link is out of date.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <ButtonLink to={signedIn ? "/home" : "/"} variant="primary">{signedIn ? "Go to Home" : "Go to the overview"}</ButtonLink>
          {signedIn && <ButtonLink to="/runs" variant="secondary">Runs</ButtonLink>}
        </div>
      </main>
    </div>
  );
}
