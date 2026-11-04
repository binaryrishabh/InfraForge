import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { captureRunInputs } from "../deployments/runInputs";
import { buildRerunOptions } from "../reruns/options";
import type { StoredRun } from "../reports/report";
import type { CapabilityRequest } from "../capabilities/policy";
import { layout, workload } from "./integration/scenario";

const id = "11111111-1111-4111-8111-111111111111", owner = "owner";
const input = captureRunInputs(layout, workload, "route-variant");
const fixture = (): StoredRun & {ownerId: string; runtimeActive: boolean} => ({id, ownerId: owner, infrastructureId: null, runName: "Captured",
  status: "completed", runtimeActive: false, resourceCount: input.resources.length, createdAt: new Date(0), updatedAt: new Date(0),
  topologyRevision: 0, stages: [], timeline: [], chaosEvents: [], workloadProfile: input.workloadProfile, seed: input.seed,
  simulationState: null, runInputs: input, liveTopology: layout,
  terminalSnapshot: {version: 1, kind: "terminal", capturedAt: new Date(0).toISOString(), topologyRevision: 0,
    simulatedSeconds: 20, accumulatedCostUsd: 0, overallHealth: "healthy", metrics: {}}});
let source: ReturnType<typeof fixture> | null = fixture(), capacity = 0, ownerRuns = 0, designReads = 0;
let onShare = () => {};
const locks: string[] = [], writes: Record<string, unknown>[] = [], outbox: unknown[] = [], capabilities: CapabilityRequest[] = [];
const database = {
  $queryRaw: async (sql: TemplateStringsArray) => {const text = sql.join("?"); locks.push(text); if (text.includes('"Deployment"')) onShare(); return [];},
  deployment: {
    findFirst: async ({where}: {where: {id: string; ownerId: string}}) => source && where.id === source.id && where.ownerId === source.ownerId ? structuredClone(source) : null,
    // Owner-scoped counts are separate from server-wide counts, as in admission.
    count: async ({where}: {where?: {ownerId?: string}} = {}) => where?.ownerId ? ownerRuns : capacity,
    create: async ({data}: {data: Record<string, unknown>}) => {writes.push(data); return {id: "created", ...data};},
  },
  infrastructure: {findFirst: async () => {designReads++; return {layout};}},
  outbox: {create: async (data: unknown) => {outbox.push(data);}},
};
mock.module("../lib/prisma", () => ({prisma: {...database, $transaction: async (fn: (tx: typeof database) => Promise<unknown>) => fn(database)}}));
// Keep the module's other exports so files sharing this process still import them.
const realPolicy = await import("../capabilities/policy");
mock.module("../capabilities/policy", () => ({...realPolicy, requireCapability: (_owner: string, request: CapabilityRequest) => {capabilities.push(request);}}));
const {rerunRouter} = await import("../reruns/routes");
let server: Server, base: string;
beforeAll(() => {
  const app = express(); app.use(express.json()); app.use((_req, res, next) => {res.locals.userId = owner; next();}); app.use(rerunRouter);
  app.use((error: Error & {statusCode?: number}, _req: express.Request, res: express.Response, _next: express.NextFunction) => {res.status(error.statusCode ?? 500).json({message: error.message});});
  server = app.listen(0, "127.0.0.1"); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
function reset() {source = fixture(); capacity = 0; ownerRuns = 0; designReads = 0; onShare = () => {}; locks.length = writes.length = outbox.length = capabilities.length = 0;}
function request(matchedStop = true) {
  const choice = buildRerunOptions(source!, null).workloadVariant.choices.find(c => c.variant.value === "poisson")!;
  return {mode: "workload-variant", matchedStop, variant: choice.variant, expectedInputHash: choice.inputHash};
}
const post = (body: unknown) => fetch(`${base}/${id}/reruns`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});

test("locked variant creation retains admission, ownership, designless input, capability and matched stop", async () => {
  reset(); const response = await post(request()); expect(response.status).toBe(201);
  expect(writes[0]).toMatchObject({sourceRunId: id, ownerId: owner, infrastructureId: null, rerunMode: "workload-variant", autoStopAtSimulatedSeconds: 20, seed: input.seed});
  expect(designReads).toBe(0);
  expect(outbox).toHaveLength(1);
  expect(capabilities).toEqual([{capability: "run.start", purpose: "engineer", engine: "2", profile: "2", durationSeconds: 20}]);
  expect(locks[0]).toContain("FOR SHARE"); expect(locks[1]).toContain("pg_advisory_xact_lock");
  reset(); source!.infrastructureId = "design";
  expect((await post(request(false))).status).toBe(201);
  expect(writes[0]!.autoStopAtSimulatedSeconds).toBeNull();
  expect(locks[0]).toContain('"Infrastructure"'); expect(locks[0]).toContain("FOR UPDATE"); expect(locks[1]).toContain("FOR SHARE");
});
test("variant creation refuses other owners, stale hash, source deletion/change races and unavailable stop", async () => {
  reset(); const body = request(); source!.ownerId = "other";
  expect((await post(body)).status).toBe(404); expect(writes).toHaveLength(0);
  reset(); expect((await post({...request(), expectedInputHash: "0".repeat(64)})).status).toBe(409);
  reset(); const deleted = request(); onShare = () => {source = null;};
  expect((await post(deleted)).status).toBe(404); expect(writes).toHaveLength(0);
  reset(); const changed = request(); onShare = () => {source!.runInputs = {...input, seed: "changed"};};
  const conflict = await post(changed); expect(conflict.status).toBe(409); expect((await conflict.json() as {message: string}).message).toContain("The source run changed since preview");
  reset(); const noStop = request(); source!.terminalSnapshot = null;
  expect((await post(noStop)).status).toBe(409); expect(writes).toHaveLength(0);
  reset(); const active = request(); onShare = () => {source!.runtimeActive = true;};
  expect((await post(active)).status).toBe(409);
});
test("strict client body and busy admission retain their existing 400/429 behavior", async () => {
  reset(); expect((await post({...request(), resources: []})).status).toBe(400); expect(locks).toHaveLength(0);
  reset(); capacity = 100000;
  const busy = await post(request()); expect(busy.status).toBe(429); expect((await busy.json() as {message: string}).message).toContain("capacity is busy");
  expect(writes).toHaveLength(0); expect(outbox).toHaveLength(0);
});
