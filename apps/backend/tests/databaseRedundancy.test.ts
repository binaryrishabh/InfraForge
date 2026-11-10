import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import type { captureSnapshot } from "../simulator/snapshot";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { reviewDesignChanges } from "../challenges/designChanges";
import { evaluateDatabaseRedundancy } from "../challenges/databaseRedundancyCriterion";
import { challengeSeed, specHash } from "../challenges/registry";
import { validateChallengeVersions } from "../challenges/validate";
import { preflight } from "../challenges/preflight";
import { recordedScenario, verifiedScenario } from "../challenges/scenario";
import { checkSubmission } from "../browserRuns/submission";
import { buildRunReport, type StoredRun } from "../reports/report";
import { guidedReview } from "../challenges/guidedReview";
import { redundancyFixture } from "./databaseRedundancy.fixture";

const raw = (r: StoredRun) => r.terminalSnapshot as ReturnType<typeof captureSnapshot>;
const metrics = (r: StoredRun) => raw(r).metrics.db!.databaseReplication!;
const result = (r: StoredRun) => buildRunReport(r).challenge!.criteria.find(c => c.id === "redundancy")!;

test("safe redundancy: one policy change fixes fenced return; one delay change leaves catch-up unfinished", () => {
  const {d, designs, rows} = redundancyFixture(), reports = rows.map(r => buildRunReport(r));
  expect(validateInfrastructureName(d.title)).toBeNull();
  const pin = /"restore-safe-redundancy@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!;
  expect(specHash(d)).toBe(pin);
  expect(validateChallengeVersions([d], {[`${d.id}@1`]: pin})).toEqual([]);
  for (const design of designs) expect(preflight(d, design).errors).toEqual([]);
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const [a, b] of [[0,1],[1,2],[0,2]] as const) expect(reviewDesignChanges(inputs[a]!, inputs[b]!)).toMatchObject({classification: "one-change", count: 1,
    differences: {reconfigured: [{id: "db", fields: [{field: "databaseReplication"}]}]}});
  const restored = structuredClone(designs[1]!); delete restored.resources[1]!.databaseReplication!.rejoin;
  expect(restored).toEqual(designs[0]!); // Exactly one real field, not merely one grouped review entry.
  const slowRestored = structuredClone(designs[2]!); slowRestored.resources[1]!.databaseReplication!.replicationDelayMs = 1200;
  expect(slowRestored).toEqual(designs[1]!); // Independent one-field delay experiment.
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  expect(reports.map(r => r.terminal!.health)).toEqual(["healthy", "healthy", "healthy"]);
  expect(rows.map(r => metrics(r).lostOperations)).toEqual([1,1,9]);
  expect(rows.map(r => metrics(r).primaryRole)).toEqual(["fenced","replica","fenced"]);
  expect(rows.map(r => metrics(r).rejoin?.pendingOperations ?? null)).toEqual([null,0,17]);
  expect(rows.map(r => metrics(r).rejoin?.pendingBatches ?? null)).toEqual([null,0,18]);
  expect(rows.map(r => metrics(r).rejoin?.eligible ?? null)).toEqual([null,true,false]);
  expect(metrics(rows[1]!).rejoin).toMatchObject({committedOperations:17,replayedOperations:17,pendingOperations:0,snapshotApplied:true,joinedAtUs:36_400_001});
  for (const [i, report] of reports.entries()) {
    expect(report.challenge!.predictions[0]!.actual).toBe("healthy");
    expect(report.terminal!.traffic!.wholeRun).toMatchObject({throughSecond:64,completed:504,failed:8,deadlineExceeded:0,abandoned:0,inFlight:0});
    const m = metrics(rows[i]!);
    expect(m).toMatchObject({currentWriter:"replica",replicaRole:"writer",writerEpoch:2,replicaEpoch:2,promotionCount:1,pendingReplication:0,replicaCommittedWrites:17});
    expect(Number(m.primaryRole === "writer") + Number(m.replicaRole === "writer")).toBe(1);
    const incident = report.actions[0]!.outcome!.databaseIncident!;
    expect(incident.before).toMatchObject({simulatedSecond:20,overallHealth:"healthy",replication:{currentWriter:"primary",primaryRole:"writer",replicaRole:"replica"}});
    expect(incident.during).toMatchObject({simulatedSecond:21,replication:{currentWriter:"none",primaryProcessState:"unavailable"}});
    expect(incident.after).toMatchObject({simulatedSecond:29,overallHealth:"healthy",replication:{currentWriter:"replica",primaryRole:"fenced",primaryProcessState:"fenced"}});
    const promotion = report.actions[1]!.outcome!.databaseIncident!;
    expect(promotion.after).toMatchObject({simulatedSecond:22,overallHealth:"healthy",replication:{currentWriter:"replica",primaryRole:"fenced",lostOperations:i === 2 ? 9 : 1}});
    expect(m.lostOperations).toBe(promotion.after!.replication!.lostOperations);
    expect(m.regressedKeys).toEqual(promotion.after!.replication!.regressedKeys);
    const saved = {...rows[i]!, runInputs:JSON.parse(JSON.stringify(rows[i]!.runInputs)), terminalSnapshot:JSON.parse(JSON.stringify(rows[i]!.terminalSnapshot)),
      challengeScenario:JSON.parse(JSON.stringify(rows[i]!.challengeScenario)), actions:structuredClone(rows[i]!.actions)};
    expect(buildRunReport(saved).terminal).toEqual(report.terminal);
    expect(buildRunReport(saved).challenge).toEqual(report.challenge);
    for (const a of report.actions) expect(Buffer.byteLength(JSON.stringify(a.outcome,null,1))).toBeLessThan(32768);
  }
  expect(guidedReview(reports[0]!, true, null)!.cues).toContainEqual(expect.objectContaining({id:"requirement:redundancy",kind:"requirement"}));
  expect(result(rows[0]!).detail).toContain("Unknown");
  console.info("redundancy-calibration", JSON.stringify(rows.map(r => ({loss:metrics(r).lostOperations,role:metrics(r).primaryRole,rejoin:metrics(r).rejoin ?? null}))));
});

