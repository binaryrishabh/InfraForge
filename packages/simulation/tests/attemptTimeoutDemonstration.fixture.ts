import { compileProduct, contractFromDesign, createProductModel2, currentAdapterProfiles } from "../src/internalProduct";
import { withRunLength } from "../src/model2/product/runContract";
import { latencyComposition, type LatencySample } from "../src/model2/workload/latencyComposition";
import { latencyDesign } from "./latency.fixture";
import { quantities } from "./workloadFixture";

// Choose before measuring: app CPU = 3 ms * (0.5 + 0.5 E), median 2.54 ms,
// p95 5.99 ms. One DB query slot with an authored 20 ms read plus about 1 ms
// transit gives typical ~24 ms and p95 ~27 ms. Choose a 26 ms attempt timeout.
// 40 originals/s offers 80% of the database's 50 queries/s slot capacity before
// retries. The one app worker holds its slot while waiting for the database.
const seed = "attempt-timeout-demonstration", seconds = 8, loadSeconds = 6;
const rps = 40, timeoutMs = 26, dbReadCpuUs = 20000;

function measure(mode: "A" | "B" | "C") {
  const design = latencyDesign(mode !== "A");
  design.workload.targetThroughput = rps * 60;
  design.workload.workloadDynamics = { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0.5 };
  design.workload.workloadObjective = { version: 1, maxResponseMs: 100, targetSuccessPercent: 95 };
  design.resources.find(r => r.id === "app")!.vmExecution!.queuedRequests = 16;
  design.resources.find(r => r.id === "db")!.dbConcurrency = { version: 1, activeQueries: 1, queuedQueries: 16 };
  if (mode !== "A") design.workload.clientRetry = { version: 1, maxAttempts: 3, backoffMs: 5, ...(mode === "C" ? { attemptTimeoutMs: timeoutMs } : {}) };
  const b = contractFromDesign(design, { adapterProfiles: [...currentAdapterProfiles(design.resources, design.workload), "traffic-evidence/2"] });
  if ("refused" in b) throw Error(JSON.stringify(b));
  const contract = withRunLength(b.contract, seconds, seed), { q, ledger } = quantities();
  const db = contract.nodes.db!.resources.find(r => r.config.kind === "relational")!.config;
  if (db.kind !== "relational") throw Error("Expected relational query owner");
  db.plans.read!.statements[0]!.cpu = q("demo.db.read.cpu", dbReadCpuUs, "cpu-us");
  contract.arrival.changes = [{ at: q("demo.stop", loadSeconds * 1_000_000, "us"), fraction: q("demo.zero", 0, "ratio") }];
  contract.ledger.push(...ledger);
  contract.limits.maxRawResults = 1000;
  const c = compileProduct(design, contract); if (!c.ok) throw Error(JSON.stringify(c));
  const arrivals: Array<[number, string, string]> = [], terminals: string[] = [], samples: LatencySample[] = [];
  const accounting = latencyComposition(c.value.input.limits.maxRequests, s => samples.push(s));
  const run = createProductModel2(c.value, undefined, event => {
    accounting.observe(event);
    if (event.kind === "caller-offered") arrivals.push([event.atUs, event.work!.rootId, event.work!.operation]);
    if (event.kind === "caller-terminal") terminals.push(event.work!.rootId);
  });
  let objectivesConserved = true;
  for (let second = 0; second <= seconds; second++) {
    run.advanceTo(second * 1_000_000);
    const o = run.measureObjective()!;
    objectivesConserved &&= o.offered === o.good + o.late + o.failed + o.deadlineExceeded + o.abandoned + o.unresolvedPastThreshold + o.pending;
  }
  const e = run.evidence(), retry = e.clientRetry;
  const completed = e.results.filter(r => r.outcome === "completed").map(r => r.responseUs).sort((a, b) => a - b);
  const percentile = (p: number) => completed.length ? completed[Math.ceil(p * completed.length) - 1]! / 1000 : null;
  const attempts = retry?.totalAttempts ?? e.counts.offered;
  return { arrivals, bytes: JSON.stringify(e), summary: {
    originals: e.counts.offered, attempts, attemptsTimedOut: retry?.attemptsTimedOut ?? null,
    cancellationRequested: retry?.timeoutCancellationsRequested ?? null, cancellationConfirmedAtEntry: retry?.timeoutCancellationsConfirmed ?? null,
    supersededOutcomes: retry?.supersededOutcomes ?? null, wastedCompletions: retry?.wastedCompletions ?? null,
    recoveredByTimeoutRetry: retry?.recoveredByTimeoutRetry ?? null,
    completed: e.counts.completed, failed: e.counts.rejected + e.counts.deadlineExceeded + e.counts.abandoned, inFlight: e.counts.inFlight,
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99), factor: attempts / e.counts.offered,
    lbReceived: e.network.loadBalancers[0]!.received, appReceived: e.resources.find(r => r.id === "app")!.received, dbReceived: e.resources.find(r => r.id === "db")!.received,
    uniqueTerminals: new Set(terminals).size, terminals: terminals.length,
    conservation: samples.length === e.counts.completed && samples.every(s => Object.values(s.categoriesUs).reduce((n, t) => n + t, s.unattributedUs) === s.responseUs && s.unattributedUs >= 0), objectivesConserved,
  } };
}

export function attemptTimeoutDemonstration() {
  const a = measure("A"), b = measure("B"), c = measure("C"), repeat = measure("C");
  return { seed, seconds, loadSeconds, rps, timeoutMs, dbReadCpuUs, appWorkers: 1, dbQuerySlots: 1,
    scope: "Same authored topology, query demand, seed, original Poisson arrivals and CPU CV 0.5. A: no retries; B: rejection-only; C: attempt timeout. Cancellation confirmation is at entry; transport-hidden downstream outcomes remain unmeasured. Null timeout counters in A/B mean not captured. Percentiles cover all completed originals, not attempts.",
    originalsIdentical: JSON.stringify(a.arrivals) === JSON.stringify(b.arrivals) && JSON.stringify(b.arrivals) === JSON.stringify(c.arrivals),
    repeatIdentical: repeat.bytes === c.bytes, runs: { A: a.summary, B: b.summary, C: c.summary } };
}
