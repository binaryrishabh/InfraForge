import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { securitySettingsError } from "@infraforge/domain/resource";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { securityDesign, prepareSecurity } from "./securityCanvas.fixture";
import pins from "./securityCanvas.pins.json";
import { createLiveModel2 } from "../src/model2/product/live";
import type { CausalEvent } from "../src/model2/workload/causal";
import { quantities } from "./workloadFixture";
import { expandFirewallRules } from "../src/model2/product/security";

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v).replaceAll("\r\n", "\n")).digest("hex");
test("absent security preserves pre-edit LF-normalized contract, compiled and evidence SHA-256 pins", () => {
  const designs = [securityDesign({app:"Virtual Machine"}, []), securityDesign({app:"Virtual Machine",db:"Database"}, [["app","db"]]), securityDesign()];
  for (const [i,d] of designs.entries()) {
    const p = prepareSecurity(d), r = createProductModel2(p.compiled); r.advanceTo(1000000);
    expect({contract:hash(p.contract), compiled:hash(p.compiled), evidence:hash(r.evidence())}).toEqual(pins[i]!);
  }
});
for (const ports of [[], [5433]]) test(`explicit listener ${JSON.stringify(ports)} permits a deliberate runtime no-listener`, () => {
  const d = securityDesign(); d.resources.find(r => r.id === "db")!.listenerSettings = { version: 1, ports };
  const p = prepareSecurity(d), runtime = createProductModel2(p.compiled); runtime.advanceTo(1000000);
  const e = runtime.evidence();
  expect(e.systems.security.events.rows.some(r => r.kind === "connection-denied" && r.detail === "no-listener")).toBe(true);
  expect(e.data.databases[0]!.transactions.committed).toBe(0);
  expect(e.counts.completed).toBe(0);
  const forged = structuredClone(p.contract); forged.nodes.db!.listeners = [];
  if (ports.length) expect(compileProduct(d, forged).ok).toBe(false);
});
test("invalid versions, ownership, duplicate ports/rules, scopes and ranges are refused", () => {
  for (const [type,l,f] of [
    ["Database", {version:2,ports:[]}, undefined], ["Database", {version:1,ports:[0]}, undefined],
    ["Database", {version:1,ports:[5432,5432]}, undefined], ["Firewall", {version:1,ports:[]}, undefined],
    ["Database", undefined, {version:1,default:"deny",rules:[]}], ["Firewall", undefined, {version:2,default:"deny",rules:[]}],
  ] as const) expect(securitySettingsError(type,l,f)).toBeDefined();
  const d = securityDesign(); Object.assign(d.resources.find(r => r.id === "db")!, {listenerSettings:{version:2,ports:[]}});
  expect("refused" in contractFromDesign(d)).toBe(true);
  const valid = securityDesign(), p = prepareSecurity(valid); valid.resources.find(r=>r.id === "db")!.listenerSettings = {version:1,ports:[]};
  expect(compileProduct(valid,p.contract).ok).toBe(false);
  const incomplete = prepareSecurity(securityDesign()); incomplete.contract.nodes.db!.listeners = [];
  expect(compileProduct(securityDesign(), incomplete.contract).ok).toBe(false);
});