type Mutate = (r: StoredRun) => void;
const refusals: Array<[string, Mutate]> = [
  ["missing terminal", r => {r.terminalSnapshot=null;}],
  ["checkpoint only", r => {r.simulationState=r.terminalSnapshot;r.terminalSnapshot=null;}],
  ["checkpoint in terminal", r => {raw(r).kind="checkpoint";}],
  ["active flag", r => {r.runtimeActive=true;}],
  ["active status", r => {r.status="running";}],
  ["wrong horizon", r => {raw(r).simulatedSeconds--;}],
  ["stale metrics", r => {raw(r).metricsTopologyRevision++;}],
  ["stale topology", r => {r.topologyRevision++;}],
  ["uncomputed metrics", r => {raw(r).metricsComputedAt=null;}],
  ["missing accepted topology", r => {r.liveTopology=null;}],
  ["changed topology", r => {r.liveTopology=structuredClone(r.liveTopology);(r.liveTopology as {resources:Array<{id:string}>}).resources[0]!.id="other";}],
  ["missing incident action", r => {r.actions=[];}],
  ["missing incident boundary", r => {delete (r.actions![0]!.outcome as {databaseIncident?:unknown}).databaseIncident;}],
  ["missing replication", r => {delete raw(r).metrics.db!.databaseReplication;}],
  ["missing rejoin", r => {delete metrics(r).rejoin;}],
  ["null rejoin", r => {metrics(r).rejoin=null;}],
  ["unknown replication version", r => {Object.assign(metrics(r),{version:2});}],
  ["unknown catch-up version", r => {Object.assign(metrics(r).rejoin!,{version:2});}],
  ["wrong member identity", r => {metrics(r).rejoin!.memberId="other";}],
  ["wrong rejoin epoch", r => {metrics(r).rejoin!.epoch=1;}],
  ["future join", r => {metrics(r).rejoin!.joinedAtUs=65_000_000;}],
  ["join before promotion", r => {metrics(r).rejoin!.joinedAtUs=1;}],
  ["future promotion", r => {metrics(r).promotionAtUs=65_000_000;}],
  ["inconsistent replay accounting", r => {metrics(r).rejoin!.replayedOperations=16;}],
  ["inconsistent writer accounting", r => {metrics(r).replicaCommittedWrites=18;}],
  ["inconsistent batches", r => {metrics(r).rejoin!.pendingBatches=1;}],
  ["inconsistent eligibility", r => {metrics(r).rejoin!.eligible=false;}],
];
for (const field of ["pendingOperations","pendingBatches","committedOperations","replayedOperations","epoch","snapshotRows"] as const) {
  for (const value of [null,-1,1.5,Number.MAX_SAFE_INTEGER+1]) refusals.push([`${field}=${value}`, r => {metrics(r).rejoin![field]=value;}]);
  refusals.push([`${field}=missing`, r => {delete (metrics(r).rejoin as unknown as Record<string,unknown>)[field];}]);
}
for (const field of ["eligible","snapshotApplied","targetAvailable","writerAvailable"] as const) for (const value of [null,"false",undefined]) {
  refusals.push([`${field}=${value}`, r => {Object.assign(metrics(r).rejoin!, {[field]:value});}]);
}
for (const field of ["memberId","sourceMember","state"] as const) for(const value of [null,undefined,"unsupported"]) {
  refusals.push([`${field}=${value}`,r=>{Object.assign(metrics(r).rejoin!,{[field]:value});}]);
}
for (const field of ["currentWriter","primaryRole","replicaRole","primaryProcessState","replicaProcessState","replicaState","writerEpoch","primaryEpoch","replicaEpoch","promotionCount","promotionAtUs","lostOperations"] as const) {
  refusals.push([`${field}=Unknown`, r => {Object.assign(metrics(r), {[field]:null});}]);
}
test.each(refusals)("redundancy refuses %s", (_name, mutate) => {
  const row = structuredClone(redundancyFixture().rows[1]!); mutate(row);
  expect(result(row).status).toBe("not-evaluated");
});

