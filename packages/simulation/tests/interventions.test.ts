import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { buildContractFromRunInputs } from "../src/model2/product/runContract";
import { withTimeline } from "../src/model2/product/timeline";
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
  // Session capacity can only be lowered from the authored limit (the bound needs the design, so the compile step enforces it).
  refuse(intervention("session-capacity", {sessions: 1_000_000, duration: 1}), "BOUNDS");
  refuse(intervention("session-capacity", {sessions: 0, duration: 7}), "BOUNDS");
  run.apply(intervention("session-capacity", {sessions: 0, duration: 2}));
  refuse(intervention("session-capacity", {sessions: 1, duration: 1}), "OVERLAP");
});


test("zero database CPU stalls real queries and resumes work with the authored core count", () => {
  const run = createModel2Run(interventionInput(), 8), normal = createModel2Run(interventionInput(), 8);
  run.apply(intervention("cpu-capacity", {cores: 0, duration: 2})); advance(run, 2); advance(normal, 2);
  const during = run.evidence(), base = normal.evidence();
  expect(during.data.databases[0]!.cpu.capacity).toBe(0);
  expect(during.data.databases[0]!.transactions.committed).toBe(0);
  expect(during.data.databases[0]!.queries.executingCpu).toBe(4);
  expect(base.data.databases[0]!.transactions.committed).toBe(200);
  advance(run, 1);
  expect(run.evidence().data.databases[0]!.cpu.capacity).toBe(1);
  expect(run.evidence().data.databases[0]!.transactions.committed).toBeGreaterThan(0);
});

test("one-shot cache flush causes a real miss, backing query and refill without undoing effects", () => {
  const run = createModel2Run(interventionInput(true), 8), normal = createModel2Run(interventionInput(true), 8);
  advance(run, 2); advance(normal, 2);
  expect(run.evidence().data.caches[0]!.logicallyLiveEntries).toBe(1);
  const applied = run.apply(intervention("flush", {}, {resourceId: "cache"}));
  expect(applied.outcome.intervention!.endUs).toBeNull();
  advance(run, 2); advance(normal, 2);
  const e = run.evidence(), b = normal.evidence();
  expect(e.data.caches[0]!.epoch).toBe(1);
  expect(e.data.caches[0]!.misses).toBe(2); expect(b.data.caches[0]!.misses).toBe(1);
  expect(e.data.caches[0]!.fills).toBe(2);
  expect(e.data.databases[0]!.transactions.committed).toBe(2); expect(b.data.databases[0]!.transactions.committed).toBe(1);
  expect(e.product.interventions![0]!.phase).toBe("completed");
});

for (const kind of ["delay", "partition"] as const) test(`edge ${kind} changes downstream work and restores the transport baseline`, () => {
  const run = createModel2Run(interventionInput(), 8), normal = createModel2Run(interventionInput(), 8);
  const result = run.apply(intervention(kind, kind === "delay" ? {delay: 200_000, duration: 2} : {duration: 2}, {edgeId: "app-db", direction: "request"}));
  expect(result.outcome.intervention!.resolvedTargets).toEqual(["app-db:app:db/request"]);
  advance(run, 2); advance(normal, 2);
  const e = run.evidence(), b = normal.evidence(), link = e.network.links.find(l => l.id === "app-db:app:db/request")!;
  if (kind === "delay") {
    expect(link.addedPropagationUs).toBe(200_000);
    expect(e.counts.completed).toBe(36); expect(b.counts.completed).toBe(200);
    expect(run.view().traffic.latencyMs.p95).toBeGreaterThan(normal.view().traffic.latencyMs.p95!);
  } else {
    expect(link.partitioned).toBe(true); expect(e.counts.rejected).toBe(200); expect(b.counts.rejected).toBe(0);
    expect(e.data.databases[0]!.transactions.committed).toBe(0);
  }
  advance(run, 1); const after = run.evidence();
  const restored = after.network.links.find(l => l.id === link.id)!;
  expect(restored.partitioned).toBe(false); expect(restored.addedPropagationUs).toBe(0);
  expect(after.data.databases[0]!.transactions.committed).toBeGreaterThan(0);
});

for (const kind of ["session-capacity", "cpu-capacity", "delay", "partition"] as const) test(`${kind} restores exactly at endUs, never the preceding whole second`, () => {
  const input = interventionInput(), built = buildContractFromRunInputs(input, 4);
  if ("refused" in built) throw Error(JSON.stringify(built));
  const request = intervention(kind, kind === "session-capacity" ? {sessions: 0, duration: 2} : kind === "cpu-capacity" ? {cores: 0, duration: 2} : kind === "delay" ? {delay: 123, duration: 2} : {duration: 2}, kind === "delay" || kind === "partition" ? {edgeId: "app-db", direction: "both"} : {resourceId: "db"});
  const c = compileProduct({schema: "infraforge-saved-design/1", resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile}, withTimeline(built.contract, [{id: "control", kind: "intervention", request: request.parameters, atUs: 1}]));
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const run = createProductModel2(c.value); run.advanceTo(2_000_000);
  expect(run.evidence().product.interventions![0]!.phase).toBe("active");
  const state = () => { const e = run.evidence(); return kind === "session-capacity" ? e.data.databases[0]!.sessions.limit : kind === "cpu-capacity" ? e.data.databases[0]!.cpu.capacity : kind === "delay" ? e.network.links[0]!.addedPropagationUs : e.network.links[0]!.partitioned; };
  expect(state()).toBe(kind === "delay" ? 123 : kind === "partition" ? true : 0);
  run.advanceTo(2_000_001);
  expect(state()).toBe(kind === "session-capacity" ? 100 : kind === "cpu-capacity" ? 1 : kind === "delay" ? 0 : false);
  expect(run.evidence().product.interventions![0]!.phase).toBe("completed");
});

