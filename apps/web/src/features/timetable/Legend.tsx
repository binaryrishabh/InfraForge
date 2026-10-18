import { cx } from "@/ui/cx";

/* How to read the timetable. Each mark keeps one meaning everywhere it appears. */
export function Legend({ className, predictions = false, trains = false, unknown = true, cpu = true, health = true, bands = false }: { className?: string; predictions?: boolean; trains?: boolean; unknown?: boolean; cpu?: boolean; health?: boolean; bands?: boolean }) {
  const rail = (weight: number, color: string) => <span aria-hidden="true" className="inline-block w-5 align-middle" style={{ height: weight, background: color }} />;
  return (
    <ul className={cx("flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-3", className)}>
      {health && <>
        <li className="inline-flex items-center gap-1.5">{rail(1.5, "var(--if-ink-3)")} Healthy</li>
        <li className="inline-flex items-center gap-1.5">{rail(3, "var(--if-warn)")} Degraded</li>
        <li className="inline-flex items-center gap-1.5">{rail(5, "var(--if-hot)")} Saturated</li>
        <li className="inline-flex items-center gap-1.5">{rail(6, "var(--if-fail)")} Failed</li>
      </>}
      {bands && <>
        <li className="inline-flex items-center gap-1.5">{rail(3, "var(--if-fail)")} Process down</li>
        <li className="inline-flex items-center gap-1.5">{rail(3, "var(--if-warn)")} Restarted, not ready</li>
        <li className="inline-flex items-center gap-1.5">{rail(3, "var(--if-ink-2)")} Not eligible at the load balancer</li>
      </>}
      {cpu && <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-3 w-5 bg-ink/15" /> Modeled CPU, 0–100%</li>}
      {unknown && <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="if-hatch inline-block h-3 w-5" /> Not retained, so Unknown</li>}
      <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-3 w-5 bg-fail/20" /> Fault window</li>
      {predictions && <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block size-2 rotate-45 border-[1.5px] border-accent" /> Your prediction (filled when it matched)</li>}
      {trains && <>
        <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-[2px] w-5 bg-read" /> Read request</li>
        <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-[2px] w-5 bg-write" /> Write request</li>
        <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-5 border-t-2 border-dotted border-ink-3" /> Between two records: position not recorded</li>
        <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block size-2.5 rounded-full bg-ink-2" /> Write committed</li>
        <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="text-fail">✕</span> Ended without completing</li>
        <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block size-2.5 rounded-full border-[1.5px] border-ink-2" /> No outcome recorded by the horizon</li>
      </>}
    </ul>
  );
}