test("redundancy evaluator refuses absent/duplicate database identities and requires a recorded completed rejoin", () => {
  const {d, rows}=redundancyFixture(), report=buildRunReport(rows[1]!), t=report.terminal!, input=readRunInputs(rows[1]!.runInputs);
  const c=d.criteria[2] as Extract<ChallengeCriterion,{kind:"database-redundancy"}>;
  expect(evaluateDatabaseRedundancy(c,input,t,64).met).toBe(true);
  for (const change of [
    (i:typeof input) => {i.resources[1]!.type="Cache";},
    (i:typeof input) => {i.resources.push(structuredClone(i.resources[1]!));},
    (i:typeof input) => {delete i.resources[1]!.databaseReplication;},
  ]) {const copy=structuredClone(input);change(copy);expect(evaluateDatabaseRedundancy(c,copy,t,64).met).toBeUndefined();}
  const duplicate=structuredClone(t);duplicate.resources.push(structuredClone(t.resources[1]!));
  expect(evaluateDatabaseRedundancy(c,input,duplicate,64).met).toBeUndefined();
  const noJoin=structuredClone(t);noJoin.resources.find(r=>r.id==="db")!.databaseReplication!.rejoin!.joinedAtUs=null;
  expect(evaluateDatabaseRedundancy(c,input,noJoin,64).met).toBeUndefined();
  const noCapture=structuredClone(rows[1]!);noCapture.runInputs=null;
  expect(buildRunReport(noCapture).challenge!.status).toBe("unavailable"); // Cannot reconstruct the approved scenario identity.
  const twoWriters=structuredClone(t);twoWriters.resources.find(r=>r.id==="db")!.databaseReplication!.primaryRole="writer";
  expect(evaluateDatabaseRedundancy(c,input,twoWriters,64).met).toBe(false);
  for (const id of ["missing", "app"]) {
    const invalid=structuredClone(d);Object.assign(invalid.criteria[2]!,{resourceId:id});
    expect(validateChallengeVersions([invalid],{[`${d.id}@1`]:specHash(invalid)}).join()).toContain("database-redundancy needs");
  }
});

test("redundancy keeps promotion fixed in the approved window and refuses forged or manual scenario actions",()=>{
  const {d,designs,rows}=redundancyFixture(), input=readRunInputs(rows[1]!.runInputs),plan=recordedScenario(d,input)!;
  expect(plan.steps.map(s=>[s.id,s.atSecond])).toEqual([["fail-primary",20],["learner-promotion",21]]);
  expect(verifiedScenario(JSON.parse(JSON.stringify(plan)),d,input)).toEqual(plan);
  for(const second of [20,22,21.5]){
    const changed=structuredClone(designs[1]!);changed.resources[1]!.databaseRecoveryPlan!.promoteAtSecond=second;
    expect(preflight(d,changed).valid).toBe(false);
  }
  const forged=structuredClone(plan);forged.steps[1]!.atSecond=22;
  expect(()=>verifiedScenario(forged,d,input)).toThrow("does not match");
  expect(()=>checkSubmission({stopAtSecond:64,actions:[{atSecond:21,request:{kind:"intervention",parameters:plan.steps[1]!.request}}]},
    {challenge:true,horizonSeconds:64})).toThrow("takes no actions");
});
