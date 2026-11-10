import { expect, test } from "bun:test";
import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import { buildRunReport, type StoredRun } from "../reports/report";
import { validateChallengeVersions } from "../challenges/validate";
import { specHash } from "../challenges/registry";
import { labPolicy, monitoringLabFixture } from "./monitoringLab.fixture";
import type { captureSnapshot } from "../simulator/snapshot";
import { readRunInputs } from "../deployments/runInputs";
import { evaluateMonitoringDelivery } from "../challenges/monitoringCriterion";

const snapshot = (r: StoredRun) => r.terminalSnapshot as ReturnType<typeof captureSnapshot>;
const monitor = (r: StoredRun) => snapshot(r).metrics.monitor!;
const backend = (r: StoredRun) => monitor(r).monitoringBackend!;
const result = (r: StoredRun) => buildRunReport(r).challenge!.criteria.find(c => c.id === "delivery")!;
type Mutate = (r: StoredRun) => void;
const refusals: Array<[string, Mutate]> = [
  ["missing terminal", r => {r.terminalSnapshot=null;}],
  ["checkpoint only", r => {r.simulationState=r.terminalSnapshot;r.terminalSnapshot=null;}],
  ["checkpoint in terminal field", r => {snapshot(r).kind="checkpoint";}],
  ["active flag with terminal", r => {r.runtimeActive=true;}],
  ["active status with terminal", r => {r.status="running";}],
  ["wrong horizon", r => {snapshot(r).simulatedSeconds--;}],
  ["stale metrics revision", r => {snapshot(r).metricsTopologyRevision++;}],
  ["stale terminal revision", r => {r.topologyRevision++;}],
  ["initialized metrics", r => {snapshot(r).metricsComputedAt=null;}],
  ["missing capture", r => {r.runInputs=null;}],
  ["missing accepted topology", r => {r.liveTopology=null;}],
  ["changed live topology", r => {(r.liveTopology as {resources:Array<{id:string}>}).resources[0]!.id="replacement";}],
  ["changed live policy", r => {r.liveTopology=structuredClone(r.liveTopology);labPolicy(r.liveTopology as ReturnType<typeof readRunInputs>).batchSamples=1;}],
  ["missing collector", r => {delete monitor(r).monitoring;}],
  ["missing backend", r => {delete monitor(r).monitoringBackend;}],
  ["unknown collector version", r => {Object.assign(monitor(r).monitoring!,{version:99});}],
  ["unknown backend version", r => {Object.assign(backend(r),{version:99});}],
  ["wrong backend identity", r => {backend(r).id="another/backend";}],
  ["wrong monitor identity", r => {snapshot(r).metrics.replacement=monitor(r);delete snapshot(r).metrics.monitor;}],
  ["missing target measurement", r => {delete snapshot(r).metrics.db;}],
  ["wrong backend target", r => {backend(r).latest![0]!.target="replacement";}],
  ["missing backend target", r => {backend(r).latest!.pop();}],
  ["duplicate backend target", r => {backend(r).latest![1]!.target=backend(r).latest![0]!.target;}],
  ["extra backend target", r => {backend(r).latest!.push({...backend(r).latest![0]!,target:"extra"});}],
  ["missing collector target", r => {monitor(r).monitoring!.freshness!.pop();}],
  ["wrong collector target", r => {monitor(r).monitoring!.freshness![0]!.target="replacement";}],
  ["missing backend latest", r => {backend(r).latest=null;}],
  ["missing collector freshness", r => {monitor(r).monitoring!.freshness=null;}],
  ["inconsistent age", r => {backend(r).latest![0]!.ageUs!++;}],
  ["future arrival", r => {backend(r).latest![0]!.arrivedAt=91_000_000;}],
  ["arrival precedes measurement", r => {backend(r).latest![0]!.arrivedAt=1;}],
  ["drops exceed generated", r => {monitor(r).monitoring!.droppedBeforeExport=179;}],
  ["duplicates exceed received", r => {backend(r).duplicates=169;}],
  ["unique arrivals exceed available generated samples", r => {backend(r).received=179;}],
];
for (const field of ["generated","droppedBeforeExport"] as const) for (const value of [null,-1,1.5,Number.MAX_SAFE_INTEGER+1]) {
  refusals.push([`${field}=${value}`, r => {monitor(r).monitoring![field]=value;}]);
}
for (const field of ["received","duplicates"] as const) for (const value of [null,-1,1.5,Number.MAX_SAFE_INTEGER+1]) {
  refusals.push([`${field}=${value}`, r => {backend(r)[field]=value;}]);
}
for (const field of ["measurementAt","arrivedAt","ageUs"] as const) for (const value of [null,-1,1.5,Number.MAX_SAFE_INTEGER+1]) {
  refusals.push([`${field}=${value}`, r => {backend(r).latest![0]![field]=value;}]);
}
test.each(refusals)("monitoring delivery refuses %s", (_name, mutate) => {
  const r=structuredClone(monitoringLabFixture().rows[1]!); mutate(r);
  expect(result(r).status).toBe("not-evaluated");
});

