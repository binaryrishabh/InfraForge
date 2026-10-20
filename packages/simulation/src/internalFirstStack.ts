// Internal compiler/qualification surface; never imported by the web workspace.
export { compileFirstStack, FirstStackCompileRefusal } from "./firstStack/compiler";
export type { CompiledFirstStack, FirstStackExecutionPolicy } from "./firstStack/compiler";
export { createFirstStackRuntime } from "./firstStack/run";

export { FIRST_STACK_ENVELOPE, firstStackPreflight, boundedJson } from "./firstStack/bounds";
