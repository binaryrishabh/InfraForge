import { expect, test } from "bun:test";
import { DEFAULT_CIRCUIT_BREAKER_SETTINGS, type CircuitBreakerSettings } from "@infraforge/domain/resource";
import { retryStudyDesign, runRetryStudy } from "./retryStudy";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { requireKnown } from "../src/reality/quantity";
function prepared(circuitBreaker = DEFAULT_CIRCUIT_BREAKER_SETTINGS) {
  const saved=retryStudyDesign("aggressive"); saved.resources[0]!.circuitBreaker=circuitBreaker;
  const built=contractFromDesign(saved); if("refused" in built) throw Error(JSON.stringify(built.refused));
  const compiled=compileProduct(saved,built.contract); if(!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  return {saved,contract:built.contract,compiled:compiled.value,assumptions:built.assumptions};
}
test("canvas breaker applies only to outgoing LB paths with authored and fixed-v1 provenance",()=>{
  const f=prepared(),paths=f.compiled.input.paths.filter((p)=>p.circuitBreaker);
  expect(paths).toHaveLength(12); expect(paths.every((p)=>p.source === "lb" && p.target.startsWith("app"))).toBe(true);
  expect(f.compiled.input.paths.filter((p)=>p.target === "db").every((p)=>p.circuitBreaker === undefined)).toBe(true);
  const b=paths[0]!.circuitBreaker!;
  expect(requireKnown(b.failureThreshold,"count")).toBe(3); expect(requireKnown(b.cooldown,"us")).toBe(1000000);
  expect(requireKnown(b.maxProbes,"count")).toBe(1); expect(requireKnown(b.successfulProbesToClose,"count")).toBe(1);
  expect(f.contract.ledger.find((r)=>r.id === "lb.circuitBreaker.maxProbes")!.classification).toBe("implementation-policy");
  expect(f.contract.ledger.find((r)=>r.id === "lb.circuitBreaker.cooldownMs")!.classification).toBe("user-input");
  expect(f.compiled.semantic.numericOrigins).toContainEqual(expect.objectContaining({origin:"user-authored",sources:["saved-design:lb.circuitBreaker.enabled"]}));
  const missing=structuredClone(f.contract); delete missing.nodes.lb!.circuitBreaker;
  expect(compileProduct(f.saved,missing).ok).toBe(false);
  expect(f.assumptions.some((r)=>r.id.includes(".circuitBreaker"))).toBe(false);
});
test("direct callers reject breaker ownership, bounds, unknown knobs and circuit-open retry groups",()=>{
  for(const patch of [{failureThreshold:0},{failureThreshold:101},{failureThreshold:1.5},{cooldownMs:0},{cooldownMs:60001},{cooldownMs:NaN},{probeCount:2}]) {
    const saved=retryStudyDesign("bounded"); saved.resources[0]!.circuitBreaker={...DEFAULT_CIRCUIT_BREAKER_SETTINGS,...patch} as CircuitBreakerSettings;
    expect("refused" in contractFromDesign(saved)).toBe(true);
  }
  const saved=retryStudyDesign("bounded"); saved.resources[1]!.circuitBreaker={enabled:false}; expect("refused" in contractFromDesign(saved)).toBe(true);
  const retry=retryStudyDesign("bounded"); Object.assign(retry.resources[0]!.retry!,{retryOn:["circuit-open"]}); expect("refused" in contractFromDesign(retry)).toBe(true);
});
test("real canvas breaker sheds session-refusal overload sooner and exposes the caller availability cost",()=>{
  const off=runRetryStudy("overload","aggressive",1,{circuitBreaker:{...DEFAULT_CIRCUIT_BREAKER_SETTINGS,enabled:false}});
  const on=runRetryStudy("overload","aggressive",1,{circuitBreaker:DEFAULT_CIRCUIT_BREAKER_SETTINGS});
  expect([off.summary.originalRequests,on.summary.originalRequests]).toEqual([8200,8200]);
  expect([off.summary.sessionRefusals,on.summary.sessionRefusals]).toEqual([12515,255]);
  expect([off.summary.databaseAdmitted,on.summary.databaseAdmitted]).toEqual([4302,1236]);
  expect([off.summary.databaseCalls,on.summary.databaseCalls]).toEqual([16817,1491]);
  expect([off.summary.attempts,on.summary.attempts]).toEqual([16793,8454]);
  expect([off.summary.retries,on.summary.retries]).toEqual([8593,254]);
  expect([off.summary.drainAfterLoadFallUs,on.summary.drainAfterLoadFallUs]).toEqual([93330,0]);
  expect([off.summary.caller.completed,on.summary.caller.completed]).toEqual([4290,1224]);
  expect([off.summary.caller.rejected,on.summary.caller.rejected]).toEqual([3910,6976]);
  expect(on.summary.suppressed!["non-retryable"]).toBe(6975);
  const paths=on.evidence.network.paths.filter((p)=>p.circuitBreaker);
  expect(paths).toHaveLength(12); expect(paths.reduce((n,p)=>n+p.circuitBreaker!.rejected.open+p.circuitBreaker!.rejected["half-open"],0)).toBeGreaterThan(6000);
  expect(paths.every((p)=>!p.circuitBreaker!.probeInFlight)).toBe(true); expect(on.summary.databaseLive).toBe(0);
},20000);
import { createProductModel2 } from "../src/model2/product/run";
import { withTimeline } from "../src/model2/product/timeline";
import type { CausalEvent } from "../src/model2/workload/causal";

test("breaker-enabled canvas crash replays complete evidence and linked causal transitions exactly",()=>{
  const f=prepared({enabled:true,failureThreshold:1,cooldownMs:1000});
  const contract=withTimeline(f.contract,[{id:"crash-app",kind:"crash",node:"app0",atUs:100000,durationUs:500000,restartUs:100000}]);
  const c=compileProduct(f.saved,contract); if(!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const run=()=>{const causal:CausalEvent[]=[];const r=createProductModel2(c.value,undefined,(e)=>causal.push(e));r.advanceTo(1000000);return {evidence:r.evidence(),causal};};
  const a=run(); expect(a).toEqual(run()); expect(a.evidence.network.trace.totals["breaker-transition"]).toBeGreaterThan(0);
  const event=a.causal.find((e)=>e.kind === "breaker-transition" && e.detail.root)!;
  const detail=JSON.parse(String(event.detail.detail)) as {caller:string;path:string;callId:string;reason:string};
  expect(detail.caller).toBe("lb"); expect(detail.path).toContain("lb:app0"); expect(detail.callId).toContain("app0");
});
