import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Wordmark } from "@/ui/Brand";
import { SkipLink } from "@/components/shell/AppShell";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-bg text-ink lg:grid-cols-[1fr_minmax(0,560px)]">
      <SkipLink />
      <aside aria-hidden="true" className="if-paper-grid relative hidden border-r border-line [background-size:24px_24px] lg:block">
        <div className="absolute inset-x-12 top-12"><Wordmark /></div>
        <blockquote className="absolute inset-x-12 bottom-14 max-w-[42ch]">
          <p className="if-title text-[30px] leading-snug text-ink">“Write down what you expect before you run it. The surprise is the lesson.”</p>
          <p className="mt-4 text-sm text-ink-3">The InfraForge loop: challenge, build, predict, run, understand, improve.</p>
        </blockquote>
      </aside>
      <main id="main" tabIndex={-1} className="flex flex-col px-4 py-8 outline-none sm:px-10">
        <Link to="/" className="mb-10 self-start rounded-md lg:hidden"><Wordmark /></Link>
        <div className="my-auto w-full max-w-[400px] self-center">{children}</div>
      </main>
    </div>
  );
}
