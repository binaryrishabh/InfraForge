import { expect, test } from "bun:test";
import { canvasDataFlow } from "./applicationFlowData.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { createProductModel2 } from "../src/model2/product/run";
import { quantities } from "./workloadFixture";
import type { ProductContract } from "../src/model2/product/contracts";

function compiled(cache = false, change?: (c: ProductContract) => void) {
  const d = canvasDataFlow(cache), built = contractFromDesign(d);
  if ("refused" in built) throw Error(JSON.stringify(built.refused));
  change?.(built.contract);
  const c = compileProduct(d, built.contract);
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  return c.value;
}
function run(cache = false, change?: (c: ProductContract) => void, until = 2000000) {
  const c = compiled(cache, change), r = createProductModel2(c); r.advanceTo(until); return r.evidence();
}

test("typed DB read/write reach existing plans and writes execute once without flow retries", () => {
  const reads = run();
  expect(reads.data.databases[0]!.logicalReads).toBe(2);
  expect(reads.counts.completed).toBe(2);
  const d = canvasDataFlow(); d.workload.readWriteRatio = 0;
  const built = contractFromDesign(d); if ("refused" in built) throw Error(JSON.stringify(built.refused));
  const c = compileProduct(d, built.contract); if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const r = createProductModel2(c.value); r.advanceTo(2000000); const e = r.evidence();
  expect(e.data.databases[0]!.logicalWrites).toBe(2);
  expect(e.applicationFlow!.events.filter(e => e.kind === "flow-branch-terminal").map(e => e.detail)).toEqual([
    {step:"write-data",branch:"write-data",target:"db",operation:"write",command:"query",outcome:"completed"},
    {step:"write-data",branch:"write-data",target:"db",operation:"write",command:"query",outcome:"completed"},
  ]);
});

test("cache miss reads DB and fills; next hit avoids the DB and replay is identical", () => {
  const c = compiled(true), r = createProductModel2(c); r.advanceTo(2000000); const e = r.evidence();
  expect(e.counts.completed).toBe(2);
  expect(e.data.caches[0]).toMatchObject({hits:1,misses:1,fills:1});
  expect(e.data.databases[0]!.logicalReads).toBe(1);
  expect(e.results[0]!.responseUs).toBeGreaterThan(e.results[1]!.responseUs!);
  expect(e.applicationFlow!.profile).toBe("application-flow/2");
  expect(e.applicationFlow!.events.some(e => e.detail.hit === true && e.detail.target === "cache/aside")).toBe(true);
  const again = createProductModel2(c); again.advanceTo(2000000); expect(again.evidence()).toEqual(e);
});

test("database CPU slowdown is reflected in flow latency, session refusal retains its root cause", () => {
  const baseline = run();
  const slow = run(false, c => {
    const db = c.nodes.db!.resources[0]!.config; if (db.kind !== "relational") throw Error("db");
    const q = quantities(); db.execution.cores = q.q("proof.slow", 0.25, "cores"); c.ledger.push(...q.ledger);
  });
  expect(slow.results[0]!.responseUs! - baseline.results[0]!.responseUs!).toBe(3000);
  const cacheBaseline=run(true),cacheSlow=run(true,c=>{
    const db=c.nodes.db!.resources[0]!.config;if(db.kind!=="relational")throw Error("db");
    const q=quantities();db.execution.cores=q.q("proof.cache-slow",0.25,"cores");c.ledger.push(...q.ledger);
  });
  expect(cacheSlow.results[0]!.responseUs! - cacheBaseline.results[0]!.responseUs!).toBe(3000);
  expect(cacheSlow.data.databases[0]!.logicalReads).toBe(1);
  expect(cacheSlow.data.caches[0]!.hits).toBe(1);
  const e = run(false, c => {
    c.failureCauseProfile = "failure-cause/1";
    c.interventions = [{id:"sessions",atUs:0,request:{interventionId:"session-capacity",revision:1,target:{resourceId:"db"},parameters:{sessions:0,duration:2}}}];
  });
  expect(e.counts.rejected).toBe(2);
  expect(e.applicationFlow!.events.filter(e => e.kind === "flow-branch-terminal").every(e => e.detail.rootReason === "session-limit" && e.detail.rootResource === "db")).toBe(true);
});

