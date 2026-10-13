import type { CompareMetric } from "@infraforge/contracts/reports";
import { comparisonValue as value, signedValue } from "../formatDifference";
export function CompareMetrics({ metrics, caption }: { metrics: CompareMetric[]; caption: string }) {
  return <div className="min-w-0">
    <table className="hidden sm:table w-full text-sm table-fixed">
      <caption className="text-left text-[#8B909C] pb-3">{caption} · Δ = later minus earlier. A sign does not mean better or worse.</caption>
      <thead><tr>{["Measure", "Earlier", "Later", "Δ"].map((label) => <th key={label} scope="col" className="text-left p-2 break-words">{label}</th>)}</tr></thead>
      <tbody>{metrics.map((m) => <tr key={m.field} className="border-t border-[#2A2E37]">
        <th scope="row" className="text-left p-2 font-normal break-words">{m.field} ({m.unit}){m.withheldReason && <p className="text-xs text-[#8B909C]">{m.withheldReason}</p>}</th>
        <td className="p-2 break-words">{value(m.earlier)}</td><td className="p-2 break-words">{value(m.later)}</td>
        <td className="p-2 break-words">{signedValue(m.delta)} {m.delta !== null && m.unit}</td>
      </tr>)}</tbody>
    </table>
    <div className="sm:hidden space-y-4"><p className="text-xs text-[#8B909C]">{caption} · Δ = later minus earlier; signs do not mean better or worse.</p>
      {metrics.map((m) => <dl key={m.field} className="border-t border-[#2A2E37] pt-3 text-sm">
        <dt className="font-medium">{m.field} ({m.unit})</dt><dd>Earlier: {value(m.earlier)}</dd><dd>Later: {value(m.later)}</dd>
        <dd>Δ: {signedValue(m.delta)} {m.delta !== null && m.unit}</dd>{m.withheldReason && <dd className="text-xs text-[#8B909C]">{m.withheldReason}</dd>}
      </dl>)}
    </div>
  </div>;
}
