import { afterEach, expect, test } from "bun:test";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";

afterEach(() => useSimulationStore.getState().reset());

test("a failed speed request restores the preceding value", () => {
  useSimulationStore.getState().setSpeed(10);
  const restore = useSimulationStore.getState().setSpeed(0);
  expect(useSimulationStore.getState().speed).toBe(0);
  restore();
  expect(useSimulationStore.getState().speed).toBe(10);
});

test("a late speed failure preserves a newer server snapshot", () => {
  const restore = useSimulationStore.getState().setSpeed(0);
  useSimulationStore.getState().applySnapshot({
    deploymentId: "00000000-0000-4000-8000-000000000001",
    timestamp: "2026-10-09T00:00:00.000Z",
    metrics: {}, logs: [], health: "healthy", loadFraction: 1,
    simulatedSeconds: 2, speed: 60,
  });
  restore();
  expect(useSimulationStore.getState().speed).toBe(60);
  expect(useSimulationStore.getState().simulatedSeconds).toBe(2);
});

test("a late speed failure cannot alter a reset monitoring session", () => {
  useSimulationStore.getState().setSpeed(10);
  const restore = useSimulationStore.getState().setSpeed(0);
  useSimulationStore.getState().reset();
  restore();
  expect(useSimulationStore.getState().speed).toBe(1);
  expect(useSimulationStore.getState().lastSnapshotAt).toBeNull();
});
