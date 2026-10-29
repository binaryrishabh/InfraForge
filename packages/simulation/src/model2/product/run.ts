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
    ? applicationFlowEvidence(Math.min(compiled.input.limits.maxRawResults, compiled.input.limits.maxTraceRows), Math.min(APPLICATION_FLOW_MAX_BYTES, compiled.input.limits.maxTraceBytes ?? APPLICATION_FLOW_MAX_BYTES)) : undefined;
  const observe: CausalObserver | undefined = flow ? event => { flow.observe(event); causal?.(event); } : causal;
  const controllers: ReturnType<typeof replicaController>[] = [];
  let network: NetworkContext | undefined;
  const runtime = createSystemsModel2(compiled.input, { usage, causal: observe, deferredClients: compiled.pools.flatMap((p) => p.artifactClients.map((a) => a.id)), crashes: compiled.crashes.map((f) => ({ target: f.target, at: requireKnown(f.at, "us"), restartAt: requireKnown(f.restartAt, "us") })), install(kernel, context, controls) {
    network = context;
    for (const p of compiled.pools) controllers.push(replicaController(p, kernel, context, controls, requireKnown(compiled.input.horizon, "us")));
  } });
  return { horizon: runtime.horizon, advanceTo: runtime.advanceTo,
    // Cheap current reads for live views: one resource's counters now, and replica counts. No history is copied.
    inspect: (id: string) => network?.inspect?.(id) ?? network?.observe(id),
    applicationFlowEvidence: () => flow?.measure(),
    inspectQueue: runtime.inspectQueue,
    inspectWorker: runtime.inspectWorker,
    pools: () => controllers.map((c) => c.status()),
    // Whether a resource is up and taking work right now (a crash makes it neither).
    up: (id: string) => { const e = network?.endpoint(id); return !!e && e.alive && e.ready; },
    evidence() { return { ...runtime.evidence(), ...(flow ? { applicationFlow: flow.measure() } : {}), workloadVersion: "m2h/1" as const, product: { versions: compiled.semantic.versions, semantic: compiled.semantic, controllers: controllers.map((c) => c.evidence()), scope: "Internal compiled authored contracts; no provider calibration/public activation" } }; } };
}
