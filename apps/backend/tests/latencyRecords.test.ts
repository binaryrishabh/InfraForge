import { expect, test } from "bun:test";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { readRecords } from "../reports/records";
import { LatencySchema } from "../reports/latencySchema";

test("latency survives report checkpoints and terminal snapshots; historical traffic is unchanged", () => {
  const input = captureRunInputs({ resources: [{ id: "app", type: "Virtual Machine", x: 0, y: 0 }], connectionLines: [] }, { targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", payloadSize: "light" }, "latency-report");
  for (const marked of [true, false]) {
    const run = createModel2Run(marked ? input : { ...input, adapterProfiles: [] }, 3);
    run.advance(); const view = run.view(), limits: string[] = [];
    expect(Object.hasOwn(view.traffic, "latency")).toBe(marked);
    const records = readRecords({ runInputs: input, stages: [], timeline: [], chaosEvents: [], simulationState: view,
      terminalSnapshot: { ...view, version: 1, kind: "terminal", capturedAt: "2026-11-03T00:00:00.000Z", topologyRevision: 0, accumulatedCostUsd: 0 } }, limits);
    expect(records.checkpoint!.traffic).toEqual(view.traffic); expect(records.terminal!.traffic).toEqual(view.traffic); expect(limits).toEqual([]);
    if (marked) {
      expect(view.traffic.latency!.slowestOnePercent).toBeNull();
      for (const invalid of [{ version: 3 }, { sampleCap: 10001 }, { completedCount: -1 }, { extra: true },
        { typical: { ...view.traffic.latency!.typical, categories: { providerTime: { meanMs: 1, share: 0.5 } } } }]) {
        expect(LatencySchema.safeParse({ ...view.traffic.latency!, ...invalid }).success).toBe(false);
      }
    }
  }
});
