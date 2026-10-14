import type { ReactNode } from "react";
import { Section } from "@/ui/Page";

/* A numbered report section. Long, secondary records may be folded into a
native disclosure; key facts are never hidden by default. */
export function ReportSection({ number, title, children, aside, id, fold }: {
  number?: number; title: string; children: ReactNode; aside?: ReactNode; id?: string; fold?: { summary: string; open?: boolean };
}) {
  return (
    <Section number={number} title={title} aside={aside} id={id} className="mt-[var(--if-section)]">
      {fold ? (
        <details open={fold.open} className="group rounded-md border border-line">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-ink marker:hidden [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="mr-2 inline-block text-ink-3 transition-transform group-open:rotate-90">›</span>{fold.summary}
          </summary>
          <div className="border-t border-line px-4 py-4 text-sm leading-relaxed text-ink-2">{children}</div>
        </details>
      ) : <div className="text-sm leading-relaxed text-ink-2">{children}</div>}
    </Section>
  );
}

export function Statement({ message, sources, verb = "Source" }: { message: string; sources: string[]; verb?: string }) {
  return (
    <li className="border-l-2 border-line-strong pl-3">
      <p className="text-[15px] text-ink">{message}</p>
      <p className="if-num mt-0.5 text-[11px] text-ink-3">{verb}: {sources.join(", ")}</p>
    </li>
  );
}
