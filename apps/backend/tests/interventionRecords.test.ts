import { expect, test } from "bun:test";
import { resolveWorkload } from "@infraforge/domain/workload";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureSnapshot } from "../simulator/snapshot";
import { readRecords } from "../reports/records";
import type { SimulationInstance } from "../simulator/instance";
import { storedJson } from "../utils/json";

test("mid-intervention terminal and checkpoint records retain the captured final state", () => {
  const topology = {resources: [{id: "app", type: "Virtual Machine" as const, x: 0, y: 0}, {id: "db", type: "Database" as const, x: 1, y: 0}],
    connectionLines: [{id: "app-db", sourceId: "app", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432}]};
  const model2 = createModel2Run({...topology, seed: "retained-intervention", workloadProfile: resolveWorkload({targetThroughput: 60, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light"})}, 5);
  model2.apply({kind: "intervention", parameters: {interventionId: "session-capacity", revision: 1, target: {resourceId: "db"}, parameters: {sessions: 0, duration: 2}}});
  model2.advance();
  const instance = {model2, topology, topologyRevision: 0, pendingLogs: [], speed: 1, accumulatedCostUsd: 0.125, metricsComputedAt: null, metricsTopologyRevision: 0} as unknown as SimulationInstance;
  const terminal = captureSnapshot("run", instance, "terminal"), checkpoint = captureSnapshot("run", instance, "checkpoint");
  expect(terminal.activeChaos!.some(c => !!c.intervention)).toBe(true);
  // Retain support for fractional snapshots written before live countdown rounding.
  for (const fractional of [false, true]) {
    const retained = (value: typeof terminal | typeof checkpoint) => storedJson({...value, activeChaos: value.activeChaos!.map(c => ({...c, remainingTicks: fractional ? 1.000001 : c.remainingTicks}))});
    const limits: string[] = [];
    const records = readRecords({stages: [], timeline: [], chaosEvents: [], runInputs: null, liveTopology: null, workloadProfile: null,
      simulationState: retained(checkpoint), terminalSnapshot: retained(terminal)}, limits);
    expect(limits).toEqual([]);
    for (const [state, captured] of [[records.terminal, terminal], [records.checkpoint, checkpoint]] as const) {
      expect(state).toMatchObject({simulatedSeconds: 1, health: terminal.overallHealth, accumulatedCostUsd: 0.125, capturedAt: captured.capturedAt, topologyRevision: 0});
      expect(state!.resources.find(r => r.id === "db")).toMatchObject({id: "db", health: terminal.metrics.db!.health, cpu: terminal.metrics.db!.cpu});
      expect(state!.activeChaos).toEqual(fractional ? terminal.activeChaos!.map(c => ({...c, remainingTicks: 1.000001})) : terminal.activeChaos);
    }
  }
});
