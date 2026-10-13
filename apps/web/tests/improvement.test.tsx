import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Infrastructure } from "@infraforge/contracts/infrastructure";
import type { RerunOptions } from "@infraforge/contracts/reports";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";
import { installImprovementDesign, readImprovementContext } from "../src/features/canvas/improvement";
import { CanvasMatchPreview } from "../src/features/deployment/components/ImproveDeployModal";
import { OpenDesignToImprove } from "../src/features/reports/components/OpenDesignToImprove";

afterEach(() => { useCanvasStore.getState().clearCanvas(); useSimulationStore.getState().reset(); });
test("improve opens saved design through existing canvas state, resets live context and scopes route context to that design", () => {
  const layout = { resources: [{ id: "saved", type: "DNS" as const, x: 24, y: 24 }], connectionLines: [], layoutVersion: 3 };
  useCanvasStore.getState().loadRunTopology("finished", { ...layout, resources: [{ ...layout.resources[0]!, id: "live-edit" }] }, 5, "design", "Old");
  const design: Infrastructure = { id: "design", userId: "owner", name: "Current saved", layout, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  installImprovementDesign(design);
  const state = useCanvasStore.getState();
  expect(state.resources).toEqual(layout.resources); expect(state.activeDeploymentId).toBeNull();
  expect(state.currentLayoutId).toBe(design.id); expect(state.currentLayoutSaved).toBe(true); expect(state.isInitialized).toBe(true);
  expect(state.topologyRevision).toBeNull(); expect(state.undoStack).toEqual([]);
  const route = { improveRun: { sourceRunId: "source", designId: "design" } };
  expect(readImprovementContext(route, "design")).toEqual(route.improveRun);
  expect(readImprovementContext(route, "other")).toBeNull(); expect(readImprovementContext(null, "design")).toBeNull();
});
test("canvas matching copy distinguishes unsaved actual deployment, source inputs and descriptive provenance", () => {
  const options: RerunOptions = { source: { id: "source", infrastructureId: "design", infrastructureName: "Source name", status: "torn-down", createdAt: "", updatedAt: "", resourceCount: 1, workload: null, workloadSource: "captured", chaosEventCount: 0, topologyRevision: 0, hasReportData: true },
    seed: "original-seed", workload: { targetThroughput: 123456, throughputUnit: "per-minute", trafficShape: "peak", peakMultiplier: 4, readWriteRatio: 0.7, payloadSize: "heavy" },
    exact: { available: false, reason: "Legacy" }, currentDesign: { available: true, reason: null, preview: null, inputHash: "hash", modelCatalogCompatible: false }, matchedStop: { available: false, target: null, defaultEnabled: false, reason: "No exact duration" } };
  const html = renderToStaticMarkup(<CanvasMatchPreview options={options} />);
  expect(html).toContain("Match Source name"); expect(html).toContain("including unsaved edits");
  expect(html).toContain("Deploy saves this canvas"); expect(html).toContain("changed preview is refused");
  expect(html).toContain("original-seed"); expect(html).toContain("123,456"); expect(html).toContain("70%"); expect(html).toContain("Peak multiplier: 4");
  expect(html).toContain("descriptive only"); expect(html).toContain("NOT replayed");
  const deleted = renderToStaticMarkup(<MemoryRouter><OpenDesignToImprove sourceId="source" designId={null} eligible /></MemoryRouter>);
  expect(deleted).toContain("disabled"); expect(deleted).toContain("Editable design deleted");
});
