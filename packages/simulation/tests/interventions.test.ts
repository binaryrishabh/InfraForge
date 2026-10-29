import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createModel2Run } from "../src/model2/product/liveRun";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { productFixture } from "./productFixture";
import { interventionInput, intervention, advance } from "./interventionFixture";
import { relationalDatabase } from "../src/model2/data/database";
import { dataFixture } from "./dataFixture";
import { EventKernel } from "../src/model2/time";
import type { Invocation } from "../src/model2/workload/contracts";

test("pre-edit product compile and evidence bytes stay identical without an intervention", () => {
  const f = productFixture({horizon: 1_000_000}), c = compileProduct(f.design, f.contract);
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const run = createProductModel2(c.value); run.advanceTo(run.horizon);
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v).replaceAll("\r\n", "\n")).digest("hex");
  expect(hash(c.value)).toBe("1fecbfa98be937ea9a7b89d9fb7580d7fa10e8b14304979b65ab1462f7cecffe");
  expect(hash(run.evidence())).toBe("a8728930d3f4dc38bbdac827f7e2f7376bc3f68b254f92960233b955981828ad");
});

test("lowering session capacity preserves an established session and refuses new work with session-limit", () => {
  const config = dataFixture().resources.find(r => r.kind === "relational")!;
  if (config.kind !== "relational") throw Error("fixture");
  const clock = new EventKernel(10000), db = relationalDatabase(config, clock);
  expect(db.openSession("existing")).toBe(true); db.sessionCapacity(0);
  expect(db.sessionAlive("existing")).toBe(true); expect(db.openSession("new")).toBe(false);
  const work = (id: string, sessionId: string): Invocation => ({rootId: id, callId: id, operation: "light", attempt: 0, offeredAt: 0, sessionId, message: {request: {kind: "query", key: "k0"}}});
  expect(db.accept(work("a", "existing"), () => {}).admitted).toBe(true);
  expect(db.accept(work("b", "new"), () => {}).admitted).toBe(false);
  clock.advanceTo(10000);
  expect(db.evidence().reasons["session-limit"]).toBe(1);
  expect(db.evidence().transactions.committed).toBe(1);
  expect(db.sessionAlive("existing")).toBe(true);
});

test("scheduled session control refuses fresh connections and restores authored capacity at the exact microsecond", () => {
  const run = createModel2Run(interventionInput(false, 1), 8);
  const applied = run.apply(intervention("session-capacity", {sessions: 0, duration: 2}));
  expect(applied.outcome.intervention).toMatchObject({atUs: 1, endUs: 2_000_001, resolvedTargets: ["db"]});
  advance(run, 2); const during = run.evidence();
  expect(during.data.databases[0]!.sessions.limit).toBe(0);
  expect(during.data.databases[0]!.sessionEvents!.refused).toBeGreaterThan(0);
  expect(during.network.trace.events.some(r => r.detail.includes("session-limit"))).toBe(true);
  advance(run, 1); const after = run.evidence();
  expect(after.data.databases[0]!.sessions.limit).toBe(100);
  expect(after.data.databases[0]!.transactions.committed).toBeGreaterThan(0);
  expect(after.product.interventions![0]!.phase).toBe("completed");
  expect(after.network.trace.events.filter(r => r.kind === "data-intervention").map(r => [r.at, r.detail])).toEqual([[1, "applied"], [2_000_001, "ended"]]);
});

test("bad revision, role, path, bounds, horizon and overlap leave timeline and evidence untouched", () => {
  const run = createModel2Run(interventionInput(), 8); advance(run, 1);
  const refuse = (request: Parameters<typeof run.apply>[0], message: string) => {
    const before = JSON.stringify(run.evidence()), actions = JSON.stringify(run.actions);
    expect(() => run.apply(request)).toThrow(message);
    expect(JSON.stringify(run.actions)).toBe(actions); expect(JSON.stringify(run.evidence())).toBe(before);
  };
  refuse({...intervention("session-capacity", {sessions: 0, duration: 1}), parameters: {...intervention("session-capacity", {}).parameters, revision: 2}}, "REVISION");
  refuse(intervention("session-capacity", {sessions: 0, duration: 1}, {resourceId: "app"}), "ROLE");
  refuse(intervention("delay", {delay: 1, duration: 1}, {edgeId: "missing", direction: "both"}), "PATH");
  refuse(intervention("cpu-capacity", {cores: 100, duration: 1}), "BOUNDS");
  refuse(intervention("session-capacity", {sessions: 0, duration: 7}), "BOUNDS");
  run.apply(intervention("session-capacity", {sessions: 0, duration: 2}));
  refuse(intervention("session-capacity", {sessions: 1, duration: 1}), "OVERLAP");
});

