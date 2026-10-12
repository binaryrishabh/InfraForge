import type { ReactNode } from "react";

export function ReportSection({ title, children, open = false }: {
  title: string; children: ReactNode; open?: boolean;
}) {
  return <details open={open} className="rounded-xl border border-[#2A2E37] bg-[#1C1F26] p-5">
    <summary className="font-medium cursor-pointer focus-visible:outline focus-visible:outline-[#4FA89B]">{title}</summary>
    <div className="mt-4 space-y-3 text-sm leading-relaxed">{children}</div>
  </details>;
}
