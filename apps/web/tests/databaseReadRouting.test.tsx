import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { DatabaseReplicationReadings } from "../src/features/live/DatabaseReplicationReadings";
import { updateResource } from "../src/features/canvas/actions";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { undo, redo } from "../src/features/canvas/history";
import type { Resource } from "@infraforge/domain/resource";
import { ResourceHealth } from "@infraforge/domain/resource";
import { resolveWorkload } from "@infraforge/domain/workload";
import { DatabaseReplicationSection } from "../src/features/canvas/components/inspector/DatabaseReplicationSection";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";
import { createModel2Run } from "@infraforge/simulation/model2-run";

const db: Resource = { id: "db", type: "Database", x: 0, y: 0, databaseReplication: { version: 1, enabled: true, replicationDelayMs: 1000, readPolicy: "primary" } };
const policy = { version: 1 as const, policy: "replica-preferred" as const };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });

test("minimal read routing control survives undo, redo and reload and respects both locks", () => {
  const html = renderToStaticMarkup(<Inspector resource={{ ...db, databaseReadRouting: policy }} />);
  for (const text of ["Read routing", "Primary only", "Replica preferred", "Full capacity refuses work"]) expect(html).toContain(text);
  expect(renderToStaticMarkup(<Inspector resource={{ ...db, type: "Cache" }} />)).not.toContain("Read routing");
  useCanvasStore.getState().loadLayout([db], [], "layout", "Database");
  updateResource("db", { databaseReadRouting: policy });
  undo(); expect(useCanvasStore.getState().resources[0]!.databaseReadRouting).toBeUndefined();
  redo(); expect(useCanvasStore.getState().resources[0]!.databaseReadRouting).toEqual(policy);
  updateResource("db", { databaseReplication: undefined });
  expect(useCanvasStore.getState().resources[0]!.databaseReplication).toEqual(db.databaseReplication);
  for (const lock of ["liveLocked", "isDeploying"] as const) {
    useCanvasStore.setState({ [lock]: true }); updateResource("db", { databaseReadRouting: undefined });
    expect(useCanvasStore.getState().resources[0]!.databaseReadRouting).toEqual(policy);
    const locked = renderToStaticMarkup(<DatabaseReplicationSection resource={{ ...db, databaseReadRouting: policy }} disabled />);
    expect(locked).toMatch(/<select[^>]*disabled=""[^>]*>[\s\S]*Primary only/);
    useCanvasStore.setState({ [lock]: false });
  }
  const resources = JSON.parse(JSON.stringify(useCanvasStore.getState().resources)) as Resource[];
  useCanvasStore.getState().loadLayout(resources, [], "layout", "Database");
  expect(useCanvasStore.getState().resources[0]!.databaseReadRouting).toEqual(policy);
  updateResource("db", { databaseReplication: undefined, databaseReadRouting: undefined });
  expect(useCanvasStore.getState().resources[0]!.databaseReadRouting).toBeUndefined();
});

test("routing readings use measured member work and stale age from a product run", () => {
  const resources: Resource[] = [{ id: "app", type: "Virtual Machine", x: 0, y: 0 }, { ...db, databaseReadRouting: policy }];
  const input = { resources, connectionLines: [{ id: "edge", sourceId: "app", sourceType: "Virtual Machine" as const, targetId: "db", targetType: "Database" as const, port: 5432 }],
    workloadProfile: resolveWorkload({ targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0.5, payloadSize: "light" }), seed: "dbroute-view", adapterProfiles: ["db-replication/1", "db-read-routing/1"] as ("db-replication/1" | "db-read-routing/1")[] };
  const run = createModel2Run(input, 3); run.advance(); run.advance();
  const metric = run.view().metrics.db!, measured = run.evidence().data.databases[0]!.databaseReadRouting!;
  expect(metric.database!.readRouting).toEqual(measured);
  const html = renderToStaticMarkup(<DatabaseReplicationReadings metrics={{ ...metric, health: ResourceHealth.HEALTHY }} />);
  expect(html).toContain(`Stale reads: ${measured.staleReads}`);
  expect(measured.staleReads).toBeGreaterThan(0);
  expect(html).toContain(`CPU ${measured.members.primary.consumedCoreUs} core-us`);
  expect(html).toContain(`CPU ${measured.members.replica.consumedCoreUs} core-us`);
});

for (const routing of [undefined, { version: 1 as const, policy: "primary-only" as const }, policy]) test(`saveDesign and reload retain routing ${routing?.policy ?? "absence"}`, async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([{ ...db, ...(routing ? { databaseReadRouting: routing } : {}) }], [], "layout", "Database");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "Database" } } });
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[]; connectionLines: [] } };
    expect(payload.layout.resources[0]!.databaseReadRouting).toEqual(routing);
    if (!routing) expect(payload.layout.resources[0]).not.toHaveProperty("databaseReadRouting");
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Database");
    expect(useCanvasStore.getState().resources[0]!.databaseReadRouting).toEqual(routing);
  } finally { saved.mockRestore(); }
});
