// Internal compiler/qualification surface; browser access is isolated to the worker.
export { compileFirstStack, FirstStackCompileRefusal } from "./firstStack/compiler";
export type { CompiledFirstStack, FirstStackExecutionPolicy } from "./firstStack/compiler";
export { createFirstStackRuntime } from "./firstStack/run";
export { captureReport } from "./firstStack/reportCapture";
export { compileFirstStackIo } from "./firstStack/io";
export type { FiniteIoProfile } from "./model2/data/io-contract";

export { FIRST_STACK_ENVELOPE, firstStackPreflight, boundedJson } from "./firstStack/bounds";
// Offline report arithmetic only; no provider bindings enter the compiler.
export { estimate, sumEstimates, sameScope } from "./reality/provider/pricing";
export type { PriceRule, Scope, Usage } from "./reality/provider/contracts";
