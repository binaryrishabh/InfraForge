import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Wordmark } from "@/ui/Brand";
import { ButtonLink } from "@/ui/Button";
import { SkipLink } from "@/components/shell/AppShell";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { HeroInstrument } from "../components/HeroInstrument";
import { LoopLine } from "../components/LoopLine";
import { EvidenceMarks } from "../components/EvidenceMarks";
import { landingSample } from "../sample";

export function LandingPage() {
  const signedIn = useAuthStore((s) => s.status === "authenticated");
  const start = signedIn ? "/challenges" : "/signup";
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <SkipLink />
      <header className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" aria-label="InfraForge" className="rounded-md"><Wordmark /></Link>
        <nav aria-label="Account" className="flex items-center gap-2">
          {signedIn ? <ButtonLink to="/home" variant="secondary" size="sm">Open InfraForge</ButtonLink> : <>
            <Link to="/signin" className="rounded-md px-2 py-1 text-sm font-semibold text-ink-2 hover:text-ink">Sign in</Link>
            <ButtonLink to="/signup" variant="primary" size="sm">Get started</ButtonLink>
          </>}
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="outline-none">
        <section className="mx-auto grid max-w-[1440px] gap-12 px-4 pt-10 pb-24 sm:px-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start lg:px-8 lg:pt-16">
          <div className="lg:pt-24">
            <p className="text-sm font-semibold text-accent">A simulator for learning infrastructure</p>
            <h1 className="if-display mt-5 text-[52px] text-ink sm:text-[80px]">Predict it. Then watch it fail.</h1>
            <p className="mt-7 max-w-[46ch] text-[18px] leading-relaxed text-ink-2">
              Build an architecture, commit to what you think will happen, and run it. Every second is recorded,
              so you can see exactly where it broke, and change one thing and run it again.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink to={start} variant="primary" size="lg">Start the first challenge <ArrowRight size={17} aria-hidden="true" /></ButtonLink>
              {!signedIn && <ButtonLink to="/signin" variant="secondary" size="lg">Sign in</ButtonLink>}
            </div>
          </div>
          <div>
            <HeroInstrument />
            <p className="mt-3 max-w-[70ch] text-xs leading-relaxed text-ink-3">
              Recorded by the Model 1 simulator from the challenge's unchanged starting design, its fixed workload and seed
              ({landingSample.seed}): the run any first, unchanged attempt at “{landingSample.challenge.title}” records.
            </p>
          </div>
        </section>
        <LoopLine />
        <EvidenceMarks />
        <section className="border-t border-line">
          <div className="mx-auto flex max-w-[1440px] flex-col items-start gap-6 px-4 py-20 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8">
            <h2 className="if-display max-w-[16ch] text-[40px] sm:text-[56px]">The first station is a small API.</h2>
            <ButtonLink to={start} variant="primary" size="lg">Start the first challenge <ArrowRight size={17} aria-hidden="true" /></ButtonLink>
          </div>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 py-8 text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <Wordmark className="opacity-80" />
          <p className="max-w-[64ch]">An educational simulator with fixed, published rules. Results are modeled behavior, not cloud measurements, bills, sizing advice or recovery guarantees.</p>
        </div>
      </footer>
    </div>
  );
}
