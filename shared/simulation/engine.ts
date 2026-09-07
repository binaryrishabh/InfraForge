/* Barrel file. Preserves every existing import site
(`@shared/simulation/engine`) while the implementation lives in focused
modules. Delete nothing from importers; they all resolve through here. */
export { computeTopology, reconcileTopology } from "./topology";
export type { TopologyAnalysis } from "./topology";
export { createInitialState } from "./engineInitialState";
export { tick } from "./engineTick";
export { buildPoolSnapshots, applyManualScale } from "./enginePools";