test("monitoring evaluator refuses ambiguous captured topology and duplicated report identities", () => {
  const {d,rows}=monitoringLabFixture(),row=rows[1]!,t=buildRunReport(row).terminal!,c=d.criteria[1] as Extract<ChallengeCriterion,{kind:"monitoring-delivery"}>;
  const input=readRunInputs(row.runInputs);
  expect(evaluateMonitoringDelivery(c,input,t,90,false).met).toBe(true);
  for(const mutate of [
    (i:typeof input)=>{i.resources.find(r=>r.id==="monitor")!.type="Cache";},
    (i:typeof input)=>{i.resources.push({...i.resources.find(r=>r.id==="monitor")!});},
    (i:typeof input)=>{i.resources.find(r=>r.id==="db")!.id="replacement";},
    (i:typeof input)=>{i.connectionLines=i.connectionLines.filter(l=>!(l.sourceId==="monitor" && l.targetId==="db"));},
    (i:typeof input)=>{i.connectionLines.push({...i.connectionLines.find(l=>l.sourceId==="monitor")!,id:"duplicate"});},
  ]) {const bad=structuredClone(input);mutate(bad);expect(evaluateMonitoringDelivery(c,bad,t,90,false).met).toBeUndefined();}
  for(const id of ["monitor","vm","db"]) {const bad=structuredClone(t);bad.resources.push({...bad.resources.find(r=>r.id===id)!});expect(evaluateMonitoringDelivery(c,input,bad,90,false).met).toBeUndefined();}
});

test("monitoring criterion succeeds only with all five recorded bounds; collector age cannot replace backend age", () => {
  const row=monitoringLabFixture().rows[1]!;
  expect(result(row).status).toBe("met");
  const failures: Mutate[] = [r => {monitor(r).monitoring!.generated=169;},r => {backend(r).received=127;},
    r => {backend(r).duplicates=1;},r => {monitor(r).monitoring!.droppedBeforeExport=1;},
    r => {const target=backend(r).latest![0]!;target.measurementAt=79_000_000;target.ageUs=11_000_000;}];
  for(const mutate of failures) {const r=structuredClone(row);mutate(r);expect(result(r).status).toBe("not-met");}
  const missingAge=structuredClone(row);backend(missingAge).latest![0]!.ageUs=null;
  expect(monitor(missingAge).monitoring!.freshness!.every(r => r.state === "fresh")).toBe(true);
  expect(result(missingAge).status).toBe("not-evaluated");
});

test("monitoring authoring rejects unsafe bounds and missing or duplicate identities", () => {
  const {d}=monitoringLabFixture();
  type C = Extract<ChallengeCriterion,{kind:"monitoring-delivery"}>;
  const edits: Array<(c:C)=>void>=[c=>{c.resourceId="missing";},c=>{c.backendId="";},c=>{c.targetIds=[];},c=>{c.targetIds=["vm","vm"];},c=>{c.targetIds=["missing"];},
    c=>{c.minGenerated=0;},c=>{c.minReceived=Number.MAX_SAFE_INTEGER+1;},c=>{c.maxBackendAgeUs=-1;}];
  for(const edit of edits) {const bad=structuredClone(d);edit(bad.criteria[1] as C);expect(validateChallengeVersions([bad],{[`${bad.id}@1`]:specHash(bad)}).join(" ")).toContain("monitoring-delivery needs");}
  const legacy=structuredClone(d);delete legacy.engine;
  expect(validateChallengeVersions([legacy],{[`${legacy.id}@1`]:specHash(legacy)}).join(" ")).toContain("monitoring-delivery needs");
});
