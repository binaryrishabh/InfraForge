import { expect, test } from "bun:test";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import { buildRunReport } from "../reports/report";
import { findChallenge, specHash } from "../challenges/registry";
import { checkLessonClaims, lessonText } from "../learning/claims";
import { LEARNING_REGISTRY } from "../learning/registry";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { attemptRow, definition } from "./challengeHarness";

/* Audit of the 48 pre-window labs: lesson-only, version-forward corrections. Every corrected sentence is pinned to
   a fact measured on the real engine (harness attemptRow + buildRunReport). These lesson revisions retain their original challenge pins. */

function runLab(id: string, edit: (resource: any) => void, resourceId: string) {
  const d = definition(id), design = structuredClone(d.starter!) as ChallengeStarter;
  edit((design.resources as any[]).find(r => r.id === resourceId)!);
  const pred = {answers: Object.fromEntries(d.predictions.map(q => [q.id, "degraded"])), reasoning: null};
  const report = buildRunReport(attemptRow(d, design, pred as any));
  const c = report.challenge!;
  return {status: c.status, detail: (criterion: string) => c.criteria.find(x => x.id === criterion)!.detail, met: (criterion: string) => c.criteria.find(x => x.id === criterion)!.status === "met"};
}
const n = (text: string, re: RegExp) => Number(re.exec(text)![1]);

const text = (lesson: ReturnType<typeof LEARNING_REGISTRY.findLesson>) => lessonText(lesson!).map(([, t]) => t).join("\n");
/** Check the original lesson correction even after a later version archives it; its review still names the original challenge. */
function versionForward(id: string, oldVersion: number, challengeVersion: number, goneFromCurrent: string[], presentInCurrent: string[]) {
  const current = LEARNING_REGISTRY.findLesson(id, oldVersion + 1)!, old = LEARNING_REGISTRY.findLesson(id, oldVersion)!;
  const live = LEARNING_REGISTRY.findLesson(id)!;
  expect(current.contentVersion).toBe(oldVersion + 1);
  expect(old.contentVersion).toBe(oldVersion);
  expect(live.contentVersion).toBeGreaterThanOrEqual(current.contentVersion);
  expect(LEARNING_REGISTRY.listLessons().filter(l => l.id === id).map(l => l.contentVersion)).toEqual([live.contentVersion]);
  for (const phrase of goneFromCurrent) { expect(text(old)).toContain(phrase); expect(text(current)).not.toContain(phrase); }
  for (const phrase of presentInCurrent) { expect(text(current)).toContain(phrase); expect(text(old)).not.toContain(phrase); }
  const d = findChallenge(id, challengeVersion)!.definition, newPin = REVIEWED_CHALLENGES[`${id}@${oldVersion + 1}`], oldPin = REVIEWED_CHALLENGES[`${id}@${oldVersion}`];
  expect(newPin).toEqual({challengeId: id, version: d.version, hash: specHash(d)});
  expect(newPin).toEqual(oldPin);
  expect(d.version).toBe(challengeVersion);
  expect(checkLessonClaims(current, d)).toEqual([]);
  expect(checkLessonClaims(old, d)).toEqual([]);
}

test("choose-a-retry-mitigation: one and two attempts meet the p95 requirement, three, four and five do not", () => {
  const p95 = (attempts: number) => n(runLab("choose-a-retry-mitigation", r => { r.retry.maxAttempts = attempts; }, "lb").detail("latency"), /p95 was ([\d.]+) ms/);
  const [one, two, three, four, five] = [1, 2, 3, 4, 5].map(p95);
  expect([one!, two!].every(v => v <= 20)).toBe(true);
  expect([three!, four!, five!].every(v => v > 20)).toBe(true);
  expect(five!).toBeGreaterThan(four!); // five is worse than the starter
  versionForward("choose-a-retry-mitigation", 1, 1, ["Choose two or five attempts for this incident"],
    ["Choose one or two attempts for this incident", "one and two attempts meet the p95 requirement, while three, four and five do not", "five is worse than the four-attempt starter"]);
}, 120000);

test("keep-an-asset-cached: a TTL equal to the 30 second outage loses one caller, 31 passes with one request in flight", () => {
  const at = (ttl: number) => runLab("keep-an-asset-cached", r => { r.cdnCachePolicy.ttlSeconds = ttl; }, "cdn");
  const t30 = at(30), t31 = at(31);
  expect(t30.met("callers")).toBe(false);
  expect([n(t30.detail("callers"), /(\d+) completed/), n(t30.detail("callers"), /(\d+) unsuccessful/)]).toEqual([61, 1]);
  expect(t31.met("callers")).toBe(true);
  expect([n(t31.detail("callers"), /(\d+) completed/), n(t31.detail("callers"), /(\d+) unsuccessful/), n(t31.detail("callers"), /(\d+) in flight/)]).toEqual([63, 0, 1]);
  expect(at(60).met("callers")).toBe(true);
  expect(at(10).met("callers")).toBe(false);
  const old = "Explain why longer reuse alone does not cover the whole observation window. Overall health can still reflect the failed origin even when this asset is served.";
  versionForward("keep-an-asset-cached", 1, 1, [old], ["a TTL of 30 seconds, the length of the outage, still leaves one caller unsuccessful", "31 seconds meets it with one request still in flight at second 32"]);
}, 180000);

