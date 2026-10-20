import { expect, test } from "bun:test";
import { firstStackCompileFixture } from "../fixtures/first-stack-compile";
import { prepareFirstStackExecution, runFirstStackQualification } from "../../apps/backend/firstStack/execution";
import { reviewSidecar } from "../../apps/backend/firstStack/authoring";
import { firstStackFixture } from "../../apps/backend/tests/firstStackFixture";
import { hash } from "../../apps/backend/firstStack/canonical";
import type { CausalEvent } from "../../packages/simulation/src/model2/workload/causal";
import express from "express";
import { createServer } from "node:http";
import { createFirstStackRouter } from "../../apps/backend/firstStack/routes";
import type { FirstStackDesign, FirstStackRepository } from "../../apps/backend/firstStack/service";

test("V1 stays readable and review-only; V2 refuses missing pool/readiness and reversed links", async () => {
  const v1 = firstStackFixture(); expect(reviewSidecar(v1.layout, v1.sidecar).ok).toBe(true);
  const f = await firstStackCompileFixture();
  expect(() => prepareFirstStackExecution("qualification", v1.layout, v1.sidecar, f.schedule, f.policy)).toThrow("V1 is review-only");
  const broken = structuredClone(f.sidecar); broken.links[0]!.from = "db";
  expect(reviewSidecar(f.layout, broken)).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "DIRECTED_LINK" })] });
  const missing = JSON.parse(JSON.stringify(f.sidecar)); delete missing.caller.pool; delete missing.nodes[0].ready;
  const review = reviewSidecar(f.layout, missing); expect(review.ok).toBe(false);
  expect(review.diagnostics.map(d => d.path)).toContain("caller.pool");
  expect(review.diagnostics.map(d => d.path)).toContain("nodes.0.ready");
});

test("1/2/4/8 apps receive exact recorded work and DB health on Stage 1; repeats are byte identical", async () => {
  const completion: number[] = [], dbPressure: number[] = [], appPressure: number[] = [];
  for (const apps of [1, 2, 4, 8]) {
    const f = await firstStackCompileFixture(apps), prepared = f.prepare();
    const events: CausalEvent[] = [];
    const off = runFirstStackQualification(prepared), on = runFirstStackQualification(prepared, e => events.push(structuredClone(e)));
    expect(JSON.stringify(on)).toBe(JSON.stringify(off));
    expect(JSON.stringify(runFirstStackQualification(prepared))).toBe(JSON.stringify(off));
    expect(off.evidence.counts).toMatchObject({ offered: 24, completed: 24, rejected: 0, deadlineExceeded: 0 });
    expect(off.evidence.network.loadBalancers[0]!.backends.map(b => b.selected)).toEqual(Array(apps).fill(24 / apps));
    const db = off.evidence.data.databases[0]!;
    expect(db.transactions.committed).toBe(24 + apps);
    expect(db.logicalReads).toBe(24 + apps);
    const foreground = events.filter(e => e.kind === "db-admitted" && e.work?.operation === "read");
    expect(foreground).toHaveLength(24);
    expect(foreground.every(e => (e.work?.message?.request as { key: string }).key === "hot")).toBe(true);
    const health = events.filter(e => e.kind === "db-admitted" && e.work?.operation === "health");
    expect(health).toHaveLength(apps);
    expect(health.every(e => (e.work?.message?.request as { key: string }).key === "cold")).toBe(true);
    expect(off.evidence.firstStack).toMatchObject({ timing: "assumption-only", fullMemory: "Unknown", fullCost: "Unknown", activeEngine: "1" });
    completion.push(Math.max(...off.evidence.results.map(r => r.responseUs)));
    dbPressure.push(db.cpu.unsatisfiedParallelismUs);
    appPressure.push(off.evidence.composition.cpu.filter(h => h.id.startsWith("host-app")).reduce((s, h) => s + h.unsatisfiedParallelismUs, 0));
  }
  expect(completion[0]!).toBeGreaterThan(completion[1]!);
  expect(completion[1]!).toBeGreaterThan(completion[2]!);
  expect(dbPressure[0]!).toBeLessThan(dbPressure[1]!);
  expect(dbPressure[1]!).toBeLessThan(dbPressure[2]!);
  expect(appPressure[0]!).toBeGreaterThan(appPressure[1]!);
  expect(appPressure[1]!).toBeGreaterThan(appPressure[2]!);
});

