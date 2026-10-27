import { Suspense } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { PencilRuler } from "lucide-react";
import { Wordmark } from "@/ui/Brand";
import { ButtonLink } from "@/ui/Button";
import { cx } from "@/ui/cx";
import { Loading, Page } from "@/ui/Page";
import { AccountMenu } from "./AccountMenu";

const NAV = [
  { to: "/home", label: "Home" },
  { to: "/challenges", label: "Challenges" },
  { to: "/designs", label: "Designs" },
  { to: "/runs", label: "Runs" },
] as const;

export function SkipLink() {
  return <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-inverse">Skip to content</a>;
}

/* The navigation is a short line of stations: the page you are on is the filled one. */
function NavItems({ className }: { className?: string }) {
  return (
    <ul className={cx("relative flex w-fit items-center", className)}>
      <li aria-hidden="true" className="pointer-events-none absolute inset-x-4 top-1/2 h-px bg-line-strong" />
      {NAV.map((item) => (
        <li key={item.to} className="relative">
          <NavLink to={item.to} className={({ isActive }) => cx("group relative inline-flex h-9 items-center gap-2 bg-bg px-3 text-sm font-semibold transition-colors",
            isActive ? "text-ink" : "text-ink-3 hover:text-ink")}>
            {({ isActive }) => <>
              <span aria-hidden="true" className={cx("size-[9px] border-[1.5px] transition-colors", isActive ? "border-accent bg-accent" : "border-ink-3 bg-bg group-hover:border-ink")} />
              {item.label}
            </>}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

export function AppShell() {
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b border-line bg-bg">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-6 px-4 sm:px-6 lg:px-8">
          <Link to="/home" aria-label="InfraForge home" className="rounded-md"><Wordmark /></Link>
          <nav aria-label="Primary" className="hidden flex-1 md:block"><NavItems /></nav>
          <div className="ml-auto flex items-center gap-3 md:ml-0">
            <ButtonLink to="/design" size="sm" variant="secondary" className="max-sm:hidden" icon={<PencilRuler size={14} aria-hidden="true" />}>Designer</ButtonLink>
            <AccountMenu />
          </div>
        </div>
        <nav aria-label="Primary" className="if-scroll overflow-x-auto overflow-y-hidden border-t border-line px-2 md:hidden"><NavItems className="h-11" /></nav>
      </header>
      <main id="main" tabIndex={-1} className="outline-none"><Suspense fallback={<Page><Loading label="Loading…" /></Page>}><Outlet /></Suspense></main>
    </div>
  );
}
