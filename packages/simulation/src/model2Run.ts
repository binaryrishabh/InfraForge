export type { InterventionOption } from "./model2/product/interventions";
// Browser-safe entry for one Model 2 run: the same module the server uses for the official re-run.
export { createModel2Run, ActionRefused, FAULT_DURATIONS, MAX_RUN_ACTIONS } from "./model2/product/liveRun";
export type { LiveView, Model2Run } from "./model2/product/liveRun";