test("graph semantic ordering and observer retention cannot change compiled input or outcomes", async () => {
  const f = await firstStackCompileFixture(4), before = f.prepare();
  f.sidecar.nodes.reverse(); f.sidecar.paths.reverse(); f.sidecar.links.reverse(); f.sidecar.placement.reverse(); f.sidecar.operations.reverse();
  f.layout.resources.reverse(); f.layout.connectionLines.reverse();
  // Canvas revision changes are reviewed explicitly; geometry/order never enters physics.
  const { designRevision } = await import("../../apps/backend/firstStack/canonical");
  f.sidecar.designRevision = designRevision(f.layout);
  const after = f.prepare();
  expect(after.compiledHash).toBe(before.compiledHash);
  expect(runFirstStackQualification(after).evidence).toEqual(runFirstStackQualification(before).evidence);
});

test("shared-host budgets conserve CPU and reservations; Unknown/overflow refuse actionably", async () => {
  const f = await firstStackCompileFixture(4, { shared: true }), result = runFirstStackQualification(f.prepare());
  const pool = result.evidence.composition.cpu.find(h => h.id === "shared-apps")!;
  expect(pool.members).toBe(4);
  expect(pool.appCoreUs).toBeCloseTo(24 * 400 + 4 * 10, 6);
  expect(pool.appCoreUs).toBeLessThanOrEqual(pool.availableCoreUs);
  const members = result.evidence.resources.filter(r => r.id.startsWith("app-"));
  expect(members.reduce((s, r) => s + r.consumedCoreUs, 0)).toBeCloseTo(pool.appCoreUs, 6);
  expect(result.evidence.composition.memory.find(h => h.id === "shared-apps")).toMatchObject({ capacityBytes: 400, reservedBytes: 400, availableBytes: 0, leases: 4 });
  const shared = f.sidecar.placement.find(h => h.id === "shared-apps")!;
  shared.memoryBytes = 399; expect(() => f.prepare()).toThrow("Known reservations exceed capacity");
  shared.memoryBytes = null; expect(() => f.prepare()).toThrow("Unknown");
  const single = await firstStackCompileFixture(1); single.sidecar.placement[0]!.memoryBytes = null;
  expect(() => single.prepare()).toThrow("Supply a known bytes");
});

test("tampered recording, stale demand, unpinned workload and unsupported inputs refuse before execution", async () => {
  const f = await firstStackCompileFixture();
  f.schedule.rows[0]!.keys = ["cold"]; expect(() => f.prepare()).toThrow("content changed");
  const g = await firstStackCompileFixture(); g.sidecar.operations[0]!.cpuUs++;
  expect(() => g.prepare()).toThrow("Demand profile changed");
  const h = await firstStackCompileFixture(); h.sidecar.workload = null;
  expect(() => h.prepare()).toThrow("Pin both");
  const p = (await firstStackCompileFixture()).prepare(); p.sidecar.caller.pool.establishUs++;
  expect(() => runFirstStackQualification(p)).toThrow("Reviewed inputs changed");
  const variable = await firstStackCompileFixture(); variable.schedule.rows[0]!.responseBytes++;
  variable.schedule.executedScheduleHash = hash({ header: variable.schedule.header, rows: variable.schedule.rows });
  const { identity: _identity, ...body } = variable.schedule; variable.schedule.identity = hash(body);
  expect(() => variable.prepare()).toThrow("immutable reviewed workload");
  variable.sidecar.workload!.resolvedIdentity = variable.schedule.identity;
  variable.sidecar.workload!.executedScheduleHash = variable.schedule.executedScheduleHash;
  expect(() => variable.prepare()).toThrow("fixed bytes per operation");
  const changedLock = (await firstStackCompileFixture()).prepare(); changedLock.lock.compiledHash = "0".repeat(64);
  expect(() => runFirstStackQualification(changedLock)).toThrow("Reviewed inputs changed");
});

