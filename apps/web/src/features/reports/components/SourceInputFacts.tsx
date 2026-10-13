import type { WorkloadProfile } from "@infraforge/domain/workload";

export function SourceInputFacts({ workload, seed }: { workload: WorkloadProfile | null; seed: string | null }) {
  return <div className="space-y-1 text-sm">
    <p>Source workload: {workload ? `${workload.targetThroughput.toLocaleString()} requests ${workload.throughputUnit.replaceAll("-", " ")} · ${workload.trafficShape} · ${workload.payloadSize}` : "unavailable"}</p>
    {workload && <p>Peak multiplier: {workload.peakMultiplier ?? "not captured"} · read share: {workload.readWriteRatio === undefined ? "not captured" : `${workload.readWriteRatio * 100}%`}</p>}
    <p className="break-all">Source seed: {seed ?? "unavailable"}</p>
  </div>;
}
