import type { ComputeState } from "../src/model2/compute/contracts";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { quantities } from "./workloadFixture";
import { prepareVm, vmDesign } from "./vmExecution.fixture";

export interface PressureOptions {
  mode?: "plain" | "downstream" | "flow" | "lb" | "several";
  cores?: number; perBurst?: number; bursts?: number; gapUs?: number; retry?: boolean;
}
export function pressure(workers: number, queuedRequests = 32, options: PressureOptions = {}) {
  const mode = options.mode ?? "plain";
  const d = vmDesign(mode === "flow" || mode === "downstream" ? "flow" : mode === "several" ? "lb-db" : "plain");
  if (mode === "downstream") delete d.resources[0]!.applicationFlow;
  if (mode === "flow") d.resources[0]!.applicationFlow!.operations.read!.steps.unshift({ id: "cpu", kind: "compute" });
  if (mode === "lb") {
    d.resources.unshift({ id: "lb", type: "Load Balancer", x: 0, y: 0 });
    d.connections.push({ id: "lb-app", sourceId: "lb", sourceType: "Load Balancer", targetId: "app", targetType: "Virtual Machine", port: 80 });
  }
  if (mode === "several") {
    d.resources = d.resources.filter(r => r.type !== "Database");
    d.connections = d.connections.filter(e => e.targetId !== "db");
  }
  for (const r of d.resources.filter(r => r.type === "Virtual Machine")) { r.size = "large"; r.vmExecution = { version: 1, workers, queuedRequests }; }
  const lb = d.resources.find(r => r.type === "Load Balancer");
  if (lb) lb.lbAdmission = { version: 1, maxActive: 32, maxQueued: 32, queueWaitMs: 1000 };
  if (options.retry && lb) lb.retry = { enabled: true, maxAttempts: 2, backoffMs: 10, jitterRatio: 0, maxConcurrentRetries: 8, retryOn: ["backendFailure"] };
  const f = prepareVm(d), q = quantities();
  for (const [owner, r] of Object.entries(f.contract.nodes)) for (const { role, config } of r.resources) {
    if (config.kind === "compute" && options.cores !== undefined) config.cores = q.q(`proof.${owner}.${role}.cores`, options.cores, "cores");
    if (config.kind === "relational") for (const [op, plan] of Object.entries(config.plans)) for (const s of plan.statements) s.blockingWait = q.q(`proof.db.${op}.wait`, 20000, "us");
  }
  f.contract.ledger.push(...q.ledger);
  const compiled = compileProduct(d, f.contract); if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const perBurst = options.perBurst ?? 8, bursts = options.bursts ?? 32, gapUs = options.gapUs ?? 25000;
  compiled.value.input.arrivals = [{ id: "vm-bursts", kind: "trace", trace: {
    schema: "infraforge-arrivals/1", unit: "us", durationUs: 1000000, provenance: "Controlled deterministic VM admission proof",
    rows: Array.from({ length: perBurst * bursts }, (_, i) => ({ id: String(i), atUs: Math.floor(i / perBurst) * gapUs, operation: "read" })),
  } }];
  const admitted: string[] = [], started: string[] = [];
  const runtime = createProductModel2(compiled.value, undefined, event => {
    if (event.resource === "app" && event.kind === "app-admitted") admitted.push(event.work!.callId);
    if (event.resource === "app" && event.kind === "app-start") started.push(event.work!.callId);
  });
  return { ...f, design: d, compiled: compiled.value, runtime, admitted, started };
}

export function observePressure(f: ReturnType<typeof pressure>, id = "app", until = 1000000) {
  let maxQueued = 0, maxActive = 0, maxRunnable = 0, maxBlocked = 0, maxAllocatedCores = 0, queueAreaUs = 0, maxBackpressure = false;
  for (let at = 250; at <= until; at += 250) {
    f.runtime.advanceTo(at);
    const s = f.runtime.inspect(id) as ComputeState;
    if (!s.compute) throw Error("Expected real compute state");
    maxQueued = Math.max(maxQueued, s.queued); maxActive = Math.max(maxActive, s.compute.workers.configured - s.compute.workers.idle);
    maxRunnable = Math.max(maxRunnable, s.compute.workers.runnable); maxBlocked = Math.max(maxBlocked, s.compute.workers.blockedDependency);
    maxAllocatedCores = Math.max(maxAllocatedCores, s.compute.cpu.allocations.reduce((sum, a) => sum + a.cores, 0));
    queueAreaUs += s.queued * 250; maxBackpressure ||= s.compute.symptoms.includes("backpressured");
  }
  const e = f.runtime.evidence(), s = f.runtime.inspect(id) as ComputeState, times = e.results.filter(r => r.outcome === "completed").map(r => r.responseUs).sort((a, b) => a - b);
  if (e.resultRetention.omitted) throw Error("Response time proof requires complete retained results");
  return { maxQueued, maxActive, maxRunnable, maxBlocked, maxAllocatedCores, sampledQueueUs: queueAreaUs, maxBackpressure,
    completed: e.counts.completed, rejected: e.counts.rejected, admitted: s.admitted, vmRefusals: s.rejected,
    p95Us: times[Math.ceil(times.length * 0.95) - 1], appCoreUs: s.compute!.cpu.appCoreUs,
    availableCoreUs: s.compute!.cpu.availableCoreUs, unsatisfiedParallelismUs: s.compute!.cpu.unsatisfiedParallelismUs };
}

export function workloadAt(d: SavedProductDesign, rps: number) { d.workload = { ...d.workload, targetThroughput: rps * 60, readWriteRatio: 1 }; return d; }
