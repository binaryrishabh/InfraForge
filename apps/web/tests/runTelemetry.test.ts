import { afterEach, expect, test } from "bun:test";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";

afterEach(() => useSimulationStore.getState().reset());
const snapshot: SimulationSnapshot = { deploymentId: "run-a", timestamp: "2026-10-15T00:00:00.000Z",
  simulatedSeconds: 17, speed: 0, metrics: {}, logs: [], health: "healthy", loadFraction: 1 };

test("reattaching the same paused run retains its last actual measurements and speed", () => {
  const store = useSimulationStore.getState();
  store.prepareRun("run-a"); store.applySnapshot(snapshot);
  store.prepareRun("run-a");
  expect(useSimulationStore.getState()).toMatchObject({ deploymentId: "run-a", simulatedSeconds: 17, speed: 0,
    lastSnapshotAt: snapshot.timestamp, health: "healthy" });
});
test("switching runs discards cached telemetry and refuses a late prior-run snapshot", () => {
  const store = useSimulationStore.getState();
  store.prepareRun("run-a"); store.applySnapshot(snapshot); store.prepareRun("run-b");
  store.applySnapshot(snapshot);
  expect(useSimulationStore.getState()).toMatchObject({ deploymentId: "run-b", simulatedSeconds: 0, lastSnapshotAt: null, metrics: {}, health: null });
});
test("account/session reset clears telemetry identity so cached private state cannot survive", () => {
  const store = useSimulationStore.getState();
  store.prepareRun("run-a"); store.applySnapshot(snapshot); store.reset();
  expect(useSimulationStore.getState()).toMatchObject({ deploymentId: null, simulatedSeconds: 0, lastSnapshotAt: null, metrics: {}, health: null });
});
