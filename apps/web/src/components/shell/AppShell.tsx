import { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Wordmark } from "@/ui/Brand";
import { cx } from "@/ui/cx";
import { Loading, Page } from "@/ui/Page";
import { AccountMenu } from "./AccountMenu";
import { workspace } from "@/api/internalModel2.api";
import { useAuthStore } from "@/features/auth/store/auth.store";

const NAV = [
  { to: "/home", label: "Home" },
  { to: "/challenges", label: "Challenges" },
  { to: "/designs", label: "Designs" },
  { to: "/runs", label: "Runs" },
] as const;

export function SkipLink() {
  return <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-inverse">Skip to content</a>;
}

function NavItems({ className, internal }: { className?: string; internal: boolean }) {
  return (
    <ul className={cx("flex items-center gap-1", className)}>
      {NAV.map((item) => (
        <li key={item.to}>
          <NavLink to={item.to} className={({ isActive }) => cx("relative inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors",
            isActive ? "text-ink after:absolute after:inset-x-3 after:-bottom-[11px] after:h-[2px] after:bg-ink" : "text-ink-3 hover:bg-sunken hover:text-ink")}>
            {item.label}
          </NavLink>
        </li>
      ))}
      {internal && <li className="shrink-0"><NavLink to="/internal/model2" className="inline-flex h-9 items-center whitespace-nowrap rounded-md px-3 text-sm text-ink-2 hover:bg-sunken">Model 2 · internal</NavLink></li>}
    </ul>
  );
}

/* Paper shell: one top bar, four destinations, account on the right.
Narrow screens keep the same four links in a scrollable second row. */
export function AppShell() {
  const owner = useAuthStore((s) => s.user?.id), [grantedOwner, setGrantedOwner] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (owner) void workspace(controller.signal).then(() => { if (!controller.signal.aborted) setGrantedOwner(owner); }).catch(() => { if (!controller.signal.aborted) setGrantedOwner(null); });
    return () => controller.abort();
  }, [owner]);
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1360px] items-center gap-6 px-4 sm:px-6 lg:px-8">
          <Link to="/home" aria-label="InfraForge home" className="rounded-md"><Wordmark /></Link>
          <nav aria-label="Primary" className="hidden flex-1 md:block"><NavItems internal={!!owner && grantedOwner === owner} /></nav>
          <div className="ml-auto md:ml-0"><AccountMenu /></div>
        </div>
        <nav aria-label="Primary" className="if-scroll overflow-x-auto overflow-y-hidden border-t border-line px-2 md:hidden"><NavItems internal={!!owner && grantedOwner === owner} className="h-11" /></nav>
      </header>
      <main id="main" tabIndex={-1} className="outline-none"><Suspense fallback={<Page><Loading label="Loading…" /></Page>}><Outlet /></Suspense></main>
    </div>
  );
}
