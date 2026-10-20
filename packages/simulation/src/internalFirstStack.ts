// Internal compiler/qualification surface; never imported by the web workspace.
export { compileFirstStack, FirstStackCompileRefusal } from "./firstStack/compiler";
export type { CompiledFirstStack, FirstStackExecutionPolicy } from "./firstStack/compiler";
export { createFirstStackRuntime } from "./firstStack/run";
export { compileFirstStackIo } from "./firstStack/io";
export type { FiniteIoProfile } from "./model2/data/io-contract";

export { FIRST_STACK_ENVELOPE, firstStackPreflight, boundedJson } from "./firstStack/bounds";
