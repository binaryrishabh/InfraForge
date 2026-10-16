import { createProductModel2 } from "../../model2/product/run";
import type { CompiledProduct } from "../../model2/product/contracts";
import type { ProviderProduct } from "../provider/contracts";
import { providerEvidence } from "../provider/run";
import { digest } from "../provider/fingerprint";
import type { ContentHasher } from "../provider/fingerprint";
import type { MeteringConfig } from "./contracts";
import { usageJournal } from "./journal";
import { reconcileUsage } from "./reconcile";
import type { CausalObserver } from "../../model2/workload/causal";

function meteredRuntime(compiled: CompiledProduct, config: MeteringConfig, expectedInput: string, hasher: ContentHasher, causal?: CausalObserver) {
  if (config.inputFingerprint !== expectedInput) throw Error("Usage run must pin the exact compiled input");
  for (const id of config.objects) if (!compiled.input.resources.some((r) => r.id === id && r.kind === "object-store")) throw Error(`Unknown or unsupported object usage selection: ${id}`);
  for (const id of config.links) if (!compiled.input.links.some((l) => l.id === id)) throw Error(`Unknown directed-link usage selection: ${id}`);
  const journal = usageJournal(config, hasher), runtime = createProductModel2(compiled, journal.observer, causal);
  function evidence() {
    const model = runtime.evidence();
    let usage = journal.capture(model.at, model.capture.failure);
    const errors = reconcileUsage(usage, model);
    if (errors.length) { errors.forEach(journal.invalidate); usage = journal.capture(model.at, model.capture.failure); }
    return { model, usage };
  }
  return { horizon: runtime.horizon, advanceTo: runtime.advanceTo, evidence, frame() { return journal.frame(evidence().usage); } };
}
export function createMeteredProductModel2(compiled: CompiledProduct, config: MeteringConfig, hasher: ContentHasher, causal?: CausalObserver) {
  return meteredRuntime(compiled, config, digest(compiled, hasher), hasher, causal);
}
export function createMeteredProviderModel2(compiled: ProviderProduct, config: MeteringConfig, hasher: ContentHasher) {
  const { fingerprint, ...payload } = compiled;
  if (compiled.schema !== "infraforge-provider-compiled/1" || digest(payload, hasher) !== fingerprint) throw Error("Compiled provider/product content drift");
  const runtime = meteredRuntime(compiled.product, config, compiled.fingerprint, hasher);
  return { horizon: runtime.horizon, advanceTo: runtime.advanceTo, frame: runtime.frame, evidence() { const e = runtime.evidence(); return { ...e, provider: providerEvidence(compiled, e.model) }; } };
}
