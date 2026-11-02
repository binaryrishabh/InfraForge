import type { SavedProductDesign } from "../src/model2/product/contracts";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";

export function trafficConsequence(variable: boolean) {
  // One worker holds the request during CPU and the synchronous database call.
  // Its mean occupancy is 3000 + 1000 + 2*(100 + ceil(1024/125)) = 4218us.
  const d: SavedProductDesign = { schema: "infraforge-saved-design/1", resources: [
    { id: "app", type: "Virtual Machine", x: 0, y: 0, vmExecution: { version: 1, workers: 1, queuedRequests: 256 } },
    { id: "db", type: "Database", x: 1, y: 0 },
  ], connections: [{ id: "app-db", sourceId: "app", sourceType: "Virtual Machine", targetId: "db", targetType: "Database", port: 5432 }],
  workload: { targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light",
    workloadDynamics: { version: 1, arrivalProcess: variable ? "poisson" : "even", applicationCpuCv: variable ? 1 : 0 } } };
  const a = contractFromDesign(d); if ("refused" in a) throw Error(JSON.stringify(a)); a.contract.seed = "traffic-consequence-v1";
  const compiled = compileProduct(d, a.contract); if (!compiled.ok) throw Error(JSON.stringify(compiled));
  const responses: number[] = [], admitted = new Map<string, number>();
  let maxQueueWaitUs = 0, queuedStarts = 0;
  const runtime = createProductModel2(compiled.value, undefined, e => {
    if (e.kind === "caller-terminal" && e.detail.outcome === "completed") responses.push(Number(e.detail.responseUs));
    if (e.resource === "app" && e.work) {
      if (e.kind === "app-admitted") admitted.set(e.work.callId, e.atUs);
      if (e.kind === "app-start") {
        const wait = e.atUs - admitted.get(e.work.callId)!; admitted.delete(e.work.callId);
        maxQueueWaitUs = Math.max(maxQueueWaitUs, wait); if (wait > 0) queuedStarts++;
      }
    }
  });
  runtime.advanceTo(runtime.horizon); const e = runtime.evidence(); responses.sort((a,b) => a-b);
  if (!responses.length) throw Error("Consequence proof has no completed sample");
  const q = (p: number) => responses[Math.ceil(responses.length * p) - 1]! / 1000;
  const failed = e.counts.rejected + e.counts.deadlineExceeded + e.counts.abandoned;
  return { offered: e.counts.offered, completed: e.counts.completed, failed, rejected: e.counts.rejected,
    inFlight: e.counts.offered - e.counts.completed - failed, queuedStarts, maxQueueWaitUs,
    maxSampledAppQueue: Math.max(...e.samples.map(s => s.resources.find(r => r.id === "app")?.queued ?? 0)),
    p50Ms: q(0.5), p95Ms: q(0.95), p99Ms: q(0.99), completedSample: responses.length };
}