function rule(id: string, priority: number, action: "allow" | "deny", direction: "ingress" | "egress" = "ingress") {
  return {id,priority,action,direction,source:"app",destination:"db",fromPort:5432,toPort:5432};
}
test("firewall priority then ID, both directions and default deny use real admission decisions", () => {
  for (const rules of [[rule("z",1,"allow"),rule("a",0,"deny")], [rule("z",0,"allow"),rule("a",0,"deny")], []]) {
    const d = securityDesign(); d.resources.find(r=>r.id === "firewall")!.firewallSettings = {version:1,default:rules.length ? "allow" : "deny",rules};
    const p = prepareSecurity(d), events: CausalEvent[] = [], runtime = createProductModel2(p.compiled, undefined, e=>events.push(e)); runtime.advanceTo(1000000);
    const e = runtime.evidence(), denial = e.systems.security.admission!.rows.find(r=>!r.allowed)!;
    expect(denial).toMatchObject({path:"edge-1:app:db",source:"app",target:"db",port:5432,firewall:"firewall",generation:1, ...(rules.length ? {rule:"a",direction:"ingress"} : {defaultAction:"deny",direction:"egress"})});
    expect(e.data.databases[0]!.transactions.committed).toBe(0);
    const acquire = events.find(e=>e.kind === "connection-acquire-failed" && e.detail.detail === denial.connectionId)!;
    expect(acquire.detail.root).toBeDefined(); expect(acquire.detail.attempt).toBeDefined();
    expect(events.some(e=>e.kind === "security-denied" && e.detail.id === denial.connectionId)).toBe(true);
  }
});
test("live security counters show zero delivery and Firewall remains Unknown without a station", () => {
  const d = securityDesign(); d.resources.find(r=>r.id === "db")!.listenerSettings = {version:1,ports:[]};
  const p = prepareSecurity(d), live = createLiveModel2(p.compiled,d.resources.map(r=>r.id)); live.advanceSecond();
  const m = live.project().metrics;
  const edge = m.db!.security!.edges.find(e=>e.target === "db")!;
  expect(edge.noListener).toBeGreaterThan(0); expect(edge.backendDeliveries).toBe(0); expect(m.db!.health).toBe("failed");
  expect(m.firewall!.health).toBe("unknown"); expect(m.firewall!.security!.firewall!.occupancy).toBe(0); expect(m.firewall!.security!.firewall!.limit).toBe(10000);
});

test("default deny permits only when both directions match allow rules", () => {
  for (const both of [false,true]) {
    const d=securityDesign();d.resources.find(r=>r.id === "firewall")!.firewallSettings={version:1,default:"deny",rules:[rule("in",0,"allow"),...(both ? [rule("out",0,"allow","egress")] : [])]};
    const p=prepareSecurity(d),r=createProductModel2(p.compiled);r.advanceTo(1000000);
    expect(r.evidence().counts.completed).toBe(both ? 10 : 0);
    if(both) expect(r.evidence().systems.security.edges!.find(e=>e.target === "db")!.backendDeliveries).toBeGreaterThan(0);
  }
});

test("a rule named default stays distinguishable from the default action",()=>{
  const d=securityDesign();d.resources.find(r=>r.id === "firewall")!.firewallSettings={version:1,default:"allow",rules:[rule("default",0,"deny")]};
  const p=prepareSecurity(d),r=createProductModel2(p.compiled);r.advanceTo(1000000);
  const denied=r.evidence().systems.security.admission!.rows.find(r=>!r.allowed)!;
  expect(denied.rule).toBe("default");expect(denied.defaultAction).toBeUndefined();
});

test("invalid firewall input is refused by domain, adapter and direct compiler",()=>{
  const d=securityDesign(),p=prepareSecurity(d),good=rule("block",0,"deny");
  for(const rules of [[good,good],[{...good,priority:-1}],[{...good,direction:"both"}],[{...good,source:"missing"}],[{...good,destination:"firewall"}],[{...good,source:{kind:"any"}}],[{...good,fromPort:0}],[{...good,fromPort:6000,toPort:5000}],[{...good,action:"drop"}],[{...good,id:""}],[{...good,extra:true}],Array.from({length:33},(_,i)=>({...good,id:`rule-${i}`}))]){
    const settings={version:1,default:"deny",rules};
    expect(securitySettingsError("Firewall",undefined,settings,d.resources)).toBeDefined();
    const invalid=structuredClone(d);Object.assign(invalid.resources.find(r=>r.id === "firewall")!,{firewallSettings:settings});
    expect("refused" in contractFromDesign(invalid)).toBe(true);expect(compileProduct(invalid,p.contract).ok).toBe(false);
  }
});

test("resource scopes expand through every replica/helper with original rule tie ordering", () => {
  const q=quantities(), rules=["a","a_"].map((id,i)=>({...rule(id,0,i === 0 ? "deny" : "allow"),protocol:"tcp" as const,source:{kind:"identity" as const,value:"$app"},destination:{kind:"identity" as const,value:"$db"},priority:q.q(`${id}.priority`,0,"count"),fromPort:q.q(`${id}.from`,5432,"count"),toPort:q.q(`${id}.to`,5432,"count")}));
  const expanded=expandFirewallRules(rules,new Map([["app#0/main","app#0"],["app#1/main","app#1"],["app#1/aside","app#1/aside"],["db/main","db"]]));
  expect(expanded).toHaveLength(6);expect(new Set(expanded.map(r=>r.id)).size).toBe(6);
  expect(expanded.map(r=>r.source.value)).toEqual(["app#0","app#1","app#1/aside","app#0","app#1","app#1/aside"]);
  expect([...expanded].sort((a,b)=>a.id < b.id ? -1 : 1).slice(0,3).every(r=>r.authoredId === "a")).toBe(true);
});

