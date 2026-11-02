import type { WorkloadObjective } from "@infraforge/domain/workload";
import { compileProduct, contractFromDesign, createProductModel2, currentAdapterProfiles } from "../src/internalProduct";
import { withRunLength } from "../src/model2/product/runContract";
import { latencyDesign } from "./latency.fixture";

// One worker holds the 3 ms app read and 1 ms database read plus transport.
// At 200 reads/s (5 ms spacing), choose 95% within 50 ms before measuring any variant.
const objective: WorkloadObjective = { version: 1, maxResponseMs: 50, targetSuccessPercent: 95 };
const seed = "traffic-objectives-demonstration", seconds = 8, rps = 200;

function measure(mode: "A" | "B" | "C") {
  const design = latencyDesign(mode === "C");
  design.workload.targetThroughput = rps * 60;
  design.workload.workloadObjective = { ...objective };
  design.resources.find(r => r.id === "app")!.vmExecution!.queuedRequests = 4;
  if (mode !== "A") design.workload.workloadDynamics = { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0.5 };
  const b = contractFromDesign(design, { adapterProfiles: [...currentAdapterProfiles(design.resources, design.workload), "traffic-evidence/2"] });
  if ("refused" in b) throw Error(JSON.stringify(b));
  const c = compileProduct(design, withRunLength(b.contract, seconds, seed)); if (!c.ok) throw Error(JSON.stringify(c));
  const arrivals: Array<{ root: string; atUs: number; operation: string }> = [];
  const run = createProductModel2(c.value, undefined, event => {
    if (event.kind === "caller-offered") arrivals.push({ root: event.work!.rootId, atUs: event.atUs, operation: event.work!.operation });
  });
  // Check the invariant throughout the run, including unresolved requests.
  for (let second = 0; second <= seconds; second++) {
    run.advanceTo(second * 1000000);
    const o = run.measureObjective()!;
    if (o.offered !== o.good + o.late + o.failed + o.deadlineExceeded + o.abandoned + o.unresolvedPastThreshold + o.pending)
      throw Error("Original request accounting was not conserved");
  }
  const e = run.evidence();
  return { summary: { objective: e.objective!, attempts: e.clientRetry?.totalAttempts ?? e.counts.offered }, arrivals, evidenceBytes: JSON.stringify(e) };
}

export function objectiveDemonstration() {
  const a = measure("A"), b = measure("B"), c = measure("C"), repeat = measure("C");
  return { seed, seconds, rps, workers: 1, queuedRequests: 4, objective,
    heldEqual: "Topology, seed, read-only 200/s declared rate, 8-second horizon, queue and objective. A has even arrivals and fixed CPU. B and C share exact Poisson original arrival identities/times/operations and CV 0.5; only C enables client retries. A and B need not offer equal counts.",
    arrivalsBandCIdentical: JSON.stringify(b.arrivals) === JSON.stringify(c.arrivals), repeatIdentical: repeat.evidenceBytes === c.evidenceBytes,
    runs: { A: a.summary, B: b.summary, C: c.summary } };
}
