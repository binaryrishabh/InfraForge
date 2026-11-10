import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { readRunInputs } from "../deployments/runInputs";
import { reviewDesignChanges } from "../challenges/designChanges";
import { preflight } from "../challenges/preflight";
import { specHash } from "../challenges/registry";
import { validateChallengeVersions } from "../challenges/validate";
import { improvementSource } from "../challenges/improvements";
import { captureSnapshot } from "../simulator/snapshot";
import { guidedReview } from "../challenges/guidedReview";
import { classifyComparison } from "../comparison/classify";
import { buildRunReport } from "../reports/report";
import { checkLearningAuthoring } from "../learning/authoring";
import { learningContent } from "../learning/content";
import { LEARNING_REGISTRY } from "../learning/registry";
import { gatewayQuotaLabFixture } from "./gatewayQuotaLab.fixture";

test("quota lab proves one scope fix, ineffective backend CPU and retained route evidence",()=>{
  const {d,designs,rows}=gatewayQuotaLabFixture(),reports=rows.map(r=>buildRunReport(r));
  const pin=/"isolate-route-credits@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts",import.meta.url),"utf8"))![1]!;
  expect(specHash(d)).toBe(pin);expect(validateChallengeVersions([d],{[`${d.id}@1`]:pin})).toEqual([]);
  expect(validateInfrastructureName(d.title)).toBeNull();
  const inputs=rows.map(r=>readRunInputs(r.runInputs));
  for(const design of designs)expect(preflight(d,design).errors).toEqual([]);
  for(const i of [1,2]) {
    expect(reviewDesignChanges(inputs[0]!,inputs[i]!)).toMatchObject({classification:"one-change",count:1});
    const a={...rows[0]!,createdAt:new Date(0)},b={...rows[i]!,createdAt:new Date(1),improvementSourceId:a.id};
    expect(classifyComparison(a,b)).toMatchObject({available:true,starting:{grade:"one-change-design"},designChangeReview:{count:1},lineage:"source-and-improvement"});
    expect(inputs[i]!.adapterProfiles).toEqual(inputs[0]!.adapterProfiles);
  }
  const restored=structuredClone(designs[1]!);restored.resources[0]!.gatewayQuota!.scope="shared";expect(restored).toEqual(designs[0]!);
  const nearRestored=structuredClone(designs[2]!);nearRestored.resources[2]!.size="small";expect(nearRestored).toEqual(designs[0]!);
  expect(reports.map(r=>r.challenge!.status)).toEqual(["not-met","met","not-met"]);
  expect(reports.map(r=>r.challenge!.predictions[0]!.actual)).toEqual(["critical","critical","critical"]);
  const measurements=reports.map(r=>r.terminal!.resources.find(m=>m.id==="gateway")!);
  const gateways=measurements.map(m=>m.gateway!);
  expect(gateways.map(g=>g.routes.map(r=>[r.outcomes!.completed,r.rejected]))).toEqual([[[60,479],[1,60]],[[61,478],[61,0]],[[60,479],[1,60]]]);
  expect(gateways[2]).toEqual(gateways[0]);
  expect(measurements.map(m=>m.cpu)).toEqual([0.1,0.2,0.1]);
  expect(reports.map(r=>[r.terminal!.traffic!.wholeRun!.completed,r.terminal!.traffic!.wholeRun!.failed])).toEqual([[61,539],[122,478],[61,539]]);
  for(const [i,r] of reports.entries()) {
    const row=rows[i]!,saved={...row,runInputs:JSON.parse(JSON.stringify(row.runInputs)),terminalSnapshot:JSON.parse(JSON.stringify(row.terminalSnapshot))};
    expect(buildRunReport(saved).terminal).toEqual(r.terminal);expect(buildRunReport(saved).challenge).toEqual(r.challenge);
    expect(inputs[i]!).toEqual(improvementSource(row,d.id).input);
  }
  expect(guidedReview(reports[0]!,true,null)!.cues).toContainEqual(expect.objectContaining({id:"requirement:writes",kind:"requirement"}));
  console.info("gateway-quota-calibration",JSON.stringify(gateways.map(g=>({scope:g.quota!.scope,received:g.received,completed:g.completed,throttled:g.throttled,routes:g.routes.map(r=>({id:r.id,completed:r.outcomes!.completed,refused:r.rejected}))}))));
});

test("quota lesson belongs to its own module with reviewed identity and honest limitations",()=>{
  expect(()=>checkLearningAuthoring(learningContent)).not.toThrow();
  const lesson=LEARNING_REGISTRY.findLesson("isolate-route-credits")!;
  expect(lesson).toMatchObject({kind:"executable-lab",moduleId:"quota-ownership",experiment:{challengeId:"isolate-route-credits"}});
  expect(lesson.limitations.join(" ")).toContain("aggregate");
  expect(lesson.limitations.join(" ")).toContain("deterministic InfraForge");
});

test("quota criteria refuse absent, stale, contradictory and mismatched captured observations",()=>{
  const {d,rows}=gatewayQuotaLabFixture();
  const snapshot=(r:typeof rows[number])=>r.terminalSnapshot as ReturnType<typeof captureSnapshot>;
  const gateway=(r:typeof rows[number])=>snapshot(r).metrics.gateway!.gateway!;
  for(const mutate of [(r:typeof rows[number])=>{r.terminalSnapshot=null;},
    (r:typeof rows[number])=>{snapshot(r).simulatedSeconds--;},
    (r:typeof rows[number])=>{snapshot(r).metricsTopologyRevision++;},
    (r:typeof rows[number])=>{delete snapshot(r).metrics.gateway!.gateway;},
    (r:typeof rows[number])=>{delete gateway(r).quota;},
    (r:typeof rows[number])=>{gateway(r).quota!.scope="shared";},
    (r:typeof rows[number])=>{delete gateway(r).routes[1]!.outcomes;},
    (r:typeof rows[number])=>{gateway(r).routes[1]!.outcomes!.completed=-1;},
    (r:typeof rows[number])=>{gateway(r).routes[1]!.target="readApp";},
    (r:typeof rows[number])=>{gateway(r).routes[1]!.rejected++;}]) {
    const row=structuredClone(rows[1]!);mutate(row);
    expect(buildRunReport(row).challenge!.criteria.find(c=>c.id==="writes")!.status).toBe("not-evaluated");
  }
  const wrongHash=structuredClone(rows[1]!);wrongHash.challengeSpecHash="0".repeat(64);
  expect(buildRunReport(wrongHash).challenge!.status).toBe("unavailable");
  const invalid=structuredClone(rows[0]!);invalid.challengeSpecHash="0".repeat(64);
  expect(()=>improvementSource(invalid,d.id)).toThrow();
});
