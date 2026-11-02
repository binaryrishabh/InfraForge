import { expect, test } from "bun:test";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { readRecords } from "../reports/records";
import { ObjectiveSchema } from "../reports/objectiveSchema";

test("optional objective survives live checkpoints and terminal reports, including an undecided horizon", () => {
  for (const enabled of [false, true]) {
    const input = captureRunInputs({ resources: [{ id: "app", type: "Virtual Machine", x: 0, y: 0 }], connectionLines: [] },
      { targetThroughput: 6000, throughputUnit: "per-minute", trafficShape: "steady", payloadSize: "light",
        ...(enabled ? { workloadObjective: { version: 1 as const, maxResponseMs: 60000, targetSuccessPercent: 99.99 } } : {}) }, "objective-records");
    const run = createModel2Run(input, 1);
    if (enabled) expect(run.view().traffic.objective).toMatchObject({ status: "unknown", measuredFraction: null, bestCaseFraction: null, worstCaseFraction: null });
    else expect(run.view().traffic).not.toHaveProperty("objective");
    run.apply({ kind: "chaos", parameters: { type: DeploymentChaosNames.NetworkDelay, resourceId: "app" } });
    run.advance(); const view = run.view(), limits: string[] = [];
    const records = readRecords({ runInputs: input, stages: [], timeline: [], chaosEvents: [], simulationState: view,
      terminalSnapshot: { ...view, version: 1, kind: "terminal", capturedAt: "2026-11-03T00:00:00.000Z", topologyRevision: 0, accumulatedCostUsd: 0 } }, limits);
    expect(records.checkpoint!.traffic).toEqual(view.traffic);
    expect(records.terminal!.traffic).toEqual(view.traffic);
    expect(limits).toEqual([]);
    if (enabled) {
      expect(view.traffic.objective!.status).toBe("undetermined");
      expect(view.traffic.objective!.pending).toBeGreaterThan(0);
      expect(view.traffic.objective).toEqual(run.evidence().objective);
      expect(ObjectiveSchema.safeParse(view.traffic.objective).success).toBe(true);
      for (const invalid of [{ version: 2 }, { offered: -1 }, { good: 0.5 }, { failed: Infinity }, { pending: 100000001 },
        { status: "available" }, { bestCaseFraction: 1.1 }, { measuredFraction: NaN }, { extra: 1 },
        { objective: { ...input.workloadProfile.workloadObjective, period: 1 } }])
        expect(ObjectiveSchema.safeParse({ ...view.traffic.objective, ...invalid }).success).toBe(false);
    } else {
      expect(view.traffic).not.toHaveProperty("objective"); expect(run.evidence()).not.toHaveProperty("objective");
    }
  }
});