test("canvas-compiled sessions survive policy change while fresh flows fail at generation two", () => {
  const run = (reuse: boolean) => {
    const d = securityDesign(); d.resources.find(r=>r.id === "firewall")!.firewallSettings = {version:1,default:"allow",rules:[]};
    const p = prepareSecurity(d), input = p.compiled.input, q = quantities();
    const path = input.paths.find(p=>p.source === "app" && p.target === "db")!;
    path.pool = {...path.pool,reuse};
    input.systems.interventions.push({id:"test-policy-update",kind:"firewall-rules",target:"firewall",at:q.q("test.security.at",50000,"us"),rules:[{...rule("block-new",0,"deny"),protocol:"tcp",source:{kind:"any"},destination:{kind:"identity",value:"db"},priority:q.q("test.security.priority",0,"count"),fromPort:q.q("test.security.from",5432,"count"),toPort:q.q("test.security.to",5432,"count")}]});
    input.ledger.push(...q.ledger);
    const r = createProductModel2(p.compiled); r.advanceTo(1000000); return r.evidence();
  };
  const reused = run(true), fresh = run(false);
  expect(reused.counts.completed).toBe(10); expect(fresh.counts.completed).toBe(1);
  expect(reused.systems.security.policies[0]!.returnExchanges).toBeGreaterThan(1);
  expect(fresh.systems.security.admission!.rows.filter(r=>!r.allowed).every(r=>r.generation === 2 && r.rule === "block-new")).toBe(true);
  expect(fresh.systems.security.policies[0]!.flows).toHaveLength(0);
});

test("security evidence has row and byte bounds; omitted details project Unknown", () => {
  for (const bytes of [undefined,1]) {
    const d = securityDesign(); d.resources.find(r=>r.id === "db")!.listenerSettings={version:1,ports:[]};
    const p = prepareSecurity(d); p.contract.arrival.generated=true; p.contract.limits={...p.contract.limits,maxTraceRows:1,...(bytes ? {maxTraceBytes:bytes} : {})};
    const compiled=compileProduct(d,p.contract); if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const causal:CausalEvent[]=[], r=createProductModel2(compiled.value,undefined,e=>causal.push(e));r.advanceTo(1000000);
    const e=r.evidence(); expect(e.systems.security.admission!.rows.length).toBeLessThanOrEqual(bytes ? 0 : 1); expect(e.systems.security.admission!.omitted).toBeGreaterThan(0);
    expect(causal.filter(e=>e.kind === "security-denied" || e.kind === "security-admitted").length).toBeLessThanOrEqual(1);
    const live=createLiveModel2(compiled.value,d.resources.map(r=>r.id));live.advanceSecond();const metrics=live.project().metrics, m=metrics.db!;
    const exact=e.systems.security.edges!.filter(edge=>edge.target === "db" || edge.source === "db");
    expect(m.security!.edges).toEqual(exact.map(edge=>({...edge,lastDenial:undefined})));
    expect(m.security!.evidence).toBe("omitted");expect(m.security!.omitted).toBe(e.systems.security.admission!.omitted);
    expect(m.security!.edges.some(edge=>(edge.denied ?? 0)>0)).toBe(true);
    expect(m.health).toBe("failed");expect(metrics.app!.health).not.toBe("unknown");
    expect(metrics.lb!.health).not.toBe("unknown");expect(metrics.firewall!.health).toBe("unknown");
  }
});

