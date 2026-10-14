import type { ReactNode } from "react";

export function ControlBlock({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-4 last:border-b-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {aside && <span className="text-xs text-ink-3">{aside}</span>}
      </div>
      {children}
    </section>
  );
}