test("leave-room-for-firewall-flows: a limit equal to the four apps still refuses one connection, eight refuses none", () => {
  const at = (limit: number) => runLab("leave-room-for-firewall-flows", r => { r.firewallCapacity.maxFlows = limit; }, "fw").detail("admission");
  const refusals = [2, 4, 8].map(l => n(at(l), /(\d+) flow capacity refusals/));
  expect(refusals).toEqual([2, 1, 0]);
  expect(n(at(4), /fw: (\d+) tracked admissions/)).toBe(4); // admissions alone met the minimum of four; the refusal fails the lab
  versionForward("leave-room-for-firewall-flows", 1, 1, [], ["a limit of two leaves two capacity refusals and a limit equal to the four app instances still leaves one, because startup probes also need tracked state; eight leaves no refusal"]);
}, 120000);

test("diagnose-lost-app-capacity: a limit of two already admits both app paths; an app size change alone leaves the refusal", () => {
  const flows = (limit: number) => runLab("diagnose-lost-app-capacity", r => { r.firewallCapacity.maxFlows = limit; }, "fw");
  for (const limit of [2, 8]) { const r = flows(limit); expect(r.met("admission")).toBe(true); expect(r.detail("admission")).toContain("2 tracked admissions"); expect(r.detail("admission")).toContain("0 flow capacity refusals"); }
  const appOnly = runLab("diagnose-lost-app-capacity", r => { r.skuId = "c5.xlarge"; }, "app");
  expect(appOnly.met("admission")).toBe(false); expect(appOnly.detail("admission")).toContain("1 flow capacity refusals");
  versionForward("diagnose-lost-app-capacity", 1, 1, [], ["a tracked-connection limit of two already admits both app paths with no refusals", "an app size change alone leaves that refusal"]);
}, 120000);

test("reuse-before-expiry: TTL 5 shows the starter tail while 2, 3, 4, 6 and 10 meet the requirement", () => {
  const p95 = (ttl: number) => runLab("reuse-before-expiry", r => { r.cachePolicy.ttlSeconds = ttl; }, "cache");
  const starter = n(p95(1).detail("latency"), /p95 was ([\d.]+) ms/);
  expect(n(p95(5).detail("latency"), /p95 was ([\d.]+) ms/)).toBe(starter);
  for (const ttl of [2, 3, 4, 6, 10]) expect(p95(ttl).met("latency")).toBe(true);
  expect(p95(5).met("latency")).toBe(false);
  versionForward("reuse-before-expiry", 3, 2, [], ["Not every longer TTL works", "5 seconds keeps the starter's tail, because fills from the first second expire again inside the scored second"]);
}, 180000);

test("restore-a-database-writer: promotion at second 3, 4 or 5 passes (5 exactly on both limits); 6 and later miss", () => {
  const at = (second: number) => runLab("restore-a-database-writer", r => { r.databaseRecoveryPlan.promoteAtSecond = second; }, "db");
  const rows = [3, 4, 5, 6, 7].map(s => { const r = at(s); return [r.met("callers"), n(r.detail("callers"), /(\d+) completed/), n(r.detail("callers"), /(\d+) unsuccessful/)]; });
  expect(rows).toEqual([[true, 130, 10], [true, 120, 20], [true, 110, 30], [false, 100, 40], [false, 90, 50]]);
  const old = "try a later promotion as a near miss";
  versionForward("restore-a-database-writer", 1, 1, [old], ["promotion at second 3, 4 or 5 meets the caller requirement, with second 5 exactly on both limits; second 6 and later miss it", "try promotion at second 6 or later as a near miss"]);
}, 180000);

test("notification-retry-storm: a delivery limit of one or two passes, three fails only on health, four or more miss a queue requirement", () => {
  const at = (limit: number) => runLab("notification-retry-storm", r => { r.asyncQueue.maxReceives = limit; }, "queue");
  const [one, two, three, four, five] = [1, 2, 3, 4, 5].map(at);
  expect([one!.met("work") && one!.met("health"), two!.met("work") && two!.met("health")]).toEqual([true, true]);
  expect([three!.met("work"), three!.met("health")]).toEqual([true, false]);
  expect([four!.met("work"), five!.met("work")]).toEqual([false, false]);
  versionForward("notification-retry-storm", 1, 1, [], ["a limit of one or two meets every requirement; three already leaves the worker saturated, so Healthy health fails, and four or more also miss a queue requirement"]);
}, 240000);