test("capacity actions refuse process replacement overlap in both request orders", () => {
  for (const reverse of [false, true]) {
    const run = createModel2Run(interventionInput(), 40);
    const requests = [intervention("session-capacity", {sessions: 0, duration: 2}), {kind: "chaos" as const, parameters: {type: DeploymentChaosNames.Crash, resourceId: "db"}}];
    if (reverse) requests.reverse(); run.apply(requests[0]!);
    expect(() => run.apply(requests[1]!)).toThrow("GENERATION"); expect(run.actions).toHaveLength(1);
  }
});

test("legacy canvas delay resolves materialized links instead of symbolic template endpoints", () => {
  const run = createModel2Run(interventionInput(), 40);
  run.apply({kind: "chaos", parameters: {type: DeploymentChaosNames.NetworkDelay, resourceId: "db"}});
  advance(run, 2);
  expect(run.evidence().network.links.find(l => l.to === "db")!.addedPropagationUs).toBe(200_000);
  expect(run.view().traffic.latencyMs.p95).toBeGreaterThan(200);
});

test("shared physical links report all paths and refuse direction aliases before accepting overlap", () => {
  const input = interventionInput(), built = buildContractFromRunInputs(input, 5);
  if ("refused" in built) throw Error(JSON.stringify(built));
  const contract = built.contract, edge = contract.edges["app-db"]!, transport = structuredClone(contract.transports.database!);
  transport.ownership = "shared";
  const request = transport.links[0]!, response = transport.links[1]!;
  transport.links = [
    {...request, id: "app-in", from: "$app", to: "hub"}, {...request, id: "caller-in", from: "$caller", to: "hub"},
    {...request, id: "common-in", from: "hub", to: "$db"}, {...response, id: "common-out", from: "$db", to: "hub"},
    {...response, id: "app-out", from: "hub", to: "$app"}, {...response, id: "caller-out", from: "hub", to: "$caller"},
  ];
  contract.transports.shared = transport;
  Object.assign(edge, {transport: "shared", request: ["app-in", "common-in"], response: ["common-out", "app-out"]});
  contract.caller.dependencies.push({...edge, id: "probe", target: "$db", request: ["caller-in", "common-in"], response: ["common-out", "caller-out"]});
  const design = {schema: "infraforge-saved-design/1" as const, resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile};
  const first = {id: "one", kind: "intervention" as const, atUs: 1, request: intervention("delay", {delay: 123, duration: 2}, {edgeId: "app-db", direction: "request"}).parameters};
  const c = compileProduct(design, withTimeline(contract, [first]));
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  expect(c.value.interventionReceipts![0]!.affectedPaths).toEqual(["app-db:app:db", "external/probe"]);
  expect(c.value.interventionReceipts![0]!.resolvedTargets).toEqual(["transport:shared/app-in", "transport:shared/common-in"]);
  const second = {...first, id: "two", request: {...first.request, target: {edgeId: "app-db", direction: "both" as const}}};
  const refused = compileProduct(design, withTimeline(contract, [first, second]));
  expect(refused.ok).toBe(false);
  expect(refused.diagnostics[0]!.message).toContain("OVERLAP");
  const run = createProductModel2(c.value); run.advanceTo(1);
  expect(run.evidence().network.links.find(l => l.id === "transport:shared/common-in")!.addedPropagationUs).toBe(123);
});

test("active controls follow engine events and clear at the restore microsecond", () => {
  const f = productFixture({horizon: 4_000_000});
  const c = compileProduct(f.design, withTimeline(f.contract, [{id: "active", atUs: 1, kind: "intervention", request: intervention("delay", {delay: 100, duration: 2}, {edgeId: f.design.connections[0]!.id, direction: "both"}).parameters}]));
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const run = createProductModel2(c.value);
  expect(run.activeInterventions()).toEqual([]);
  run.advanceTo(1); expect(run.activeInterventions()).toHaveLength(1);
  run.advanceTo(2_000_000); expect(run.activeInterventions()).toHaveLength(1);
  run.advanceTo(2_000_001); expect(run.activeInterventions()).toEqual([]);
});

test("edge a never selects materialized paths belonging to a:b", () => {
  const input = interventionInput();
  input.connectionLines[0]!.id = "a";
  input.resources.push({id: "other", type: "Virtual Machine", x: 2, y: 0}, {id: "lb", type: "Load Balancer", x: -1, y: 0});
  for (const targetId of ["app", "other"]) input.connectionLines.push({id: `lb-${targetId}`, sourceId: "lb", targetId, sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80});
  input.connectionLines.push({...input.connectionLines[0]!, id: "a:b", sourceId: "other"});
  const run = createModel2Run(input, 5);
  const receipt = run.apply(intervention("partition", {duration: 1}, {edgeId: "a", direction: "both"})).outcome.intervention!;
  expect(receipt.resolvedTargets).toEqual(["a:app:db/request", "a:app:db/response"]);
  expect(receipt.affectedPaths).toEqual(["a:app:db"]);
  advance(run, 1);
  expect(run.evidence().network.links.filter(l => l.id.startsWith("a:b:")).every(l => !l.partitioned)).toBe(true);
});
