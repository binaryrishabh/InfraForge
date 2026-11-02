import type { LatencyCategory } from "@infraforge/contracts/telemetry";
import { latencyDesign } from "./latency.fixture";
import { compileProduct, contractFromDesign, currentAdapterProfiles, createProductModel2 } from "../src/internalProduct";
import { withRunLength } from "../src/model2/product/runContract";
import { latencyComposition } from "../src/model2/workload/latencyComposition";

function measure(rate: number, retry = false, queue = 256) {
  const design = latencyDesign(retry);
  design.workload.targetThroughput = rate * 60;
  design.workload.workloadDynamics = { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0.5 };
  design.resources.find(r => r.id === "app")!.vmExecution!.queuedRequests = queue;
  const b = contractFromDesign(design, { adapterProfiles: [...currentAdapterProfiles(design.resources, design.workload), "traffic-evidence/2"] });
  if ("refused" in b) throw Error(JSON.stringify(b));
  const c = compileProduct(design, withRunLength(b.contract, 8, "latency-load-demonstration")); if (!c.ok) throw Error(JSON.stringify(c));
  let conserved = 0;
  const accounting = latencyComposition(c.value.input.limits.maxLiveCalls!, s => {
    const parts = Object.values(s.categoriesUs);
    if (parts.some(v => v < 0) || s.unattributedUs < 0 || parts.reduce((n, v) => n + v, s.unattributedUs) !== s.responseUs) throw Error("Caller time was not conserved");
    conserved++;
  });
  const run = createProductModel2(c.value, undefined, accounting.observe); run.advanceTo(8000000);
  return { evidence: run.evidence(), conserved };
}

export function latencyDemonstration() {
  const low = measure(150), high = measure(215), repeat = measure(215), retried = measure(1200, true, 0);
  const typical = high.evidence.latency!.typical!, tail = high.evidence.latency!.slowestOnePercent!;
  const differences = (Object.keys(typical.categories) as LatencyCategory[]).map(category => ({ category,
    meanDifferenceMs: (tail.categories[category]?.meanMs ?? 0) - typical.categories[category]!.meanMs })).sort((a, b) => b.meanDifferenceMs - a.meanDifferenceMs);
  return { seed: "latency-load-demonstration", measuredWindowSeconds: [7, 8], lowRps: 150, highRps: 215,
    low: low.evidence.latency!, high: high.evidence.latency!, largestTailGrowth: differences[0]!,
    retry: { originals: retried.evidence.clientRetry!.originalsOffered, attempts: retried.evidence.clientRetry!.totalAttempts,
      meanDelayMs: retried.evidence.latency!.typical!.categories.clientRetryDelay?.meanMs ?? null },
    conserved: low.conserved + high.conserved + retried.conserved,
    repeatIdentical: JSON.stringify(repeat.evidence) === JSON.stringify(high.evidence) };
}
