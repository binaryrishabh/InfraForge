// Explicit internal bridge; the published Model-1 engine entry point is unchanged.
export { compileProduct } from "./model2/product/compiler";
export { boundedProduct } from "./model2/product/bounds";
export { canonical } from "./model2/product/provenance";
export { presentModel2 } from "./model2/product/presentation";
export { createMeteredProductModel2 } from "./reality/metering/run";
export { replayUsage } from "./reality/metering/replay";
export { usageWindow } from "./reality/metering/windows";
export { digest } from "./reality/provider/fingerprint";
export { requireKnown } from "./reality/quantity";
export type { ContentHasher } from "./reality/provider/fingerprint";
export type { ProductContract, SavedProductDesign, CompiledProduct, Diagnostic } from "./model2/product/contracts";
export type { ProductEvidence } from "./model2/product/presentation";
export type { MeteringConfig } from "./reality/metering/contracts";
export type { UsageFrame } from "./reality/metering/measurements";
export type { Quantity, Unit } from "./reality/quantity";
