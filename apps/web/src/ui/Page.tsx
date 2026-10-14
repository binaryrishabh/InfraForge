import type { ReactNode } from "react";
import { cx } from "./cx";

export function Page({ children, className, width = "default" }: { children: ReactNode; className?: string; width?: "default" | "narrow" | "wide" }) {
  return (
    <div className={cx("mx-auto w-full px-4 pb-20 sm:px-6 lg:px-8",
      width === "narrow" ? "max-w-[760px]" : width === "wide" ? "max-w-[1360px]" : "max-w-[1160px]", className)}>
      {children}
    </div>
  );
}

export function PageHeader({ eyebrow, title, lede, actions, children }: { eyebrow?: ReactNode; title: ReactNode; lede?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 border-b border-line pt-8 pb-6 sm:pt-12 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0 max-w-[68ch]">
        {eyebrow && <p className="if-eyebrow mb-2">{eyebrow}</p>}
        <h1 className="if-display text-[34px] text-ink sm:text-[42px]">{title}</h1>
        {lede && <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{lede}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap gap-2 md:justify-end">{actions}</div>}
    </header>
  );
}

/* Numbered report-style section: the number is a marginal note, the title an editorial heading. */
export function Section({ number, title, aside, children, id, className, level = 2 }: {
  number?: string | number; title: ReactNode; aside?: ReactNode; children: ReactNode; id?: string; className?: string; level?: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={id ? `${id}-title` : undefined} className={cx("border-t border-line pt-5", className)}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Heading id={id ? `${id}-title` : undefined} className={cx("if-title text-ink", level === 2 ? "text-[23px]" : "text-[19px]")}>
          {number !== undefined && <span className="if-num mr-2.5 align-[0.12em] text-[13px] font-normal text-ink-3">§{number}</span>}
          {title}
        </Heading>
        {aside && <div className="text-sm text-ink-3">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Panel({ children, className, as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" | "aside" }) {
  return <As className={cx("rounded-lg border border-line bg-raised", className)}>{children}</As>;
}

export function EmptyState({ title, children, action, icon }: { title: ReactNode; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line-strong bg-surface px-6 py-8">
      {icon && <div aria-hidden="true" className="text-ink-3">{icon}</div>}
      <h3 className="if-title text-[20px] text-ink">{title}</h3>
      {children && <div className="max-w-[60ch] text-sm text-ink-2">{children}</div>}
      {action}
    </div>
  );
}

export type NoticeTone = "info" | "warn" | "fail" | "ok" | "marker";
const NOTICE: Record<NoticeTone, string> = {
  info: "border-accent/35 bg-accent-soft",
  warn: "border-warn/35 bg-warn-soft",
  fail: "border-fail/35 bg-fail-soft",
  ok: "border-ok/35 bg-ok-soft",
  marker: "border-marker bg-marker-soft",
};
export function Notice({ tone = "info", title, children, className, role }: { tone?: NoticeTone; title?: ReactNode; children?: ReactNode; className?: string; role?: "alert" | "status" }) {
  return (
    <div role={role} className={cx("rounded-md border-l-[3px] border px-3.5 py-2.5 text-sm text-ink", NOTICE[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cx("text-ink-2", !!title && "mt-0.5")}>{children}</div>}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 py-10 text-sm text-ink-3">
      <span aria-hidden="true" className="inline-block size-3 rounded-full bg-ink-3 if-pulse" />
      {label}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="if-num inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong bg-surface px-1 text-[11px] text-ink-2">{children}</kbd>;
}

export function Stat({ label, value, note, className }: { label: ReactNode; value: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <dt className="if-eyebrow">{label}</dt>
      <dd className="if-num mt-1 text-[20px] text-ink">{value}</dd>
      {note && <dd className="mt-0.5 text-xs text-ink-3">{note}</dd>}
    </div>
  );
}
