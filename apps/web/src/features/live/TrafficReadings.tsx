import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { LatencyBreakdown } from "./LatencyBreakdown";

export function TrafficReadings() {
  const traffic = useSimulationStore(s => s.traffic);
  const rows = [["Offered requests/s", traffic?.offeredRps], ["Completed requests/s", traffic?.completedRps], ["Failed requests/s", traffic?.failedRps],
    ...(["p50", "p95", "p99"] as const).map(p => [p, traffic?.latencyMs[p] == null ? undefined : `${traffic.latencyMs[p]!.toFixed(3).replace(/\.?0+$/, "")} ms`])] as const;
  return <section aria-label="Measured caller traffic" className="border-b border-line px-4 py-3 text-sm">
    <p className="mb-2 font-semibold">Last measured second</p>
    <dl className="grid grid-cols-3 gap-2">{rows.map(([label, value]) => <div key={label}><dt className="text-xs text-ink-3">{label}</dt><dd>{value ?? "Unknown"}</dd></div>)}</dl>
    <p className="mt-2 text-xs text-ink-3">p99 = 99% of completed requests in this measured window were at or below this response time.</p>
    {traffic?.clientRetry && <div aria-label="Client retry load" className="mt-3 border-t border-line pt-2">
      <p className="mb-2 font-semibold">Client retry load</p>
      <dl className="grid grid-cols-3 gap-2">{([
        ["Attempts/s", traffic.clientRetry.attemptRps], ["Retries issued", traffic.clientRetry.retriesIssued],
        ["Recovered", traffic.clientRetry.recovered], ["Exhausted", traffic.clientRetry.exhausted],
        ["Gave up (deadline)", traffic.clientRetry.givenUp], ["Load factor", traffic.clientRetry.extraLoadFactor?.toFixed(2).replace(/\.?0+$/, "")],
      ] as const).map(([label, value]) => <div key={label}><dt className="text-xs text-ink-3">{label}</dt><dd>{value ?? "Unknown"}</dd></div>)}</dl>
      <p className="mt-2 text-xs text-ink-3">Offered requests/s counts originals. Attempts include retries. Retry counters are cumulative; response time includes retry delays.</p>
    </div>}
    {traffic?.latency && <LatencyBreakdown latency={traffic.latency} />}
  </section>;
}
