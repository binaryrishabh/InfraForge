import type { ComputeState } from "../src/model2/compute/contracts";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { quantities } from "./workloadFixture";
import { quotaDesign, prepareQuota } from "./vmCpuQuota.fixture";

export interface QuotaPressureOptions {
  percent?: number; workers?: number; queue?: number; count?: number; interval?: number;
  mode?: "plain" | "flow" | "dependency" | "lb" | "several" | "autoscaled";
  retry?: boolean; lbActive?: number; blockedWait?: number;
}
export function quotaPressure(o: QuotaPressureOptions = {}) {
  const mode = o.mode ?? "plain", d = quotaDesign(mode === "dependency" || mode === "flow" ? "flow" : mode === "lb" || mode === "several" ? "lb" : mode);
  if (mode === "dependency") delete d.resources[0]!.applicationFlow;
  if (mode === "flow") d.resources[0]!.applicationFlow!.operations.read!.steps.unshift({ id: "cpu", kind: "compute" });
  if (mode === "several") {
    d.resources.push({ id: "other", type: "Virtual Machine", x: 1, y: 1 });
    d.connections.push({ id: "lb-other", sourceId: "lb", sourceType: "Load Balancer", targetId: "other", targetType: "Virtual Machine", port: 80 });
  }
  for (const vm of d.resources.filter(r => r.type === "Virtual Machine")) {
    vm.size = "small"; vm.vmExecution = { version: 1, workers: o.workers ?? 4, queuedRequests: o.queue ?? 1000 };
    if (o.percent !== undefined) vm.vmCpuQuota = { version: 1, limitPercent: o.percent };
  }
  const lb = d.resources.find(r => r.type === "Load Balancer");
  if (lb) {
    lb.lbAdmission = { version: 1, maxActive: o.lbActive ?? 128, maxQueued: 128, queueWaitMs: 1000 };
    if (o.retry) lb.retry = { enabled: true, maxAttempts: 2, backoffMs: 10, jitterRatio: 0, maxConcurrentRetries: 8, retryOn: ["backendFailure"] };
  }
  const f = prepareQuota(d);
  if (o.blockedWait !== undefined) {
    const q = quantities();
    for (const demand of f.contract.application!.demands) if (demand.schema === "infraforge-compute-demand/1") demand.blockingWait = q.q(`proof.${demand.id}.wait`, o.blockedWait, "us");
    f.contract.ledger.push(...q.ledger);
  }
  const built = compileProduct(d, f.contract); if (!built.ok) throw Error(JSON.stringify(built.diagnostics));
  built.value.input.arrivals = [{ id: "cpu-quota-load", kind: "trace", trace: {
    schema: "infraforge-arrivals/1", unit: "us", durationUs: 1000000, provenance: "Controlled deterministic application CPU quota proof",
    rows: Array.from({ length: o.count ?? 64 }, (_, i) => ({ id: String(i), atUs: i * (o.interval ?? 0), operation: "read" })),
  } }];
  const admitted: string[] = [], started: string[] = [];
  const runtime = createProductModel2(built.value, undefined, event => {
    if (event.resource === "app" && event.kind === "app-admitted") admitted.push(event.work!.callId);
    if (event.resource === "app" && event.kind === "app-start") started.push(event.work!.callId);
  });
  return { design: d, contract: f.contract, compiled: built.value, runtime, admitted, started };
}
export const quotaState = (f: ReturnType<typeof quotaPressure>, id = "app") => f.runtime.inspect(id) as ComputeState;
export function observeQuota(f: ReturnType<typeof quotaPressure>, until = 1000000) {
  let maxQueued = 0, queueAreaUs = 0, throttledSamples = 0, contendedSamples = 0;
  let previousCpu = 0, maxWindowCoreUs = 0;
  for (let at = 1000; at <= until; at += 1000) {
    f.runtime.advanceTo(at); const s = quotaState(f);
    maxQueued = Math.max(maxQueued, s.queued); queueAreaUs += s.queued * 1000;
    throttledSamples += Number(s.compute!.cpu.throttled);
    contendedSamples += Number(s.compute!.cpu.contended && !s.compute!.cpu.throttled);
    if (at % 100000 === 0) { maxWindowCoreUs = Math.max(maxWindowCoreUs, s.compute!.cpu.appCoreUs - previousCpu); previousCpu = s.compute!.cpu.appCoreUs; }
  }
  const e = f.runtime.evidence(), s = quotaState(f), times = e.results.filter(r => r.outcome === "completed").map(r => r.responseUs).sort((a, b) => a - b);
  if (e.resultRetention.omitted) throw Error("Response time proof requires complete retained results");
  return { maxQueued, queueAreaUs, throttledSamples, contendedSamples, maxWindowCoreUs, appCoreUs: s.compute!.cpu.appCoreUs,
    throttledWallUs: s.compute!.cpu.throttledWallUs, completed: e.counts.completed, refused: s.rejected, p95Us: times[Math.ceil(times.length * 0.95) - 1] };
}
