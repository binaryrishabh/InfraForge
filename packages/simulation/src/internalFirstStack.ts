// Internal compiler/qualification surface; never imported by the web workspace.
export { compileFirstStack, FirstStackCompileRefusal } from "./firstStack/compiler";
export type { CompiledFirstStack, FirstStackExecutionPolicy } from "./firstStack/compiler";
export { createFirstStackRuntime } from "./firstStack/run";
export { compileFirstStackIo } from "./firstStack/io";
export type { FiniteIoProfile } from "./model2/data/io-contract";

export { FIRST_STACK_ENVELOPE, firstStackPreflight, boundedJson } from "./firstStack/bounds";
// Offline report arithmetic only; no provider bindings enter the compiler.
export { estimate, sumEstimates, sameScope } from "./reality/provider/pricing";
export type { PriceRule, Scope, Usage } from "./reality/provider/contracts";