for (const deny of [false,true]) test(`real request, LB, app, DB admission failure, attempt failure and retry chain; rule=${deny}`, () => {
  const d=securityDesign(); d.resources.find(r=>r.id === "lb")!.retry={enabled:true,maxAttempts:2,backoffMs:10,jitterRatio:0,maxConcurrentRetries:4,retryOn:["backendFailure"]};
  if (deny) d.resources.find(r=>r.id === "firewall")!.firewallSettings={version:1,default:"allow",rules:[rule("block-db",0,"deny")]};
  else d.resources.find(r=>r.id === "db")!.listenerSettings={version:1,ports:[]};
  const p=prepareSecurity(d), events:CausalEvent[]=[], r=createProductModel2(p.compiled,undefined,e=>events.push(e));r.advanceTo(1000000);
  const acquisition=events.find(e=>e.kind === "connection-acquire-failed" && String(e.detail.root).startsWith('["root"'))!;
  const denied=events.find(e=>e.kind === "security-denied" && e.detail.id === acquisition.detail.detail)!, detail=JSON.parse(denied.detail.detail as string);
  const root=acquisition.detail.root, related=events.filter(e=>(e.work?.rootId ?? e.detail.root) === root);
  for(const kind of ["caller-offered","lb-selected","request-delivered","connection-acquire-failed","attempt-terminal","retry-scheduled","caller-terminal"]) expect(related.some(e=>e.kind === kind)).toBe(true);
  expect(detail.reason).toBe(deny ? "policy-denied:firewall:ingress:block-db" : "no-listener");
  const terminal=related.find(e=>e.kind === "attempt-terminal")!;expect(terminal.detail.detail).toBe("backend-rejected");
  expect(related.find(e=>e.kind === "retry-scheduled")!.atUs).toBeGreaterThanOrEqual(denied.atUs);
  expect(r.evidence().data.databases[0]!.transactions.committed).toBe(0);
  const again=createProductModel2(p.compiled);again.advanceTo(1000000);expect(hash(again.evidence())).toBe(hash(r.evidence()));
});


test("target health uses this window's denials and deliveries across every incoming edge",()=>{
  for(const fullyDenied of [false,true]){
    const d=securityDesign({lb:"Load Balancer",app1:"Virtual Machine",app2:"Virtual Machine",db:"Database",firewall:"Firewall"},[["lb","app1"],["lb","app2"],["app1","db"],["app2","db"],["firewall","db"]]);
    d.resources.find(r=>r.id === "firewall")!.firewallSettings={version:1,default:"allow",rules:[{...rule("deny",0,"deny"),source:fullyDenied ? "any" : "app2"}]};
    const p=prepareSecurity(d);
    for(const source of p.compiled.input.arrivals){
      if(source.kind !== "trace")throw Error("Expected explicit test arrivals");
      source.trace.rows=source.trace.rows.filter(row=>row.atUs < 500000);
    }
    const live=createLiveModel2(p.compiled,d.resources.map(r=>r.id));
    live.advanceSecond();const active=live.project().metrics.db!;
    expect(active.security!.edges.reduce((n,e)=>n+e.denied!,0)).toBeGreaterThan(0);
    expect(active.security!.edges.reduce((n,e)=>n+e.backendDeliveries!,0)>0).toBe(!fullyDenied);
    expect(active.health === "failed").toBe(fullyDenied);
    live.advanceSecond();const idle=live.project();
    expect(idle.offeredRps).toBe(0);expect(idle.metrics.db!.rps).toBe(0);
    expect(idle.metrics.db!.health).toBe("healthy");
    expect(live.project().metrics.db!.health).toBe("healthy");
  }
});


test("expanded firewall rules stop at the named 2000-rule admission budget",()=>{
  const q=quantities();
  const rules=Array.from({length:32},(_,i)=>({...rule(`rule-${i}`,i,"deny"),protocol:"tcp" as const,source:{kind:"identity" as const,value:"$app"},destination:{kind:"any" as const},priority:q.q(`budget.${i}.priority`,i,"count"),fromPort:q.q(`budget.${i}.from`,1,"count"),toPort:q.q(`budget.${i}.to`,65535,"count")}));
  const ids=new Map(Array.from({length:128},(_,i)=>[`app#${i}/main`,`app#${i}`]));
  expect(expandFirewallRules(rules.slice(0,16),new Map([...ids].slice(0,125)))).toHaveLength(2000);
  expect(()=>expandFirewallRules(rules,ids)).toThrow("Expanded firewall exceeds 2000 runtime rules");
});
