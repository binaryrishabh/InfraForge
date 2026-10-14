import type { ReactNode } from "react";

export function InspectorSection({ title, children, hint }: { title: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-4">
      <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
