import type { Infrastructure } from "@infraforge/contracts/infrastructure";
import type { RunTopology } from "@infraforge/contracts/run-inputs";
import { useCanvasStore } from "./store/canvasStore";
import { useSimulationStore } from "../monitoring/store/simulationStore";
import { migrateLayoutToCardScale } from "./utils/layoutMigration";

export interface ImprovementContext { sourceRunId: string; designId: string }
export interface CanvasRerunRequest { sourceId: string; designId: string; inputHash: string; matchedStop: boolean; layout: RunTopology }
export function readImprovementContext(state: unknown, designId: string | null): ImprovementContext | null {
  const context = (state as { improveRun?: Partial<ImprovementContext> } | null)?.improveRun;
  return typeof context?.sourceRunId === "string" && typeof context.designId === "string" && context.designId === designId
    ? { sourceRunId: context.sourceRunId, designId: context.designId } : null;
}
export function installImprovementDesign(design: Infrastructure) {
  if (!Array.isArray(design.layout?.resources) || !Array.isArray(design.layout?.connectionLines)) throw new Error("Saved design is malformed");
  const store = useCanvasStore.getState();
  store.clearCanvas();
  store.loadLayout(migrateLayoutToCardScale(design.layout.resources, design.layout.layoutVersion), design.layout.connectionLines, design.id, design.name);
  store.setIsInitialized(true);
  useSimulationStore.getState().reset();
}
