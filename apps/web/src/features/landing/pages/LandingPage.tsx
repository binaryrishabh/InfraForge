import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Wordmark } from "@/ui/Brand";
import { ButtonLink } from "@/ui/Button";
import { SkipLink } from "@/components/shell/AppShell";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { HeroDiagram } from "../components/HeroDiagram";
import { LoopSection } from "../components/LoopSection";
import { EvidenceSection } from "../components/EvidenceSection";

export function LandingPage() {
  const signedIn = useAuthStore((s) => s.status === "authenticated");
  const start = signedIn ? "/challenges" : "/signin";
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <SkipLink />
      <header className="mx-auto flex h-16 max-w-[1160px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" aria-label="InfraForge" className="rounded-md"><Wordmark /></Link>
        <nav aria-label="Account" className="flex items-center gap-2">
          {signedIn ? <ButtonLink to="/home" variant="secondary" size="sm">Open InfraForge</ButtonLink> : <>
            <Link to="/signin" className="rounded-md px-2 py-1 text-sm font-medium text-ink-2 hover:text-ink">Sign in</Link>
            <ButtonLink to="/signin" variant="primary" size="sm">Get started</ButtonLink>
          </>}
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="outline-none">
        <section className="mx-auto grid max-w-[1160px] gap-12 px-4 pt-10 pb-20 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:px-8 lg:pt-16">
          <div>
            <p className="if-eyebrow">A workbench for learning systems design</p>
            <h1 className="if-display mt-4 text-[44px] text-ink sm:text-[60px]">
              Predict how your system behaves. <span className="if-mark">Then run it.</span>
            </h1>
            <p className="mt-6 max-w-[54ch] text-[17px] leading-relaxed text-ink-2">
              Build an architecture on a drafting canvas, commit to a prediction, run it against fixed traffic in a deterministic
              simulator, and read a report that keeps what was recorded apart from what it might mean.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink to={start} variant="primary" size="lg" icon={null}>Start a challenge <ArrowRight size={17} aria-hidden="true" /></ButtonLink>
              <ButtonLink to={signedIn ? "/design" : "/signin"} variant="secondary" size="lg">Open the designer</ButtonLink>
            </div>
            <p className="mt-6 text-sm text-ink-3">Free to use. Sign in with Google or GitHub. No cloud account is touched.</p>
          </div>
          <HeroDiagram />
        </section>
        <LoopSection />
        <EvidenceSection />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1160px] flex-col gap-3 px-4 py-8 text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <Wordmark className="opacity-80" />
          <p className="max-w-[60ch]">An educational model with fixed rules. Results are not cloud bills, sizing advice or recovery guarantees.</p>
        </div>
      </footer>
    </div>
  );
}
