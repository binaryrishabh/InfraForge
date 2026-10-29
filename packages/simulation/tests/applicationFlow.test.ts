import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { legacyVmCall, fanout, canvasFlow } from "./applicationFlow.fixture";
import { createNetworkModel2, createNetworkRuntime } from "../src/model2/network/run";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import type { ComputeResource } from "../src/model2/compute/contracts";
import { quantities } from "./workloadFixture";
import { EventKernel } from "../src/model2/time";
import { applicationFlow } from "../src/model2/compute/flow";
import type { Invocation, RemoteCompletion } from "../src/model2/workload/contracts";
import { validateFlows } from "../src/model2/compute/validateFlow";
import { computeAdapter } from "../src/model2/network/validate";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v).replaceAll("\r\n", "\n")).digest("hex");
const run = (d: ReturnType<typeof fanout>) => { const r = createNetworkModel2(d); r.advanceTo(r.horizon); return r.evidence(); };
test("no-flow VM to VM retains the pre-edit full evidence bytes including execution.processed", () => {
  expect(hash(run(legacyVmCall()))).toBe("da6b13500c8c3d355351af988258a7d20b39cace37e27f4c6d95ab7585ea05fa");
});
test("all join consumes one owner CPU demand and max branch latency, with deterministic replay", () => {
  const d = fanout(), e = run(d);
  expect(e.results[0]!.responseUs).toBe(3100);
  expect(e.resources.find(r => r.id === "app")!.consumedCoreUs).toBe(100);
  expect(e.resources.find(r => r.id === "app")!.busySlotUs).toBe(3100);
  expect(e.counts.completed).toBe(1); expect(run(d)).toEqual(e);
});
test("2 of 3 delivered loser detaches or cooperatively releases remote work through existing gates", () => {
  for (const remoteCancellation of ["detach", "request-cancellation"] as const) {
    const d = fanout(2); d.paths.forEach(p => p.pool.remoteCancellation = remoteCancellation);
    const r = createNetworkModel2(d); r.advanceTo(2100); const e = r.evidence();
    expect(e.counts.completed).toBe(1);
    expect(e.resources.find(r => r.id === "tax")!.serving).toBe(remoteCancellation === "detach" ? 1 : 0);
    expect(e.resources.find(r => r.id === "tax")!.cancelled).toBe(remoteCancellation === "detach" ? 0 : 1);
    r.advanceTo(r.horizon);
    const path = r.evidence().network.paths.find(p => p.target === "tax")!;
    expect(path.cancelled).toBe(1);
    expect(path.remoteOutcomesAfterStop).toBe(1);
  }
});
test("request cancellation reaches all live branches; unsupported owner continues to completion", () => {
  for (const cancellation of ["cooperative", "unsupported"] as const) {
    const d = fanout("all", { timeout: 500 });
    (d.resources[0] as ComputeResource).cancellation = cancellation;
    d.operations.forEach(o => o.onCallerStop = "request-cancellation"); d.paths.forEach(p => p.pool.remoteCancellation = "request-cancellation");
    const e = run(d); expect(e.counts.deadlineExceeded).toBe(1);
    expect(e.resources.find(r => r.id === "app")![cancellation === "cooperative" ? "cancelled" : "completed"]).toBe(1);
    expect(e.resources.filter(r => r.id !== "app").every(r => r[cancellation === "cooperative" ? "cancelled" : "completed"] === 1)).toBe(true);
  }
});
test("pause parks a completed join until owner recovery", () => {
  const d = fanout(2), q = quantities(), app = d.resources[0] as ComputeResource;
  app.applicationFlow!.operations.light!.steps.push({ id: "after", kind: "compute" });
  d.faults.push({ id: "pause", target: "app", kind: "pause-service", at: q.q("pause.at", 1500, "us"), duration: q.q("pause.duration", 2000, "us") }); d.ledger.push(...q.ledger);
  expect(run(d).results[0]!.responseUs).toBe(3600);
});
test("runtime rejects cycles, same-path siblings, invalid thresholds, unsafe calls and missing bytes", () => {
  const mutations: Array<(d: ReturnType<typeof fanout>) => void> = [
    d => { const s = (d.resources[0] as ComputeResource).applicationFlow!.operations.light!.steps[1]!; if (s.kind === "parallel") s.wait = 4; },
    d => { const s = (d.resources[0] as ComputeResource).applicationFlow!.operations.light!.steps[1]!; if (s.kind === "parallel") s.branches[1]!.target = "inventory"; },
    d => { (d.resources[0] as ComputeResource).applicationFlow!.operations.light!.steps = [{ id: "self", kind: "call", target: "app" }]; },
    d => { delete d.paths[1]!.bytes.light; },
    d => { d.operations[0]!.idempotency = "non-idempotent"; },
    d => { (d.resources[1] as ComputeResource).profiles.light = "missing"; },
    d => { (d.resources[0] as ComputeResource).downstream = "inventory"; },
  ];
  for (const mutate of mutations) { const d = fanout(); mutate(d); expect(() => run(d)).toThrow(); }
});
test("canvas inventory, pricing and tax flow compiles, runs and records authored origins", () => {
  const d = canvasFlow(), a = contractFromDesign(d); if ("refused" in a) throw Error(JSON.stringify(a.refused));
  const c = compileProduct(d, a.contract); if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const events: Array<{ kind: string; detail: Record<string, unknown> }> = [];
  const r = createProductModel2(c.value, undefined, e => events.push(e)); r.advanceTo(1000000);
  expect(r.evidence().counts.completed).toBe(1);
  expect(events.filter(e => e.kind === "flow-branch-start")).toHaveLength(3);
  expect(events.find(e => e.kind === "flow-join")!.detail.threshold).toBe(3);
  expect(c.value.semantic.versions.contract).toContain("application-flow/1");
  expect(c.value.semantic.numericOrigins.some(o => o.origin === "user-authored" && o.sources.some(s => s.includes("applicationFlow.operations.read.steps")))).toBe(true);
  const again = createProductModel2(c.value); again.advanceTo(1000000); expect(again.evidence()).toEqual(r.evidence());
});
test("synchronous branch zero pool rejection still dispatches every sibling and terminates once", () => {
  const d = fanout("all", { count: 2, interval: 1, slots: 4, connections: 4 });
  const q = quantities(); d.paths[1]!.pool.maxConnections = q.q("overflow.connections", 1, "count"); d.paths[1]!.pool.pending = q.q("overflow.pending", 0, "count"); d.ledger.push(...q.ledger);
  const events: Array<{kind:string; work?: {rootId:string}; detail:Record<string, unknown>}> = [];
  const r = createNetworkRuntime(d, {resource: () => undefined, causal: e => events.push(e)}); r.advanceTo(r.horizon);
  const e = r.evidence(); expect(e.counts.rejected).toBe(1); expect(e.counts.completed).toBe(1);
  expect(e.network.paths.find(p => p.target === "inventory")!.reasons["pool-overflow"]).toBe(1);
  expect(events.filter(e => e.kind === "flow-branch-start")).toHaveLength(6);
  expect(events.filter(e => e.kind === "caller-terminal")).toHaveLength(2);
  expect(events.filter(e => e.kind === "app-terminal" && e.work?.rootId === events.find(e => e.kind === "caller-terminal" && e.detail.outcome === "rejected")?.work?.rootId && e.detail.outcome === "rejected")).toHaveLength(1);
});
test("2 of 3 pool-wait loser withdraws acquisition without remote work", () => {
  const d = fanout(2), q = quantities();
  d.paths[3]!.pool.establish = q.q("tax.slow-connect", 5000, "us");
  // A reserved connection still waits in acquisition until setup completes.
  d.ledger.push(...q.ledger);
  const e = run(d), tax = e.resources.find(r => r.id === "tax")!;
  expect(e.results[0]!.responseUs).toBe(2100); expect(tax.received).toBe(0);
  expect(e.network.paths.find(p => p.target === "tax")!.remoteOutcomesAfterStop).toBe(0);
});
test("children isolate message/session/payload and use persisted identities; cancellation skips settled receipts", () => {
  const clock = new EventKernel(100), children: Invocation[] = [], callbacks: RemoteCompletion[] = [], cancels: number[] = [], terminal: string[] = [];
  const parent: Invocation = {rootId:"root",callId:JSON.stringify(["root","attempt",0,"entry"]),attempt:0,operation:"read",offeredAt:0,sessionId:"session",payloadBytes:999,message:{request:"parent"}};
  const runner = applicationFlow("app", parent, {steps:[{id:"p",kind:"parallel",wait:"all",branches:["a","b","c"].map(id=>({id,kind:"call",target:id}))}]}, clock, (_target, child, done) => {
    const index = children.length; children.push(child); callbacks.push(done);
    if (index === 0) done("rejected");
    return {admitted:index!==0,state:()=>index===0?"finished":"waiting",cancel:()=>{cancels.push(index);done("cancelled");return "cancelled";}};
  }, () => {throw Error("no compute");}, outcome=>terminal.push(outcome));
  runner.start(); clock.advanceTo(0);
  expect(children).toHaveLength(3); expect(cancels).toEqual([1,2]); expect(terminal).toEqual(["rejected"]);
  for (const [i, child] of children.entries()) {
    expect(child).not.toHaveProperty("message");expect(child).not.toHaveProperty("sessionId");expect(child).not.toHaveProperty("payloadBytes");
    expect(JSON.parse(child.callId)).toEqual(["root","attempt",0,"entry","flow","app","read","p",["a","b","c"][i]]);
  }
  callbacks[2]!("completed"); expect(terminal).toHaveLength(1);
});
test("flow cycle check expands router backends and rejects operation effects conservatively", () => {
  const d = fanout(), app = d.resources[0] as ComputeResource;
  app.applicationFlow!.operations.light!.steps = [{id:"edge",kind:"call",target:"router"}];
  const adapted = computeAdapter(d); adapted.resources.push({id:"router",kind:"router",backends:["app"]});
  expect(() => validateFlows(adapted)).toThrow("cycle");
  const unsafe = fanout(), owner = unsafe.resources[0] as ComputeResource;
  unsafe.operations[1]!.idempotency="unknown";
  owner.applicationFlow!.operations.light!.steps=[{id:"unsafe",kind:"call",target:"inventory",operation:"heavy"}];
  expect(()=>run(unsafe)).toThrow("mutating or unknown");
  delete unsafe.paths[1]!.bytes.heavy;
  expect(()=>run(unsafe)).toThrow("bytes");
});
test("owner rename preserves equal caller and response timeout outcome and classification", () => {
  const outputs = ["a-app","z-app"].map(name => {
    const d=canvasFlow(); d.resources[0]!.id=name;
    d.connections.forEach(e=>e.sourceId=name);
    const a=contractFromDesign(d);if("refused" in a)throw Error(JSON.stringify(a.refused));
    const contract=a.contract, q=quantities();
    contract.application.operations.forEach(o=>o.callerTimeout=q.q(`tie.${o.id}.caller`,1000,"us"));
    for(const [id,t] of Object.entries(contract.transports)) {t.pool.responseTimeout=q.q(`tie.${id}.response`,1000,"us");t.pool.establish=q.q(`tie.${id}.establish`,0,"us");}
    contract.ledger.push(...q.ledger);
    const c=compileProduct(d,contract);if(!c.ok)throw Error(JSON.stringify(c.diagnostics));
    const rows: Array<Record<string,unknown>>=[];const r=createProductModel2(c.value,undefined,e=>{if(e.kind==="caller-terminal")rows.push(e.detail);});r.advanceTo(1000000);
    return {counts:r.evidence().counts,rows};
  });
  expect(outputs[0]).toEqual(outputs[1]);expect(outputs[0]!.counts.deadlineExceeded).toBe(1);
});
