import type { CompareMetric } from "@infraforge/contracts/reports";
import { comparisonValue as value, signedValue } from "../formatDifference";

/* Earlier, later and the signed difference, in neutral ink: a sign is a
direction, never a judgement. Withheld deltas say why. */
export function CompareMetrics({ metrics, caption }: { metrics: CompareMetric[]; caption: string }) {
  return (
    <div className="min-w-0">
      <table className="hidden w-full table-fixed text-sm sm:table">
        <caption className="pb-2 text-left text-xs text-ink-3">{caption} · Δ = later minus earlier. A sign does not mean better or worse.</caption>
        <thead className="border-b border-line-strong text-left text-xs text-ink-3">
          <tr>{["Measure", "Earlier", "Later", "Δ"].map((label) => <th key={label} scope="col" className="break-words px-2 py-2 font-medium">{label}</th>)}</tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.field} className="border-b border-line align-top">
              <th scope="row" className="break-words px-2 py-2 text-left font-normal text-ink">{m.field} <span className="text-ink-3">({m.unit})</span>
                {m.withheldReason && <span className="mt-0.5 block text-xs text-ink-3">{m.withheldReason}</span>}</th>
              <td className="if-num break-words px-2 py-2 text-ink">{value(m.earlier)}</td>
              <td className="if-num break-words px-2 py-2 text-ink">{value(m.later)}</td>
              <td className="if-num break-words px-2 py-2 text-ink">{signedValue(m.delta)} {m.delta !== null && <span className="text-ink-3">{m.unit}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-3 sm:hidden">
        <p className="text-xs text-ink-3">{caption} · Δ = later minus earlier; signs do not mean better or worse.</p>
        {metrics.map((m) => (
          <dl key={m.field} className="border-t border-line pt-2 text-sm">
            <dt className="font-medium text-ink">{m.field} ({m.unit})</dt>
            <dd className="if-num">Earlier: {value(m.earlier)}</dd><dd className="if-num">Later: {value(m.later)}</dd>
            <dd className="if-num">Δ: {signedValue(m.delta)} {m.delta !== null && m.unit}</dd>
            {m.withheldReason && <dd className="text-xs text-ink-3">{m.withheldReason}</dd>}
          </dl>
        ))}
      </div>
    </div>
  );
}
