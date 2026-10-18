import { HealthMark } from "@/ui/HealthMark";
import { StationGlyph } from "@/ui/StationGlyph";
import { formatTime, sampleAt, type TimetableModel } from "@/features/timetable/model";

/* The recorded values at the cursor, as text. This is the exact reading of the picture
above and the screen-reader equivalent of the canvas; it never shows a value from a
neighbouring second. */
export function MomentReadout({ model, t }: { model: TimetableModel; t: number }) {
  const system = sampleAt(model.system, t, 1);
  const windows = model.windows.filter((w) => t >= w.from && t < w.to);
  const predictions = model.predictions.filter((p) => p.t === t);
  return (
    <div role="status" aria-live="polite" className="flex h-full flex-col">
      <div className="flex items-baseline justify-between gap-3 border-b border-line pb-3">
        <p className="if-num text-[28px] font-semibold leading-none text-ink">{formatTime(t, model.unit)}</p>
        <HealthMark value={system?.health} label={system ? `System ${system.health}` : "System not retained"} />
      </div>
      {windows.length > 0 && <ul className="mt-3 space-y-1 text-xs">{windows.map((w) => (
        <li key={`${w.kind}${w.from}`} className={w.kind === "fault" ? "text-fail" : "text-ink-3"}>
          {w.kind === "unknown" ? <span className="if-hatch mr-1.5 inline-block size-2.5 align-middle" /> : null}{w.label}
        </li>))}</ul>}
      <table className="mt-3 w-full text-left text-sm">
        <caption className="sr-only">Recorded state of each resource at {formatTime(t, model.unit)}</caption>
        <thead className="text-xs text-ink-3"><tr><th className="pb-1 font-medium">Resource</th><th className="pb-1 font-medium">State</th><th className="pb-1 text-right font-medium">CPU</th></tr></thead>
        <tbody>{model.stations.map((s) => {
          const sample = model.lanes[s.id] ? sampleAt(model.lanes[s.id]!.samples, t, 1) : null;
          return (
            <tr key={s.id} className="border-t border-line">
              <th scope="row" className="py-1.5 pr-2 font-medium text-ink"><span className="inline-flex items-center gap-2"><StationGlyph type={s.type ?? ""} size={14} className="text-ink-3" />{s.label}</span></th>
              <td className="py-1.5"><HealthMark size="sm" value={sample?.health} label={sample ? undefined : "Not retained"} /></td>
              <td className="if-num py-1.5 text-right text-ink-2">{sample?.cpu !== undefined ? `${sample.cpu}%` : "—"}</td>
            </tr>
          );
        })}</tbody>
      </table>
      {predictions.length > 0 && <ul className="mt-4 space-y-2 border-t border-line pt-3 text-sm">{predictions.map((p) => (
        <li key={p.prompt}>
          <p className="text-xs text-ink-3">{p.prompt}</p>
          <p className="mt-0.5"><span className="font-semibold text-accent">You: {p.predicted}</span><span className="text-ink-3"> · </span><span className="font-semibold text-ink">Recorded: {p.recorded ?? "unknown"}</span></p>
        </li>
      ))}</ul>}
    </div>
  );
}
