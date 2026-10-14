import type { WorkloadProfile } from "@infraforge/domain/workload";

export function SourceInputFacts({ workload, seed }: { workload: WorkloadProfile | null; seed: string | null }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 rounded-md bg-surface px-4 py-3 text-sm sm:grid-cols-2">
      <div className="sm:col-span-2"><dt className="text-xs text-ink-3">Source workload</dt><dd className="text-ink">{workload ? `${workload.targetThroughput.toLocaleString()} requests ${workload.throughputUnit.replaceAll("-", " ")} · ${workload.trafficShape} · ${workload.payloadSize} payloads` : "Unavailable"}</dd></div>
      {workload && <div><dt className="text-xs text-ink-3">Peak multiplier · read share</dt><dd className="text-ink">Peak multiplier: {workload.peakMultiplier ?? "not captured"} · {workload.readWriteRatio === undefined ? "read share not captured" : `${Math.round(workload.readWriteRatio * 100)}% reads`}</dd></div>}
      <div className="min-w-0"><dt className="text-xs text-ink-3">Source seed</dt><dd className="if-num break-all text-ink">{seed ?? "Unavailable"}</dd></div>
    </dl>
  );
}