test("captured /2 is explicit and /1 cannot acquire data semantics", () => {
  const d = canvasDataFlow();
  expect(currentAdapterProfiles(d.resources)).toEqual(["failure-cause/1","application-flow/2"]);
  expect(contractFromDesign(d,{adapterProfiles:[]})).toHaveProperty("refused");
  expect(contractFromDesign(d,{adapterProfiles:["application-flow/2"]})).toHaveProperty("contract");
  d.resources[0]!.applicationFlow!.schema = "application-flow/1";
  expect(contractFromDesign(d)).toHaveProperty("refused");
});

test("reject unsafe data targets, read writes, parallel data, stale direct writes and extra DBs", () => {
  const mutations: Array<(d: ReturnType<typeof canvasDataFlow>) => void> = [
    d => { const s = d.resources[0]!.applicationFlow!.operations.read!.steps[1]!; if(s.kind === "data") s.edge="missing"; },
    d => { const s = d.resources[0]!.applicationFlow!.operations.read!.steps[1]!; if(s.kind === "data") s.operation="write"; },
    d => { d.resources[0]!.applicationFlow!.operations.read!.steps = [{id:"p",kind:"parallel",wait:"all",branches:[{id:"a",kind:"data",edge:"app-db",operation:"read"},{id:"b",kind:"call",edge:"app-cache"}]}] as never; },
    d => { const s = d.resources[0]!.applicationFlow!.operations.write!.steps[0]!; if(s.kind === "data") s.edge="app-db"; d.connections.push({id:"app-db",sourceId:"app",targetId:"db",sourceType:"Virtual Machine",targetType:"Database",port:5432}); },
    d => { d.connections = d.connections.filter(e=>e.id!=="cache-db"); },
    d => { d.resources.push({id:"db2",type:"Database",x:0,y:0});d.connections.push({...d.connections[0]!,id:"extra",targetId:"db2"}); },
  ];
  for(const mutate of mutations) { const d=canvasDataFlow(true); mutate(d);const b=contractFromDesign(d);expect("refused" in b || !compileProduct(d,b.contract).ok).toBe(true); }
});


