import { lbAccountingEvidence } from "./lbAccounting";
import { vmMemoryEvidence } from "./vmMemoryEvidence";
import { latencyEvidence } from "./latencyEvidence";
import { APPLICATION_FLOW_MAX_BYTES, applicationFlowEvidence } from "../compute/flowEvidence";
import { requireKnown } from "../../reality/quantity";
import { createSystemsModel2 } from "../systems/run";
import { replicaController } from "./controller";
import type { CompiledProduct } from "./contracts";
import type { RuntimeUsageObserver } from "../../reality/metering/contracts";
import type { CausalObserver } from "../workload/causal";
import type { NetworkContext } from "../network/run";
export function createProductModel2(compiled: CompiledProduct, usage?: RuntimeUsageObserver, causal?: CausalObserver) {
  if (compiled.schema !== "infraforge-compiled-product/1" || compiled.semantic.versions.compiler !== "infraforge-product-compiler/1") throw Error("Unsupported historical compiler version; no silent reinterpretation");
  const flow = compiled.input.resources.some(r => r.kind === "compute" && r.applicationFlow)
    ? applicationFlowEvidence(Math.min(compiled.input.limits.maxRawResults, compiled.input.limits.maxTraceRows), Math.min(APPLICATION_FLOW_MAX_BYTES, compiled.input.limits.maxTraceBytes ?? APPLICATION_FLOW_MAX_BYTES), compiled.input.resources.some(r => r.kind === "compute" && r.applicationFlow?.schema === "application-flow/3") ? "application-flow/3" : compiled.input.resources.some(r => r.kind === "compute" && r.applicationFlow?.schema === "application-flow/2") ? "application-flow/2" : "application-flow/1") : undefined;
  const accounting = compiled.lbAccountingProfile ? lbAccountingEvidence(compiled.input.resources.filter(r => r.kind === "load-balancer").map(r => r.id)) : undefined;
  const latency = compiled.trafficEvidenceProfile ? latencyEvidence(compiled.input.limits.maxLiveCalls ?? compiled.input.limits.maxRequests) : undefined;
  const memory = vmMemoryEvidence(compiled, id => network?.inspect?.(id) ?? network?.observe(id));
  const observe: CausalObserver | undefined = flow || latency || memory || accounting ? event => { accounting?.observe(event); memory?.observe(event.resource); flow?.observe(event); latency?.observe(event); causal?.(event); } : causal;
  // Timing boundaries are observer-only and never enter historical engine inputs.
  const timingObserver: CausalObserver | undefined = compiled.trafficEvidenceProfile ? Object.assign((event: Parameters<CausalObserver>[0]) => observe?.(event), { trafficTiming: true as const }) : observe;
  if (timingObserver && accounting) timingObserver.lbAccounting = true;
  const applied = new Map<string, NonNullable<CompiledProduct["interventionReceipts"]>[number]>();
  const active = new Map<string, NonNullable<CompiledProduct["interventionReceipts"]>[number]>();
  const controllers: ReturnType<typeof replicaController>[] = [];
  let network: NetworkContext | undefined;
  const runtime = createSystemsModel2(compiled.input, { usage, causal: timingObserver, deferredClients: compiled.pools.flatMap((p) => p.artifactClients.map((a) => a.id)), crashes: compiled.crashes.map((f) => ({ target: f.target, at: requireKnown(f.at, "us"), restartAt: requireKnown(f.restartAt, "us") })), install(kernel, context, controls) {
    network = context;
    for (const receipt of compiled.interventionReceipts ?? []) {
      kernel.schedule(receipt.atUs, 0, JSON.stringify(["product-intervention-active", receipt.actionId]), () => { applied.set(receipt.actionId, receipt); if (receipt.endUs !== null) active.set(receipt.actionId, receipt); });
      if (receipt.endUs !== null) kernel.schedule(receipt.endUs, 0, JSON.stringify(["product-intervention-ended", receipt.actionId]), () => active.delete(receipt.actionId));
    }
    for (const p of compiled.pools) controllers.push(replicaController(p, kernel, context, controls, requireKnown(compiled.input.horizon, "us")));
  } });
  return { horizon: runtime.horizon, advanceTo: runtime.advanceTo, measureObjective: runtime.measureObjective,
    // Cheap current reads for live views: one resource's counters now, and replica counts. No history is copied.
    inspect: (id: string) => network?.inspect?.(id) ?? network?.observe(id),
    vmMemoryEvidence: () => memory?.measure(),
    lbAccounting: (id: string) => accounting?.forLb(id),
    inspectData: runtime.inspectData,
    inspectCdn: runtime.inspectCdn,
    inspectMonitor: runtime.inspectMonitor,
    inspectObject: runtime.inspectObject,
    latencyEvidence: (atUs: number) => latency?.measure(atUs),
    applicationFlowEvidence: () => flow?.measure(),
    appliedInterventions: () => [...applied.values()],
    activeInterventions: () => [...active.values()],
    inspectSecurity: runtime.inspectSecurity,
    inspectFunction: runtime.inspectFunction, inspectScheduler: runtime.inspectScheduler, inspectGateway: runtime.inspectGateway, inspectEventBus: runtime.inspectEventBus, inspectQueue: runtime.inspectQueue,
    inspectWorker: runtime.inspectWorker,
    pools: () => controllers.map((c) => c.status()),
    // Whether a resource is up and taking work right now (a crash makes it neither).
    up: (id: string) => { const e = network?.endpoint(id); return !!e && e.alive && e.ready; },
    evidence() { const evidence = runtime.evidence(); return { ...evidence, network: { ...evidence.network, loadBalancers: evidence.network.loadBalancers.map(lb => ({ ...lb, ...(accounting ? { accounting: accounting.forLb(lb.id) } : {}) })) }, ...(memory ? { vmMemory: memory.measure() } : {}), ...(latency ? { latency: latency.measure(evidence.capture.throughUs).latency } : {}), ...(flow ? { applicationFlow: flow.measure() } : {}), workloadVersion: "m2h/1" as const, product: { ...(compiled.interventionReceipts?.length ? {interventions: compiled.interventionReceipts.map(r => ({...r, phase: !applied.has(r.actionId) ? "scheduled" : active.has(r.actionId) ? "active" : "completed"}))} : {}), versions: compiled.semantic.versions, semantic: compiled.semantic, controllers: controllers.map((c) => c.evidence()), scope: "Internal compiled authored contracts; no provider calibration/public activation" } }; } };
}
