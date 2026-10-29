import { test, expect, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { legacyVmCall, fanout, canvasFlow } from "./applicationFlow.fixture";
import { createNetworkModel2, createNetworkRuntime, type NetworkExtension } from "../src/model2/network/run";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import type { ComputeResource } from "../src/model2/compute/contracts";
import { quantities } from "./workloadFixture";
import { EventKernel } from "../src/model2/time";
import { applicationFlow } from "../src/model2/compute/flow";
import { applicationFlowEvidence } from "../src/model2/compute/flowEvidence";
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
    const store = applicationFlowEvidence(1000);
    const r = createNetworkRuntime(d, {resource:()=>undefined, causal:store.observe}); r.advanceTo(2100); const e = r.evidence();
    expect(e.counts.completed).toBe(1);
    expect(e.resources.find(r => r.id === "tax")!.serving).toBe(remoteCancellation === "detach" ? 1 : 0);
    expect(e.resources.find(r => r.id === "tax")!.cancelled).toBe(remoteCancellation === "detach" ? 0 : 1);
    r.advanceTo(r.horizon);
    const path = r.evidence().network.paths.find(p => p.target === "tax")!;
    expect(path.cancelled).toBe(1);
    expect(path.remoteOutcomesAfterStop).toBe(1);
    const rows = store.measure().events;
    expect(rows.filter(e=>e.kind==="flow-branch-terminal" && e.detail.branch==="tax" && e.detail.outcome==="cancelled-after-join")).toHaveLength(1);
    const late = rows.filter(e=>e.kind==="flow-late-outcome");
    expect(late).toHaveLength(1);
    expect(late[0]!.detail).toMatchObject({branch:"tax",outcome:remoteCancellation === "detach" ? "completed" : "cancelled",accounting:"remote-after-transport-stop"});
    expect(late[0]!.atUs).toBe(remoteCancellation === "detach" ? 3100 : 2100);
  }
});
test("request cancellation reaches all live branches; unsupported owner continues to completion", () => {
  for (const cancellation of ["cooperative", "unsupported"] as const) {
    const d = fanout("all", { timeout: 500 });
    (d.resources[0] as ComputeResource).applicationFlow!.operations.light!.steps.push({id:"must-not-run-after-cancel",kind:"compute"});
    (d.resources[0] as ComputeResource).cancellation = cancellation;
    d.operations.forEach(o => o.onCallerStop = "request-cancellation"); d.paths.forEach(p => p.pool.remoteCancellation = "request-cancellation");
    const e = run(d); expect(e.counts.deadlineExceeded).toBe(1);
    expect(e.resources.find(r => r.id === "app")![cancellation === "cooperative" ? "cancelled" : "completed"]).toBe(1);
    expect(e.resources.filter(r => r.id !== "app").every(r => r[cancellation === "cooperative" ? "cancelled" : "completed"] === 1)).toBe(true);
    expect(e.resources.find(r=>r.id==="app")!.consumedCoreUs).toBe(cancellation === "cooperative" ? 100 : 200);
  }
});
test("sequential compute waits re-register through pause without CPU collisions or duplicate step terminals",()=>{
  const d=fanout("all",{cpu:0}),q=quantities(),app=d.resources[0] as ComputeResource;
  app.applicationFlow!.operations.light!.steps=[{id:"first",kind:"compute"},{id:"second",kind:"compute"}];
  const profile=d.profiles.find(p=>p.id===app.profiles.light)!;if(profile.schema!=="infraforge-compute-demand/1")throw Error("profile");
  profile.blockingWait=q.q("flow.wait",100,"us");
  d.faults.push({id:"during-wait",kind:"pause-service",target:"app",at:q.q("wait.pause.at",50,"us"),duration:q.q("wait.pause.duration",200,"us")});d.ledger.push(...q.ledger);
  const rows:Array<{kind:string}>=[];const r=createNetworkRuntime(d,{resource:()=>undefined,causal:e=>rows.push(e)});r.advanceTo(r.horizon);
  expect(r.evidence().results[0]!.responseUs).toBe(400);expect(r.evidence().resources.find(r=>r.id==="app")!.consumedCoreUs).toBe(0);
  expect(rows.filter(e=>e.kind==="flow-step-terminal")).toHaveLength(2);
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
  expect(r.evidence().results[0]!.responseUs).toBe(6636);
  expect(r.evidence().resources.find(r=>r.id==="app")!.busySlotUs).toBe(6318);
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
  d.paths[3]!.pool.maxConnections = q.q("tax.serial.connections", 1, "count");
  d.ledger.push(...q.ledger);
  let dispatch: Parameters<NonNullable<NetworkExtension["connection"]>>[2] | undefined;
  const store = applicationFlowEvidence(1000);
  const r = createNetworkRuntime(d, { resource:()=>undefined, causal:store.observe, connection:(_path,_clock,send)=>{dispatch=send;return undefined;}, install(kernel) {
    kernel.schedule(0,0,JSON.stringify(["background"]),()=>{dispatch!("app","tax",{rootId:"background",callId:JSON.stringify(["background"]),attempt:0,operation:"light",offeredAt:0},()=>{});});
  } });
  r.advanceTo(2100);expect(r.evidence().network.paths.find(p=>p.target==="tax")!.pool.cancelled).toBe(1);
  r.advanceTo(r.horizon);const e=r.evidence(),tax=e.resources.find(r=>r.id==="tax")!;
  expect(e.results[0]!.responseUs).toBe(2100); expect(tax.received).toBe(1); // Background call only.
  expect(e.network.paths.find(p => p.target === "tax")!.remoteOutcomesAfterStop).toBe(0);
  expect(store.measure().events.filter(e=>e.kind==="flow-late-outcome")).toHaveLength(0);
  expect(store.measure().events.filter(e=>e.kind==="flow-branch-terminal" && e.detail.branch==="tax" && e.detail.outcome==="cancelled-after-join")).toHaveLength(1);
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
test("owner rename preserves a real dispatched branch response-timeout and caller-stop tie", () => {
  const outputs = ["a-app","z-app"].map(name => {
    const d=canvasFlow(); d.resources[0]!.id=name;
    d.resources[0]!.applicationFlow!.operations.read!.steps.shift(); // No leading CPU: all branches dispatch at t=0.
    d.connections.forEach(e=>e.sourceId=name);
    const a=contractFromDesign(d, { adapterProfiles: ["failure-cause/1"] });if("refused" in a)throw Error(JSON.stringify(a.refused));
    const contract=a.contract, q=quantities();
    contract.application!.payloads.light=q.q("tie.payload.light",0,"bytes");
    contract.application!.operations.forEach(o=>o.callerTimeout=q.q(`tie.${o.id}.caller`,1000,"us"));
    for(const [id,t] of Object.entries(contract.transports)) {
      t.pool.responseTimeout=q.q(`tie.${id}.response`,1000,"us");t.pool.establish=q.q(`tie.${id}.establish`,0,"us");
      t.links.forEach(l=>l.propagation=q.q(`tie.${id}.${l.id}.propagation`,0,"us"));
      for(const [op,b] of Object.entries(t.bytes)) { b.request=q.q(`tie.${id}.${op}.request`,0,"bytes");b.response=q.q(`tie.${id}.${op}.response`,0,"bytes"); }
    }
    contract.ledger.push(...q.ledger);
    const c=compileProduct(d,contract);if(!c.ok)throw Error(JSON.stringify(c.diagnostics));
    const scheduled: Array<{at:number;priority:number;key:string}> = [];
    const original=EventKernel.prototype.schedule;
    const spy=spyOn(EventKernel.prototype,"schedule").mockImplementation(function(this: EventKernel, at, priority, key, run) {
      scheduled.push({at,priority,key});return original.call(this,at,priority,key,run);
    });
    const rows: import("../src/model2/workload/causal").CausalEvent[]=[];
    try {
      const r=createProductModel2(c.value,undefined,e=>rows.push(e));
      r.advanceTo(999);
      const starts=rows.filter(e=>e.kind==="flow-branch-start");
      expect(starts).toHaveLength(3);expect(starts.map(e=>e.atUs)).toEqual([0,0,0]);
      const delivered=rows.filter(e=>e.kind==="request-delivered" && starts.some(s=>s.work!.callId===e.detail.id));
      expect(delivered).toHaveLength(3);expect(delivered.map(e=>e.atUs)).toEqual([0,0,0]);
      const callerStop=scheduled.find(e=>JSON.parse(e.key)[0]==="caller-stop")!;
      const branchTimers=scheduled.filter(e=>JSON.parse(e.key)[0]==="upstream-timeout" && starts.some(s=>JSON.parse(e.key)[2]===s.work!.callId));
      expect(branchTimers).toHaveLength(3);
      expect(callerStop).toMatchObject({at:1000,priority:1});
      expect(branchTimers.map(e=>({at:e.at,priority:e.priority}))).toEqual(Array.from({length:3},()=>({at:callerStop.at,priority:callerStop.priority})));
      expect(rows.filter(e=>e.kind==="caller-terminal")).toHaveLength(0);
      r.advanceTo(1000);
      const callers=rows.filter(e=>e.kind==="caller-terminal");
      expect(callers).toHaveLength(1);expect(callers[0]!.atUs).toBe(callerStop.at);
      expect(callers[0]!.detail).toEqual({outcome:"deadline-exceeded",responseUs:1000});
      expect(rows.filter(e=>e.kind==="flow-branch-terminal")).toHaveLength(3);
      return {counts:r.evidence().counts,rows:callers.map(e=>e.detail)};
    } finally {spy.mockRestore();}
  });
  expect(outputs[0]).toEqual(outputs[1]);expect(outputs[0]!.counts.deadlineExceeded).toBe(1);
});

test("canvas rejects cycles through load balancer backends and retains health outside the authored flow", () => {
  const d=canvasFlow();d.resources=d.resources.filter(r=>["app","inventory"].includes(r.id));
  d.resources.push({id:"gateway",type:"Load Balancer",x:0,y:0});
  for(const r of d.resources.filter(r=>r.type==="Virtual Machine"))r.applicationFlow={schema:"application-flow/1",operations:{read:{steps:[{id:"call",kind:"call",edge:`${r.id}-gateway`}]}}};
  d.connections=[["app","gateway"],["gateway","inventory"],["inventory","gateway"]].map(([sourceId,targetId])=>({id:`${sourceId}-${targetId}`,sourceId:sourceId!,targetId:targetId!,sourceType:d.resources.find(r=>r.id===sourceId)!.type,targetType:d.resources.find(r=>r.id===targetId)!.type,port:80}));
  const result=contractFromDesign(d);expect("refused" in result).toBe(true);
  if("refused" in result)expect(result.refused.some(r=>r.message.includes("cycle"))).toBe(true);
  const safe=canvasFlow();safe.resources.push({id:"gateway",type:"Load Balancer",x:0,y:0});
  safe.connections=safe.connections.map(e=>e.targetId==="inventory"?{...e,targetId:"gateway",targetType:"Load Balancer"}:e);
  safe.connections.push({id:"gateway-inventory",sourceId:"gateway",targetId:"inventory",sourceType:"Load Balancer",targetType:"Virtual Machine",port:80});
  const a=contractFromDesign(safe);if("refused" in a)throw Error(JSON.stringify(a.refused));
  const c=compileProduct(safe,a.contract);if(!c.ok)throw Error(JSON.stringify(c.diagnostics));
  const r=createProductModel2(c.value);r.advanceTo(1000000);expect(r.evidence().counts.completed).toBe(1);
});
test("maximum eight-way join runs within scaled budgets; excessive amplification is refused explicitly", () => {
  const d=canvasFlow(), group=d.resources[0]!.applicationFlow!.operations.read!.steps[1]!;if(group.kind!=="parallel")throw Error("parallel");
  for(let i=3;i<8;i++) {const id=`service${i}`;d.resources.push({id,type:"Virtual Machine",x:0,y:0});d.connections.push({id:`app-${id}`,sourceId:"app",targetId:id,sourceType:"Virtual Machine",targetType:"Virtual Machine",port:80});group.branches.push({id,kind:"call",edge:`app-${id}`});}
  const a=contractFromDesign(d);if("refused" in a)throw Error(JSON.stringify(a.refused));
  const c=compileProduct(d,a.contract);if(!c.ok)throw Error(JSON.stringify(c.diagnostics));
  expect(c.value.input.limits.maxEvents).toBe(10000000);expect(c.value.input.limits.maxLiveCalls).toBe(1000000);
  const r=createProductModel2(c.value);r.advanceTo(1000000);expect(r.evidence().counts.completed).toBe(1);
  const oversized=structuredClone(a.contract);oversized.limits.maxEvents=10000000;
  const rejected=compileProduct(d,oversized);expect(rejected.ok).toBe(false);if(!rejected.ok)expect(rejected.diagnostics.some(d=>d.message.includes("event budget"))).toBe(true);
});
test("flow evidence retains bounded rows with explicit truncation and no mutable snapshot aliases",()=>{
  const store=applicationFlowEvidence(1,10000),event={atUs:0,kind:"flow-step-start",resource:"app",detail:{step:"cpu"}};
  store.observe(event);store.observe({...event,kind:"flow-step-terminal"});
  const e=store.measure();expect(e.retained).toBe(1);expect(e.omitted).toBe(1);expect(e.totals["flow-step-terminal"]).toBe(1);
  e.events[0]!.detail.step="mutated";expect(store.measure().events[0]!.detail.step).toBe("cpu");
  const bytes=applicationFlowEvidence(10,1);bytes.observe(event);expect(bytes.measure()).toMatchObject({retained:0,omitted:1});
});
test("a failed optional branch remains visible while a viable quorum completes",()=>{
  const clock=new EventKernel(100),callbacks:RemoteCompletion[]=[],outcomes:string[]=[],store=applicationFlowEvidence(100);
  const runner=applicationFlow("app",{rootId:"r",callId:JSON.stringify(["r"]),operation:"read",attempt:0,offeredAt:0},{steps:[{id:"p",kind:"parallel",wait:2,branches:["a","b","c"].map(id=>({id,kind:"call",target:id}))}]},clock,(_target,_work,done)=>{
    callbacks.push(done);if(callbacks.length===1)done("rejected");return {admitted:true,state:()=>"waiting",cancel:()=>"already-finished"};
  },()=>{},o=>outcomes.push(o),store.observe);
  runner.start();clock.advanceTo(0);callbacks[1]!("completed");callbacks[2]!("completed");clock.advanceTo(0);
  expect(outcomes).toEqual(["completed"]);expect(store.measure().events.find(e=>e.kind==="flow-join")!.detail.failed).toBe(1);
  expect(store.measure().events.some(e=>e.kind==="flow-branch-terminal" && e.detail.outcome==="rejected")).toBe(true);
});
