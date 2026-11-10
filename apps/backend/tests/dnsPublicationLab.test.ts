import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { reviewDesignChanges } from "../challenges/designChanges";
import { preflight } from "../challenges/preflight";
import { specHash } from "../challenges/registry";
import { validateChallengeVersions } from "../challenges/validate";
import { recordedScenario, verifiedScenario } from "../challenges/scenario";
import { improvementSource } from "../challenges/improvements";
import { captureSnapshot } from "../simulator/snapshot";
import { guidedReview } from "../challenges/guidedReview";
import { classifyComparison } from "../comparison/classify";
import { buildRunReport } from "../reports/report";
import { checkLearningAuthoring } from "../learning/authoring";
import { learningContent } from "../learning/content";
import { LEARNING_REGISTRY } from "../learning/registry";
import { dnsPublicationLabFixture } from "./dnsPublicationLab.fixture";

test("DNS lab has one real TTL fix, one ineffective CPU change and consistent saved evidence", () => {
  const {d,designs,rows}=dnsPublicationLabFixture(), reports=rows.map(r=>buildRunReport(r));
  const pin=/"resolve-after-publication@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts",import.meta.url),"utf8"))![1]!;
  expect(specHash(d)).toBe(pin);expect(validateChallengeVersions([d],{[`${d.id}@1`]:pin})).toEqual([]);
  expect(validateInfrastructureName(d.title)).toBeNull();
  const inputs=rows.map(r=>readRunInputs(r.runInputs));
  for(const design of designs)expect(preflight(d,design).errors).toEqual([]);
  for(const i of [1,2]) {
    expect(reviewDesignChanges(inputs[0]!,inputs[i]!)).toMatchObject({classification:"one-change",count:1});
    const a={...rows[0]!,createdAt:new Date(0)},b={...rows[i]!,createdAt:new Date(1),improvementSourceId:a.id};
    expect(classifyComparison(a,b)).toMatchObject({available:true,starting:{grade:"one-change-design"},designChangeReview:{count:1},lineage:"source-and-improvement"});
  }
  const restored=structuredClone(designs[1]!);restored.resources[0]!.dnsCachePolicy!.maxTtlSeconds=60;expect(restored).toEqual(designs[0]!);
  const nearRestored=structuredClone(designs[2]!);nearRestored.resources[1]!.size="small";expect(nearRestored).toEqual(designs[0]!);
  expect(reports.map(r=>r.challenge!.status)).toEqual(["not-met","met","not-met"]);
  expect(reports.map(r=>r.challenge!.predictions[0]!.actual)).toEqual(["healthy","healthy","healthy"]);
  expect(reports.map(r=>[r.terminal!.traffic!.wholeRun!.completed,r.terminal!.traffic!.wholeRun!.failed])).toEqual([[29,51],[58,22],[29,51]]);
  const observations=reports.map(r=>r.terminal!.dnsEvidence!.publication!);
  expect(observations.map(p=>p.negativeCacheHits)).toEqual([50,20,50]);
  expect(observations.map(p=>p.firstSuccessfulResolutionAtUs)).toEqual([5_100_527,2_200_527,5_100_527]);
  expect(observations.map(p=>p.unresolvedConnections)).toEqual([51,22,51]);
  for(const [i,r] of reports.entries()) {
    const p=observations[i]!;expect(p).toMatchObject({initialRecord:"absent",publishedAtUs:2_000_001,updates:1,currentRecord:{generation:2}});
    expect(r.actions[0]!.outcome!.intervention).toMatchObject({interventionId:"dns-publish-entry",atUs:p.publishedAtUs,endUs:null,resolvedTargets:[p.authorityId]});
    const row=rows[i]!, saved={...row,runInputs:JSON.parse(JSON.stringify(row.runInputs)),terminalSnapshot:JSON.parse(JSON.stringify(row.terminalSnapshot)),challengeScenario:JSON.parse(JSON.stringify(row.challengeScenario)),actions:structuredClone(row.actions)};
    expect(buildRunReport(saved).terminal).toEqual(r.terminal);expect(buildRunReport(saved).challenge).toEqual(r.challenge);
    const plan=recordedScenario(d,inputs[i]!)!;expect(verifiedScenario(JSON.parse(JSON.stringify(plan)),d,inputs[i]!)).toEqual(plan);
    const forged=structuredClone(plan);forged.steps[0]!.atSecond=3;expect(()=>verifiedScenario(forged,d,inputs[i]!)).toThrow("does not match");
  }
  expect(guidedReview(reports[0]!,true,null)!.cues).toContainEqual(expect.objectContaining({id:"requirement:callers",kind:"requirement"}));
  console.info("dns-lab-calibration",JSON.stringify(observations));
});
test("DNS lesson is registered with an executable reviewed identity and real evidence labels",()=>{
  expect(()=>checkLearningAuthoring(learningContent)).not.toThrow();
  const lesson=LEARNING_REGISTRY.findLesson("resolve-after-publication")!;
  expect(lesson).toMatchObject({kind:"executable-lab",moduleId:"dns-publication",experiment:{challengeId:"resolve-after-publication"}});
  expect(lesson.limitations.join(" ")).toContain("deterministic InfraForge");
  expect(captureRunInputs(dnsPublicationLabFixture().designs[1]!,dnsPublicationLabFixture().d.workload).adapterProfiles).toContain("dns-publication/1");
});

test("DNS lab refuses incomplete caller evidence, scenario receipts and source identity",()=>{
  const {d,rows}=dnsPublicationLabFixture();
  const snapshot=(r:typeof rows[number])=>r.terminalSnapshot as ReturnType<typeof captureSnapshot>;
  for(const mutate of [
    (r:typeof rows[number])=>{r.terminalSnapshot=null;},
    (r:typeof rows[number])=>{snapshot(r).simulatedSeconds--;},
    (r:typeof rows[number])=>{snapshot(r).metricsTopologyRevision++;},
    (r:typeof rows[number])=>{delete snapshot(r).traffic!.wholeRun;},
    (r:typeof rows[number])=>{snapshot(r).traffic!.wholeRun!.throughSecond--;},
    (r:typeof rows[number])=>{snapshot(r).traffic!.wholeRun!.failed=-1;},
    (r:typeof rows[number])=>{r.actions=[];},
  ]) {
    const row=structuredClone(rows[1]!);mutate(row);
    expect(buildRunReport(row).challenge!.criteria.find(c=>c.id==="callers")!.status).toBe("not-evaluated");
  }
  expect(improvementSource(rows[0]!,d.id).input).toEqual(rows[0]!.runInputs);
  const forged=structuredClone(rows[0]!);forged.challengeScenario=null;
  expect(()=>improvementSource(forged,d.id)).toThrow("scenario");
  const wrongHash=structuredClone(rows[0]!);wrongHash.challengeSpecHash="0".repeat(64);
  expect(buildRunReport(wrongHash).challenge!.status).toBe("unavailable");
  const corrupt=structuredClone(rows[1]!);snapshot(corrupt).dnsEvidence.publication!.publishedAtUs=9_000_000;
  expect(buildRunReport(corrupt).terminal).toBeNull();
});
