import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { DatabaseReplicationReadings } from "../src/features/live/DatabaseReplicationReadings";
import { updateResource } from "../src/features/canvas/actions";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { undo, redo } from "../src/features/canvas/history";
import type { Resource } from "@infraforge/domain/resource";

const db: Resource = { id: "db", type: "Database", x: 0, y: 0 };
const policy = { version: 1 as const, enabled: true as const, replicationDelayMs: 100, readPolicy: "primary" as const };
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
  const html = renderToStaticMarkup(<DatabaseReplicationReadings metrics={{ cpu: null, memory: null, health: "healthy", databaseReplication: { version: 1, currentWriter: null, replicaState: null, primaryCommittedWrites: 7, replicaAppliedWrites: null, pendingReplication: null, lagMs: null, oldestPendingAgeMs: null, primaryGeneration: null, replicaGeneration: null } }} />);
  expect(html).toContain("Unknown"); expect(html).toContain(">7<");
});
