import type { Infrastructure } from "@infraforge/contracts/infrastructure";
import type { RunTopology } from "@infraforge/contracts/run-inputs";
import { installDesign } from "./designLoader";

export interface ImprovementContext { sourceRunId: string; designId: string }
export interface CanvasRerunRequest { sourceId: string; designId: string; inputHash: string; matchedStop: boolean; layout: RunTopology }
export function readImprovementContext(state: unknown, designId: string | null): ImprovementContext | null {
  const context = (state as { improveRun?: Partial<ImprovementContext> } | null)?.improveRun;
  return typeof context?.sourceRunId === "string" && typeof context.designId === "string" && context.designId === designId
    ? { sourceRunId: context.sourceRunId, designId: context.designId } : null;
}
export const installImprovementDesign = (design: Infrastructure) => installDesign(design);
