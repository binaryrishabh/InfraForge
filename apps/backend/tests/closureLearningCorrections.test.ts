import { expect, test } from "bun:test";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import { findChallenge } from "../challenges/registry";
import { buildRunReport } from "../reports/report";
import { lessonText, checkLessonClaims } from "../learning/claims";
import { LEARNING_REGISTRY } from "../learning/registry";
import { learningContent } from "../learning/content";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { answers, attemptRow } from "./challengeHarness";

type Edit = (design: ChallengeStarter) => void;
const resource = (s: ChallengeStarter, id: string) => s.resources.find(r => r.id === id)!;
function run(id: string, edit: Edit, version: number) {
  const d = findChallenge(id, version)!.definition, s = structuredClone(d.starter!);
  edit(s);
  const row = attemptRow(d, s, answers(d, {health: "degraded", "database-health": "healthy", "overall-health": "degraded", "busiest-type": "Database", cause: "policy-denied", scan: "yes"}));
  const report = buildRunReport(row);
  console.info("cx4-measured", id, version, JSON.stringify(report.challenge!.criteria.map(c => ({id: c.id, status: c.status, detail: c.detail}))));
  return report;
}
function revised(id: string, previous: number, phrase: string, challengeVersion = 1) {
  const old = LEARNING_REGISTRY.findLesson(id, previous)!, next = LEARNING_REGISTRY.findLesson(id, previous + 1)!;
  expect(next).toBeDefined();
  expect(next.contentVersion).toBe(previous + 1);
  expect(next).toEqual({...old, contentVersion: previous + 1, limitations: next.limitations});
  expect(LEARNING_REGISTRY.findLesson(id)!.contentVersion).toBeGreaterThanOrEqual(previous + 1);
  expect(learningContent.archivedLessons).toContainEqual(old);
  expect(lessonText(old).map(([, t]) => t).join(" ")).not.toContain(phrase);
  expect(next.limitations.join(" ")).toContain(phrase);
  const d = findChallenge(id, challengeVersion)!;
  expect(REVIEWED_CHALLENGES[`${id}@${previous + 1}`]).toEqual({challengeId: id, version: challengeVersion, hash: d.hash});
  if (id !== "retrying-a-full-pool" && id !== "limit-or-capacity" && id !== "protect-one-api-route") expect(REVIEWED_CHALLENGES[`${id}@${previous + 1}`]).toEqual(REVIEWED_CHALLENGES[`${id}@${previous}`]);
  expect(checkLessonClaims(next, d.definition)).toEqual([]);
}

const alternatives: {id: string; previous: number; phrase: string; edits: Edit[]}[] = [
  {id: "share-a-cache-fill", previous: 3, phrase: "a TTL of 2 to 5 seconds also meets", edits: [2, 3, 4, 5].map(ttl => s => { resource(s, "cache").cachePolicy!.ttlSeconds = ttl; })},
  {id: "keep-waiting-work", previous: 1, phrase: "100 ms of CPU work per job also meets", edits: [s => { resource(s, "worker").asyncWorker!.cpuMsPerJob = 100; }]},
  {id: "move-reads-off-the-writer", previous: 1, phrase: "a bigger writer also meets", edits: [s => { resource(s, "db").size = "medium"; }]},
  {id: "queue-overlapping-jobs", previous: 1, phrase: "function concurrency to 32 also meets", edits: [s => { resource(s, "fn").serverless!.concurrency = 32; }]},
  {id: "find-the-denying-rule", previous: 1, phrase: "Deleting only the deny rule also meets", edits: [s => { const fw = resource(s, "fw"); fw.firewallSettings!.rules = fw.firewallSettings!.rules!.filter(r => r.id !== "quarantine-db"); }]},
  {id: "route-around-a-slow-vm", previous: 1, phrase: "slow VM's CPU quota to 50% also meets", edits: [s => { resource(s, "slow").vmCpuQuota!.limitPercent = 50; }]},
  {id: "test-a-circuit-again", previous: 1, phrase: "Disabling the circuit also meets", edits: [s => { resource(s, "lb").circuitBreaker!.enabled = false; }]},
  {id: "parallel-jobs-for-a-burst", previous: 1, phrase: "125 ms of CPU work per job also meet", edits: [s => { resource(s, "worker").asyncWorker!.cpuMsPerJob = 125; }]},
  {id: "leave-time-to-acknowledge", previous: 1, phrase: "acknowledgement delay to 0 ms also meets", edits: [s => { resource(s, "worker").asyncWorker!.acknowledgementDelayMs = 0; }]},
];
for (const {id, previous, phrase, edits} of alternatives) test(`${id}: measure the alternative before disclosing it in a version-forward lesson`, () => {
  const version = REVIEWED_CHALLENGES[`${id}@${previous}`]!.version;
  expect(run(id, () => {}, version).challenge!.status).toBe("not-met");
  for (const edit of edits) expect(run(id, edit, version).challenge!.status).toBe("met");
  revised(id, previous, phrase, version);
}, 180000);

test("retry budget also accepts a deeper queue without changing five attempts", () => {
  for (const version of [1, 2]) {
    expect(findChallenge("retrying-a-full-pool", version)).not.toBeNull();
    expect(run("retrying-a-full-pool", () => {}, version).challenge!.status).toBe("not-met");
    const r = run("retrying-a-full-pool", s => { resource(s, "app").vmExecution!.queuedRequests = 64; }, version);
    expect(r.challenge!.status).toBe("met");
    expect(r.challenge!.criteria.find(c => c.id === "amplification")!.detail).toContain("0.441");
  }
  revised("retrying-a-full-pool", 1, "absorbing retries in a deeper queue", 2);
}, 180000);

for (const id of ["limit-or-capacity", "protect-one-api-route"]) test(`${id}: only one read burst credit passes with the other settings fixed`, () => {
  const at = (burst: number) => run(id, s => { resource(s, "gateway").apiGateway!.routes!.find(r => r.id === "read")!.burstRequests = burst; }, 2);
  const one = at(1), two = at(2);
  expect(one.challenge!.status).toBe("met");
  expect(one.challenge!.criteria.find(c => c.id === "reads")!.detail).toContain("2 completions");
  expect(two.challenge!.status).toBe("not-met");
  expect(two.challenge!.criteria.find(c => c.id === "reads")!.detail).toContain("1 upstream");
  const three = run(id, s => { resource(s, "readApp").vmExecution!.workers = 3; }, 2);
  expect(three.challenge!.status).toBe("not-met");
  expect(three.challenge!.criteria.find(c => c.id === "reads")!.detail).toContain(id === "limit-or-capacity" ? "7 upstream" : "1332 upstream");
  revised(id, 1, "one credit is the only accepted read burst value", 2);
}, 180000);
