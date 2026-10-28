import { expect, test } from "bun:test";
import { captureRunInputs } from "../deployments/runInputs";
import { buildRerunOptions, currentDesignInput, rerunInputHash } from "../reruns/options";
import type { StoredRun } from "../reports/report";
import { layout, workload } from "./integration/scenario";

const input = { ...captureRunInputs(layout, workload), seed: "rerun-proof" };
function source(changes: Partial<StoredRun> = {}): StoredRun {
  return { id: "source", infrastructureId: "design", runName: "Original", status: "torn-down", resourceCount: 5,
    createdAt: new Date(), updatedAt: new Date(), topologyRevision: 0, stages: [], timeline: [], chaosEvents: [],
    workloadProfile: input.workloadProfile, seed: input.seed, simulationState: null, runInputs: input, liveTopology: layout,
    terminalSnapshot: { version: 1, kind: "terminal", capturedAt: new Date().toISOString(), topologyRevision: 0,
      simulatedSeconds: 620, accumulatedCostUsd: 1, overallHealth: "healthy", metrics: {} }, ...changes };
}

test("exact rerun remains available after design deletion without reconstructing inputs", () => {
  const options = buildRerunOptions(source({ infrastructureId: null }), null);
  expect(options.exact.available).toBe(true);
  expect(options.currentDesign.available).toBe(false);
  expect(options.seed).toBe(input.seed);
  expect(options.workload).toEqual(input.workloadProfile);
  expect(options.matchedStop).toMatchObject({ available: true, target: 620, defaultEnabled: true });
});
test("exact refuses V1, mismatched provenance, active and unsupported inputs", () => {
  for (const runInputs of [{ ...input, version: 1 }, { ...input, simulationModelVersion: "3" },
    { ...input, catalogSnapshot: "other" }, { ...input, unknownRoot: "must not be discarded" }, null]) {
    expect(buildRerunOptions(source({ runInputs }), layout).exact.available).toBe(false);
  }
  expect(buildRerunOptions(source({ status: "live" }), layout).exact.available).toBe(false);
  expect(buildRerunOptions({ ...source(), runtimeActive: true }, layout).currentDesign.available).toBe(false);
});
test("current-design preview preserves resolved source workload/seed and detects a stale canvas", () => {
  const edited = structuredClone(layout); edited.resources[2]!.skuId = "m5.xlarge";
  const options = buildRerunOptions(source(), edited);
  expect(options.currentDesign.preview?.grade).toBe("one-change-design");
  const candidate = currentDesignInput(input, edited);
  expect(candidate.seed).toBe(input.seed);
  expect(candidate.workloadProfile).toEqual(input.workloadProfile);
  expect(candidate.simulationModelVersion).toBe("2");
  expect(options.currentDesign.inputHash).toBe(rerunInputHash(candidate));
  expect(rerunInputHash(currentDesignInput(input, layout))).not.toBe(options.currentDesign.inputHash);
});
test("a Model 1 run stays readable but is never rerun", () => {
  for (const runInputs of [{ ...input, version: 1 }, { ...input, simulationModelVersion: "1" }]) {
    const options = buildRerunOptions(source({ runInputs }), layout);
    expect(options.exact.available).toBe(false);
    expect(options.currentDesign.available).toBe(false);
    expect(options.currentDesign.reason).toContain("retired Model 1");
    expect(options.matchedStop.available).toBe(false);
  }
});
test("matched stop is bounded and uses only validated exact terminal duration", () => {
  const final = source().terminalSnapshot as object;
  for (const simulatedSeconds of [0, -1, 0.5, 604801, "620", undefined]) {
    expect(buildRerunOptions(source({ terminalSnapshot: { ...final, simulatedSeconds } }), layout).matchedStop.available).toBe(false);
  }
  expect(buildRerunOptions(source({ terminalSnapshot: null, simulationState: { simulatedSeconds: 620 } }), layout).matchedStop.available).toBe(false);
  expect(buildRerunOptions(source({ terminalSnapshot: { ...final, kind: "checkpoint" } }), layout).matchedStop.available).toBe(false);
});