test("cache writes use existing DB write and invalidation; subsequent reads fetch the new row", () => {
  const d = canvasDataFlow(true); d.workload.readWriteRatio = 0.5;
  const b = contractFromDesign(d); if ("refused" in b) throw Error(JSON.stringify(b.refused));
  const c = compileProduct(d,b.contract); if(!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const r=createProductModel2(c.value); r.advanceTo(4000000); const e=r.evidence();
  expect(e.counts.completed).toBe(4);
  expect(e.data.databases[0]!.logicalWrites).toBe(2);
  expect(e.data.caches[0]!.invalidations).toBe(2);
  expect(e.data.caches[0]!.fills).toBe(2);
  expect(e.data.databases[0]!.rows[0]!.version).toBe(3);
});

test("write response timeout stays a single transport failure with its original cause", () => {
  const d=canvasDataFlow();d.workload.readWriteRatio=0;
  const b=contractFromDesign(d,{adapterProfiles:["application-flow/2","failure-cause/1"]});if("refused" in b)throw Error(JSON.stringify(b.refused));
  const q=quantities();b.contract.transports.database!.pool.responseTimeout=q.q("proof.write-timeout",500,"us");b.contract.ledger.push(...q.ledger);
  const c=compileProduct(d,b.contract);if(!c.ok)throw Error(JSON.stringify(c.diagnostics));
  const r=createProductModel2(c.value);r.advanceTo(1000000);const e=r.evidence();
  const terminal=e.applicationFlow!.events.filter(e=>e.kind==="flow-branch-terminal");
  expect(terminal).toHaveLength(1);
  expect(terminal[0]!.detail).toMatchObject({operation:"write",outcome:"rejected",rootReason:null,rootResource:null});
  expect(e.network.paths.find(p=>p.target==="db")!).toMatchObject({offered:1,reasons:{"response-timeout":1}});
});

test("parallel service calls cannot hide a downstream cache fill", () => {
  const d=canvasDataFlow(true);
  const source=d.resources[0]!;source.id="service";
  for(const e of d.connections)if(e.sourceId==="app")e.sourceId="service";
  d.resources.unshift({id:"app",type:"Virtual Machine",x:0,y:0,applicationFlow:{schema:"application-flow/2",operations:{read:{steps:[{id:"p",kind:"parallel",wait:"all",branches:[{id:"a",kind:"call",edge:"app-service"},{id:"b",kind:"call",edge:"app-leaf"}]}]}}}});
  d.resources.push({id:"leaf",type:"Virtual Machine",x:0,y:0});
  d.connections.push(...["service","leaf"].map(id=>({id:`app-${id}`,sourceId:"app",targetId:id,sourceType:"Virtual Machine",targetType:"Virtual Machine",port:80})));
  const b=contractFromDesign(d);expect("refused" in b).toBe(true);if("refused" in b)expect(b.refused.some(d=>d.message.includes("mutating data"))).toBe(true);
});


test("cause capture stays observational for failed data calls",()=>{
  const build=(capture:boolean)=>{
    const d=canvasDataFlow(true),b=contractFromDesign(d,{adapterProfiles:capture?["application-flow/2","failure-cause/1"]:["application-flow/2"]});
    if("refused" in b)throw Error(JSON.stringify(b.refused));
    b.contract.interventions=[{id:"sessions",atUs:0,request:{interventionId:"session-capacity",revision:1,target:{resourceId:"db"},parameters:{sessions:0,duration:2}}}];
    const c=compileProduct(d,b.contract);if(!c.ok)throw Error(JSON.stringify(c.diagnostics));
    const r=createProductModel2(c.value);r.advanceTo(2000000);return r.evidence();
  };
  const off=build(false),on=build(true);
  expect(on.counts).toEqual(off.counts);expect(on.results).toEqual(off.results);
  expect(on.data.databases).toEqual(off.data.databases);expect(on.data.caches).toEqual(off.data.caches);
  const strip=(events:NonNullable<typeof on.applicationFlow>["events"])=>events.map(e=>{const {rootReason:_r,rootResource:_s,depth:_d,...detail}=e.detail;return {...e,detail};});
  expect(strip(on.applicationFlow!.events)).toEqual(strip(off.applicationFlow!.events));
  expect(on.applicationFlow!.events.some(e=>e.kind==="flow-branch-terminal"&&e.detail.rootReason==="session-limit"&&e.detail.rootResource==="db")).toBe(true);
});


test("mixed /1 parents cannot place a /2 cache fill in a parallel group; all-/1 keeps its historical policy", () => {
  const make = () => {
    const d = canvasDataFlow(true);
    d.resources[0]!.id = "service";
    for (const edge of d.connections) if (edge.sourceId === "app") edge.sourceId = "service";
    d.resources.unshift({ id: "app", type: "Virtual Machine", x: 0, y: 0, applicationFlow: { schema: "application-flow/1", operations: {
      read: { steps: [{ id: "parallel", kind: "parallel", wait: 1, branches: [
        { id: "service", kind: "call", edge: "app-service" }, { id: "leaf", kind: "call", edge: "app-leaf" },
      ] }] },
    } } });
    d.resources.push({ id: "leaf", type: "Virtual Machine", x: 0, y: 0 });
    d.connections.push(...["service", "leaf"].map(id => ({ id: `app-${id}`, sourceId: "app", targetId: id, sourceType: "Virtual Machine", targetType: "Virtual Machine", port: 80 })));
    return d;
  };
  const legacy = make(); delete legacy.resources.find(r => r.id === "service")!.applicationFlow;
  const built = contractFromDesign(legacy);
  if ("refused" in built) throw Error(JSON.stringify(built.refused));
  const compiled = compileProduct(legacy, built.contract);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  expect(built.contract.applicationFlowProfile).toBe("application-flow/1");
  const runtime = createProductModel2(compiled.value); runtime.advanceTo(2000000);
  expect(runtime.evidence().data.caches[0]!.fills).toBe(1);
  for (const wait of [1, "all"] as const) {
    const mixed = make(), group = mixed.resources[0]!.applicationFlow!.operations.read!.steps[0]!;
    if (group.kind !== "parallel") throw Error("parallel"); group.wait = wait;
    const result = contractFromDesign(mixed);
    expect(result).toHaveProperty("refused");
    if ("refused" in result) expect(result.refused.some(d => d.message.includes("mutating data"))).toBe(true);
  }
});
