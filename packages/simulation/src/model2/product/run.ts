import { requireKnown } from "../../reality/quantity";
import { createSystemsModel2 } from "../systems/run";
import { replicaController } from "./controller";
import type { CompiledProduct } from "./contracts";
import type { RuntimeUsageObserver } from "../../reality/metering/contracts";
export function createProductModel2(compiled: CompiledProduct, usage?: RuntimeUsageObserver) {
  if (compiled.schema !== "infraforge-compiled-product/1" || compiled.semantic.versions.compiler !== "infraforge-product-compiler/1") throw Error("Unsupported historical compiler version; no silent reinterpretation");
  const controllers: ReturnType<typeof replicaController>[] = [];
  const runtime = createSystemsModel2(compiled.input, { usage, deferredClients: compiled.pools.flatMap((p) => p.artifactClients.map((a) => a.id)), crashes: compiled.crashes.map((f) => ({ target: f.target, at: requireKnown(f.at, "us"), restartAt: requireKnown(f.restartAt, "us") })), install(kernel, context, controls) {
    for (const p of compiled.pools) controllers.push(replicaController(p, kernel, context, controls, requireKnown(compiled.input.horizon, "us")));
  } });
  return { horizon: runtime.horizon, advanceTo: runtime.advanceTo, evidence() { return { ...runtime.evidence(), workloadVersion: "m2h/1" as const, product: { versions: compiled.semantic.versions, semantic: compiled.semantic, controllers: controllers.map((c) => c.evidence()), scope: "Internal compiled authored contracts; no provider calibration/public activation" } }; } };
}
