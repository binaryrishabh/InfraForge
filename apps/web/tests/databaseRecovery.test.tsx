import { afterEach, expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { Resource } from "@infraforge/domain/resource";
import type { RunReport } from "@infraforge/contracts/reports";
import type { FromWorker } from "../src/features/model2Run/protocol";
import { DatabaseRecoverySection } from "../src/features/canvas/components/inspector/DatabaseRecoverySection";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { DatabaseIncidentReadings } from "../src/features/reports/components/DatabaseIncidentReadings";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import { saveDesign } from "../src/features/canvas/designActions";
import { installDesign } from "../src/features/canvas/designLoader";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { http } from "../src/client/httpClient";
import { createRunHost } from "../src/features/model2Run/worker/host";

const db: Resource = {id: "db", type: "Database", x: 320, y: 0, databaseReplication: {version: 1, enabled: true, replicationDelayMs: 1, readPolicy: "primary"}, databaseRecoveryPlan: {version: 1, promoteAtSecond: null}};
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({user: null, status: "guest"}); });

test("saved promotion control is labelled, locked, undoable and retains its exact JSON through save/load", async () => {
  expect(renderToStaticMarkup(<DatabaseRecoverySection resource={{...db, databaseRecoveryPlan: undefined}} disabled={false} />)).toBe("");
  const html = renderToStaticMarkup(<DatabaseRecoverySection resource={db} disabled />);
  expect(html).toContain("Promote at simulated second"); expect(html).toContain("disabled"); expect(html).toContain("Empty means no promotion");
  useCanvasStore.getState().loadLayout([db], [], "design", "Recovery");
  updateResource("db", {databaseRecoveryPlan: {version: 1, promoteAtSecond: 3}});
  undo(); expect(useCanvasStore.getState().resources[0]!.databaseRecoveryPlan!.promoteAtSecond).toBeNull();
  redo(); expect(useCanvasStore.getState().resources[0]!.databaseRecoveryPlan!.promoteAtSecond).toBe(3);
  for (const lock of ["liveLocked", "isDeploying"] as const) {
    useCanvasStore.setState({[lock]: true}); updateResource("db", {databaseRecoveryPlan: {version: 1, promoteAtSecond: 8}});
    expect(useCanvasStore.getState().resources[0]!.databaseRecoveryPlan!.promoteAtSecond).toBe(3); useCanvasStore.setState({[lock]: false});
  }
  updateResource("db", {databaseRecoveryPlan: {version: 1, promoteAtSecond: 3.5}});
  expect(useCanvasStore.getState().resources[0]!.databaseRecoveryPlan!.promoteAtSecond).toBe(3);
  useAuthStore.setState({user: {id: "recovery-owner", name: "Owner", username: null, email: "recovery@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString()}, status: "authenticated"});
  const response = JSON.parse(JSON.stringify({id: "design", name: "Recovery", layout: {resources: useCanvasStore.getState().resources, connectionLines: [], layoutVersion: 3}}));
  const write = spyOn(http, "put").mockResolvedValue({data: {updatedInfrastructure: response}});
  try {
    await saveDesign(); expect(write).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(JSON.stringify(write.mock.calls[0]![1]));
    expect(sent.layout.resources[0].databaseRecoveryPlan).toEqual({version: 1, promoteAtSecond: 3});
    installDesign(response);
    expect(useCanvasStore.getState().resources[0]!.databaseRecoveryPlan).toEqual({version: 1, promoteAtSecond: 3});
  } finally { write.mockRestore(); }
});

test("actual saved incident reports render failure, fresh-session recovery, fenced return and explicit loss evidence", async () => {
  const child = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/databaseRecoveryReport.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const output = await new Response(child.stdout).text(), diagnostics = await new Response(child.stderr).text();
  expect(await child.exited, diagnostics).toBe(0);
  const reports = JSON.parse(output) as RunReport[];
  for (const [i, report] of reports.entries()) {
    const html = renderToStaticMarkup(<ReportMeasurements report={report} number={3} />);
    expect(html).toContain("Database incident record"); expect(html).toContain(report.databaseRecoveryPlan!.hash);
    for (const text of ["Before action: second 2", "First sample after action: second 3", "At action completion: second 11", "Current writer", "Failed writes without a writer"]) expect(html).toContain(text);
    if (i) { expect(html).toContain("Fenced"); expect(html).toContain("learner-promotion"); expect(html).toContain("Connections invalidated by HA changes"); }
    const fragment = renderToStaticMarkup(<DatabaseIncidentReadings report={report} />);
    expect(fragment).toContain("does not establish continuous recovery");
  }
  const lost = reports[2]!;
  expect(renderToStaticMarkup(<ReportMeasurements report={lost} number={3} />)).toContain("key-1: 15 → 1");
  expect(lost.terminal!.resources.find(r => r.id === "db")!.databaseReplication).toMatchObject({pendingReplication: 0, lostOperations: 20});
  const missing = structuredClone(reports[1]!); missing.actions = [];
  expect(renderToStaticMarkup(<DatabaseIncidentReadings report={missing} />)).toContain("Incident samples: Unknown");
  const unknown = structuredClone(reports[1]!); const sample = unknown.actions[0]!.outcome!.databaseIncident!.before;
  sample.completed = null; sample.failed = null; sample.replication = undefined;
  const html = renderToStaticMarkup(<DatabaseIncidentReadings report={unknown} />);
  expect(html).toContain("Completed callers: Unknown; failed callers: Unknown"); expect(html).toContain("Database replication: Unknown");
  expect(renderToStaticMarkup(<DatabaseIncidentReadings report={{...missing, databaseRecoveryPlan: undefined}} />)).toBe("");
});

test("browser host schedules the approved recovery timeline and refuses manual challenge promotion", () => {
  const messages: FromWorker[] = [], callbacks: Array<() => void> = [];
  const host = createRunHost(m => messages.push(m), {set: callback => {callbacks.push(callback); return callback;}, clear: () => {}});
  const app: Resource = {id: "app", type: "Virtual Machine", x: 0, y: 0};
  host.handle({type: "start", start: {input: {resources: [app, {...db, databaseRecoveryPlan: {version: 1, promoteAtSecond: 3}}],
    connectionLines: [{id: "app-db", sourceId: "app", sourceType: "Virtual Machine", targetId: "db", targetType: "Database", port: 5432}],
    workloadProfile: {targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0, payloadSize: "light"}, seed: "browser-recovery", adapterProfiles: ["db-replication/1", "traffic-evidence/2"]},
    challengeId: "restore-a-database-writer", horizonSeconds: 14, stopAtSecond: 14, speed: 60,
    scenario: {version: 1, visibility: "revealed", databaseRecovery: {version: 1, resourceId: "db", earliestSecond: 3, latestSecond: 9}, steps: [
      {id: "fail-primary", atSecond: 2, request: {interventionId: "db-fail-primary", revision: 1, target: {resourceId: "db"}, parameters: {duration: 8}}},
      {id: "learner-promotion", atSecond: 3, request: {interventionId: "db-promote-replica", revision: 1, target: {resourceId: "db"}, parameters: {}}},
    ]}}});
  host.handle({type: "action", id: "forged", request: {kind: "intervention", parameters: {interventionId: "db-promote-replica", revision: 1, target: {resourceId: "db"}, parameters: {}}}});
  while (callbacks.length) callbacks.shift()!();
  expect(messages.filter(m => m.type === "error")).toEqual([]);
  expect(messages.find(m => m.type === "action")).toMatchObject({ok: false});
  const ticks = messages.filter(m => m.type === "second");
  expect(ticks).toHaveLength(14); expect(ticks.every(m => m.interventions.options.length === 0)).toBe(true);
  expect(ticks[2]!.view.metrics.db!.databaseReplication?.currentWriter).toBe("none");
  expect(ticks[3]!.view.metrics.db!.databaseReplication?.currentWriter).toBe("replica");
  expect(ticks[10]!.view.metrics.db!.databaseReplication?.primaryProcessState).toBe("fenced");
  expect(messages.at(-1)).toMatchObject({type: "done", submission: {stopAtSecond: 14, actions: []}});
});
