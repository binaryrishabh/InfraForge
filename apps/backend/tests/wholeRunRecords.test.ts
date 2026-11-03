import { expect, test } from "bun:test";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { readRecords } from "../reports/records";
import { WholeRunSchema } from "../reports/wholeRunSchema";

test("whole-run survives checkpoints and terminal snapshots; schema is strict, finite and bounded", () => {
  const input = captureRunInputs({ resources: [{ id: "app", type: "Virtual Machine", x: 0, y: 0 }], connectionLines: [] }, { targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", payloadSize: "light" }, "latency-report");
  for (const marked of [true, false]) {
    const run = createModel2Run(marked ? input : { ...input, adapterProfiles: [] }, 3);
    run.advance(); const view = run.view(), limits: string[] = [];
    expect(Object.hasOwn(view.traffic, "wholeRun")).toBe(marked);
    const records = readRecords({ runInputs: input, stages: [], timeline: [], chaosEvents: [], simulationState: view,
      terminalSnapshot: { ...view, version: 1, kind: "terminal", capturedAt: "2026-11-03T00:00:00.000Z", topologyRevision: 0, accumulatedCostUsd: 0 } }, limits);
    expect(records.checkpoint!.traffic).toEqual(view.traffic); expect(records.terminal!.traffic).toEqual(view.traffic); expect(limits).toEqual([]);
    if (marked) {
      expect(view.traffic.wholeRun!.percentiles.p99).toBeNull();
      for (const invalid of [{ version: 2 }, { completed: -1 }, { inFlight: Infinity }, { throughSecond: 0.5 }, { extra: true },
        { minMs: Number.MAX_SAFE_INTEGER }, { resolution: "other" }, { relativeErrorBound: 0.1 },
        { percentiles: { p50: { lowMs: 1, highMs: 2 }, p95: null, p99: null } }]) {
        expect(WholeRunSchema.safeParse({ ...view.traffic.wholeRun!, ...invalid }).success).toBe(false);
      }
    }
  }
});