test("hot-key writes share one DB lock owner across all apps", async () => {
  const f = await firstStackCompileFixture(4, { write: true }), result = runFirstStackQualification(f.prepare());
  expect(result.evidence.counts.completed).toBe(24);
  expect(result.evidence.data.databases[0]!.logicalWrites).toBe(24);
  expect(result.evidence.data.databases[0]!.generatedLogBytes).toBe(24 * 8);
  expect(result.evidence.data.databases[0]!.locks.waits).toBeGreaterThan(0);
});

test("explicit range keys execute once per statement and DB readiness gates initial eligibility", async () => {
  const f = await firstStackCompileFixture(2, { range: true });
  const e = runFirstStackQualification(f.prepare()).evidence;
  expect(e.counts.completed).toBe(24);
  expect(e.data.databases[0]!.logicalReads).toBe(24 * 2 + 2);
  f.sidecar.nodes.find(n => n.id === "db")!.ready = false;
  const unavailable = runFirstStackQualification(f.prepare()).evidence;
  expect(unavailable.counts).toMatchObject({ completed: 0, rejected: 24 });
  expect(unavailable.network.loadBalancers[0]!.backends.every(b => !b.health && b.selected === 0)).toBe(true);
  expect(unavailable.data.databases[0]!.transactions.admitted).toBe(0);
});

test("internal compile HTTP checks ownership/revision and emits a lock without running or writing", async () => {
  const f = await firstStackCompileFixture();
  const row: FirstStackDesign = { id: "00000000-0000-4000-8000-000000000001", name: "qualification", ownerId: "owner", updatedAt: new Date("2026-10-20T00:00:00Z"), challengeId: null, layout: { ...f.layout, firstStack: f.sidecar } };
  let writes = 0;
  const repo: FirstStackRepository = { transaction: async task => task({ owned: async (_id, owner) => owner === row.ownerId ? structuredClone(row) : null,
    update: async () => { writes++; return row; }, create: async () => { writes++; return row; } }) };
  const app = express();
  app.use((req, res, next) => { res.locals.userId = req.header("x-owner") ?? "owner"; res.locals.model2Scope = req.header("x-scope") ?? "operator"; next(); });
  app.use("/first-stack", createFirstStackRouter(repo));
  app.use((error: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.statusCode ?? 500).json({ message: error.message }));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("Missing test listener");
  const url = `http://127.0.0.1:${address.port}/first-stack`;
  const body = { infrastructureId: row.id, expectedDesignUpdatedAt: row.updatedAt.toISOString(), workload: f.schedule, policy: f.policy };
  const post = (action: string, data: unknown = body, headers: Record<string, string> = {}) => fetch(`${url}/${action}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(data) });
  try {
    expect((await post("compile", body, { "x-scope": "lesson" })).status).toBe(404);
    expect((await post("compile", body, { "x-owner": "other" })).status).toBe(404);
    expect((await post("compile", { ...body, expectedDesignUpdatedAt: "2020-01-01T00:00:00Z" })).status).toBe(409);
    const result = await post("compile"); expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ executable: false, lock: { schema: "infraforge-first-stack-compile-lock/2", compiledHash: f.prepare().compiledHash } });
    expect((await post("run")).status).toBe(404);
    expect((await post("compile", { ...body, workload: { ...f.schedule, identity: "0".repeat(64) } })).status).toBe(422);
    expect(writes).toBe(0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
