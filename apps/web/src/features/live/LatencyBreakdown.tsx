import type { LatencyCategory, LatencyMetrics, LatencyPart } from "@infraforge/contracts/telemetry";

const categories: Array<[LatencyCategory, string]> = [
  ["connectionWait", "Connection acquisition wait"], ["networkTransit", "Network transit"],
  ["loadBalancerPending", "Load-balancer pending wait"], ["applicationQueue", "Application queue wait"],
  ["applicationService", "Application service"], ["dependency", "Downstream / dependency time"],
  ["clientRetryDelay", "Client retry delay"], ["failedAttempt", "Failed-attempt time"],
];
const number = (n: number) => n.toFixed(3).replace(/\.?0+$/, "");
const value = (part?: LatencyPart) => part ? `${number(part.meanMs)} ms (${part.share === null ? "Unknown" : `${number(part.share * 100)}%`})` : "Unknown";

export function LatencyBreakdown({ latency }: { latency: LatencyMetrics }) {
  const { typical, slowestOnePercent: tail } = latency;
  const rows: Array<[string, LatencyPart | undefined, LatencyPart | undefined]> = categories
    .filter(([key]) => typical?.categories[key] !== undefined || tail?.categories[key] !== undefined)
    .map(([key, label]) => [label, typical?.categories[key], tail?.categories[key]]);
  rows.push(["Not attributed", typical?.unattributed, tail?.unattributed]);
  rows.push(["Total response time", typical ? { meanMs: typical.totalMs, share: typical.totalMs > 0 ? 1 : null } : undefined,
    tail ? { meanMs: tail.totalMs, share: tail.totalMs > 0 ? 1 : null } : undefined]);
  return <div aria-label="Completed request latency breakdown" className="mt-3 min-w-0 border-t border-line pt-2">
    <p className="mb-2 font-semibold">Where completed requests spent their time</p>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] text-left text-xs">
        <thead><tr><th scope="col" className="py-1 pr-2">Time spent</th>
          <th scope="col" className="py-1 pr-2">Typical request<br /><span className="font-normal">Mean ms and share; {typical ? `${typical.sampleCount} requests` : "Unknown"}</span></th>
          <th scope="col" className="py-1">Slowest 1%<br /><span className="font-normal">Mean ms and share; {tail ? `${tail.sampleCount} requests` : "Unknown"}</span></th></tr></thead>
        <tbody>{rows.map(([label, all, slow]) => <tr key={label} className="border-t border-line">
          <th scope="row" className="py-1 pr-2 font-normal">{label}</th><td className="py-1 pr-2">{value(all)}</td><td className="py-1">{value(slow)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="mt-2 text-xs text-ink-3">Completed: {latency.completedCount}. Failed: {latency.failedCount}. Stopped: {latency.cancelledCount}. In flight: {latency.inFlightCount}. Only completed requests enter the table.</p>
    <p className="mt-2 text-xs text-ink-3">Times are exclusive: each request&apos;s response time is split into non-overlapping parts. Slowest 1% means requests at or above this window&apos;s p99.</p>
    {latency.completedCount < 100 && <p className="mt-1 text-xs text-ink-3">Slowest 1% needs at least 100 completed requests in the window.</p>}
    {latency.status === "sample-cap-exceeded" && <p className="mt-1 text-xs text-ink-3">This window exceeded {latency.sampleCap} completed requests. Composition and percentiles are Unknown.</p>}
    {latency.rootBoundaryExceededCount > 0 && <p className="mt-1 text-xs text-ink-3">{latency.rootBoundaryExceededCount} completed requests exceeded the timing detail limit; their full response time is not attributed.</p>}
    <p className="mt-1 text-xs text-ink-3">{latency.unproven}</p>
  </div>;
}
