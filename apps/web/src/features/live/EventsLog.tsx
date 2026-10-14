import { useEffect, useRef } from "react";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { cx } from "@/ui/cx";

const SEVERITY: Record<string, { label: string; tone: string }> = {
  info: { label: "info", tone: "text-ink-3" },
  warn: { label: "warn", tone: "text-warn" },
  error: { label: "error", tone: "text-fail" },
};

/* Simulator events as they stream in (the last 150 are kept in this view). */
export function EventsLog() {
  const logs = useSimulationStore((s) => s.logs);
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => { if (pinned.current) box.current?.scrollTo({ top: box.current.scrollHeight }); }, [logs]);
  return (
    <div ref={box} role="log" aria-label="Simulator events" tabIndex={0}
      onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
      className="if-scroll h-full overflow-y-auto px-4 py-2 font-mono text-[12px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
      {logs.length === 0 ? <p className="text-ink-3">Waiting for simulator events…</p> : logs.map((log, i) => {
        const sev = SEVERITY[log.severity] ?? SEVERITY.info!;
        return (
          <p key={i} className="grid grid-cols-[auto_3.5rem_1fr] gap-x-3 py-[var(--if-log-gap)]">
            <span className="text-ink-3">{new Date(log.timestamp).toLocaleTimeString()}</span>
            <span className={cx("uppercase", sev.tone)}>{sev.label}</span>
            <span className="min-w-0 break-words text-ink-2">{log.message}</span>
          </p>
        );
      })}
    </div>
  );
}
