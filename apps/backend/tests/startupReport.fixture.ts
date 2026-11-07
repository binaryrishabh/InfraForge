import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { captureSnapshot } from "../simulator/snapshot";
import type { SimulationInstance } from "../simulator/instance";
import { buildRunReport, type StoredRun } from "../reports/report";
import { scalingSessionInput } from "./scalingSessions.fixture";
import { buildModel2Contract, type ContractBuilder } from "@infraforge/simulation/internal-product";

export function startupReportFixture(maximum = 3, mode: "normal" | "missing-image" | "warm" | "drawn" = "normal") {
  const design = scalingSessionInput(maximum);
  if (mode === "drawn") {
    design.resources.push({id: "registry", type: "Container Registry", x: 0, y: 3}, {id: "blobs", type: "Object Storage", x: 0, y: 4});
    design.connectionLines.push({id: "artifact", sourceId: "app", sourceType: "Virtual Machine", targetId: "registry", targetType: "Container Registry", port: 443},
      {id: "backing", sourceId: "registry", sourceType: "Container Registry", targetId: "blobs", targetType: "Object Storage", port: 443});
  }
  const input = captureRunInputs(design, {...design.workloadProfile, targetThroughput: 6000}, "startup-report-proof");
  const builder: ContractBuilder | undefined = mode === "normal" || mode === "drawn" ? undefined : (...args) => {
    const result = buildModel2Contract(...args); if ("refused" in result) return result;
    if (mode === "missing-image") result.contract.nodes.app!.controller!.artifact.reference = "missing-release";
    if (mode === "warm") {
      const image = result.contract.nodes.app!.resources.find(r => r.config.kind === "artifact-client")!.config;
      const upload = result.contract.commands.find(c => c.request != null && typeof c.request === "object" && "kind" in c.request && c.request.kind === "upload")!;
      if (image.kind !== "artifact-client" || upload.bodyBytes.kind !== "known") throw Error("Expected owned image");
      image.initialLayers = [{digest: `sha256:${"a".repeat(64)}`, bytes: upload.bodyBytes}];
    }
    return result;
  };
  const model2 = createModel2Engine(input, 16, builder);
  const instance: SimulationInstance = {model2, tickCount: 0, pendingLogs: [], speed: 1, lastCheckpointAt: 0,
    accumulatedCostUsd: 0, topology: input, topologyRevision: 0, actions: new Map(), acknowledge: null,
    metricsComputedAt: "2026-11-08T00:00:00.000Z", metricsTopologyRevision: 0};
  const samples = [];
  for (let second = 1; second <= 16; second++) {
    model2.advance();
    samples.push({second, raw: model2.evidence(), metrics: model2.view().metrics});
  }
  const terminal = captureSnapshot("startup-proof", instance, "terminal"), checkpoint = captureSnapshot("startup-proof", instance, "checkpoint");
  const row: StoredRun = {id: "startup-proof", infrastructureId: null, runName: "Startup evidence proof", status: "torn-down", resourceCount: input.resources.length,
    createdAt: new Date("2026-11-08T00:00:00.000Z"), updatedAt: new Date("2026-11-08T00:00:00.000Z"), topologyRevision: 0,
    stages: [], timeline: [], chaosEvents: [], workloadProfile: input.workloadProfile, seed: input.seed,
    runInputs: input, liveTopology: {resources: input.resources, connectionLines: input.connectionLines}, terminalSnapshot: JSON.parse(JSON.stringify(terminal)),
    simulationState: JSON.parse(JSON.stringify(checkpoint)), runtimeActive: false};
  return {input, row, samples, report: buildRunReport(row)};
}

export function startupReportCases() {
  return [startupReportFixture(), startupReportFixture(1), startupReportFixture(3, "missing-image"), startupReportFixture(3, "warm"), startupReportFixture(3, "drawn")];
}

if (import.meta.main) {
  const cases = startupReportCases(), base = cases[0]!;
  const variant = (change: (row: StoredRun) => void) => {const row = structuredClone(base.row); change(row); return buildRunReport(row);};
  type Snapshot = ReturnType<typeof captureSnapshot>;
  console.log(JSON.stringify({reports: cases.map(c => c.report),
    old: variant(row => {for (const m of Object.values((row.terminalSnapshot as Snapshot).metrics)) delete m.startup;}),
    partial: variant(row => {(row.terminalSnapshot as Snapshot).metrics.app!.startup = {version: 1, clients: [{id: "app#1/image", pulledBytes: 1024}]};}),
    noRows: variant(row => {(row.terminalSnapshot as Snapshot).metrics = {};}),
    checkpointOnly: variant(row => {row.terminalSnapshot = null;})}));
}
