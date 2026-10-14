import type { Infrastructure } from "@infraforge/contracts/infrastructure";
import { useCanvasStore } from "./store/canvasStore";
import { useSimulationStore } from "../monitoring/store/simulationStore";
import { migrateLayoutToCardScale } from "./utils/layoutMigration";

/* Puts a saved design on the canvas, replacing whatever was there. The challenge
identity comes from the server record, never from the URL. */
export function installDesign(design: Infrastructure) {
  if (!Array.isArray(design.layout?.resources) || !Array.isArray(design.layout?.connectionLines)) throw new Error("This saved design is malformed.");
  const store = useCanvasStore.getState();
  store.clearCanvas();
  store.loadLayout(migrateLayoutToCardScale(design.layout.resources, design.layout.layoutVersion), design.layout.connectionLines,
    design.id, design.name, design.challengeId ?? null);
  store.setIsInitialized(true);
  store.setEmptyCanvasStateDismissed(false);
  useSimulationStore.getState().reset();
}

export const hasUnsavedWork = () => {
  const store = useCanvasStore.getState();
  return !store.currentLayoutSaved && store.resources.length > 0;
};
