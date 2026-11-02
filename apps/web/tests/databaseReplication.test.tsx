import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { DatabaseReplicationReadings } from "../src/features/live/DatabaseReplicationReadings";
import { updateResource } from "../src/features/canvas/actions";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { undo, redo } from "../src/features/canvas/history";
import { ResourceHealth, type Resource } from "@infraforge/domain/resource";
import type { DatabaseReplicationMetrics } from "@infraforge/contracts/telemetry";

const db: Resource = { id: "db", type: "Database", x: 0, y: 0 };
const policy = { version: 1 as const, enabled: true as const, replicationDelayMs: 100, readPolicy: "primary" as const };
const unknownHa: DatabaseReplicationMetrics = { version: 1, currentWriter: null, replicaState: null, writerEpoch: null, primaryEpoch: null, replicaEpoch: null, primaryRole: null, replicaRole: null, fencedWriteRejections: null, fencedReplicationRejections: null, replicaCommittedWrites: null, promotionCount: null, promotionAtUs: null, lostOperations: null, regressedKeys: null, primaryReads: null, replicaReads: null, freshReplicaReads: null, staleReplicaReads: null, primaryCommittedWrites: null, replicaAppliedWrites: null, pendingReplication: null, lagMs: null, oldestPendingAgeMs: null, primaryGeneration: null, replicaGeneration: null };
afterEach(() => useCanvasStore.getState().clearCanvas());
test("Database HA section is bounded, explicit and respects locks", () => {
  const html = renderToStaticMarkup(<Inspector resource={{ ...db, databaseReplication: policy }} />);
  for (const text of ["Database HA", "One replica", "Modeled replication delay", "60000", "Primary", "Replica preferred", "Recent writes can be lost"]) expect(html).toContain(text);
  expect(renderToStaticMarkup(<Inspector resource={{ ...db, type: "Cache" }} />)).not.toContain("Database HA");
  useCanvasStore.getState().loadLayout([db], [], "layout", "Database");
  updateResource("db", { databaseReplication: policy });
  undo(); expect(useCanvasStore.getState().resources[0]!.databaseReplication).toBeUndefined();
  redo(); expect(useCanvasStore.getState().resources[0]!.databaseReplication).toEqual(policy);
  for (const lock of ["liveLocked", "isDeploying"] as const) {
    useCanvasStore.setState({ [lock]: true }); updateResource("db", { databaseReplication: undefined });
    expect(useCanvasStore.getState().resources[0]!.databaseReplication).toEqual(policy);
    useCanvasStore.setState({ [lock]: false });
  }
  const resources = JSON.parse(JSON.stringify(useCanvasStore.getState().resources)) as Resource[];
  useCanvasStore.getState().loadLayout(resources, [], "layout", "Database");
  expect(useCanvasStore.getState().resources[0]!.databaseReplication).toEqual(policy);
});
test("HA readouts are optional and supplied unknowns remain Unknown", () => {
  expect(renderToStaticMarkup(<DatabaseReplicationReadings />)).toBe("");
  const html = renderToStaticMarkup(<DatabaseReplicationReadings metrics={{ cpu: null, memory: null, health: ResourceHealth.HEALTHY, databaseReplication: { version: 1, currentWriter: null, replicaState: null, writerEpoch: null, primaryEpoch: null, replicaEpoch: null, primaryRole: null, replicaRole: null, fencedWriteRejections: null, fencedReplicationRejections: null, replicaCommittedWrites: null, promotionCount: null, promotionAtUs: null, lostOperations: null, regressedKeys: null, primaryReads: null, replicaReads: null, freshReplicaReads: null, staleReplicaReads: null, primaryCommittedWrites: 7, replicaAppliedWrites: null, pendingReplication: null, lagMs: null, oldestPendingAgeMs: null, primaryGeneration: null, replicaGeneration: null } }} />);
  expect(html).toContain("Unknown"); expect(html).toContain(">7<");
});

test("HA readings distinguish process availability from writer role using supplied values", () => {
  for (const [primary, replica, expectedPrimary, expectedReplica] of [["unavailable", "available", "Down", "Replica"], ["fenced", "writer", "Fenced", "Writer"], ["available", "unavailable", "Writer", "Down"]] as const) {
    const html = renderToStaticMarkup(<DatabaseReplicationReadings metrics={{ cpu: null, memory: null, health: ResourceHealth.HEALTHY, databaseReplication: { ...unknownHa, primaryProcessState: primary, replicaProcessState: replica, primaryRole: "writer", regressedKeyCount: 20, regressedKeys: [{ key: "k0", primaryVersion: 2, promotedVersion: 1 }], failedWritesWithoutWriter: 3, connectionInvalidations: 4, sessionInvalidations: 4 } }} />);
    expect(html).toContain(`<dt>Primary</dt><dd>${expectedPrimary}</dd>`);
    expect(html).toContain(`<dt>Replica</dt><dd>${expectedReplica}</dd>`);
    expect(html).toContain("Regressed keys: 20");
    expect(html).toContain("Unknown");
  }
});
