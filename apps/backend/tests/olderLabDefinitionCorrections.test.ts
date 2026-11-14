import { expect, test } from "bun:test";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { buildRegistry, challengeSeed, findChallenge, latestChallenge } from "../challenges/registry";
import { learningAttempt } from "../challenges/history";
import { improvementSource } from "../challenges/improvements";
import { buildRunReport } from "../reports/report";
import { checkLearningAuthoring } from "../learning/authoring";
import { learningContent } from "../learning/content";
import { LEARNING_REGISTRY } from "../learning/registry";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { answers, attemptRow, REFERENCE } from "./challengeHarness";

const families = [
  {id: "notification-retry-storm", hash: "e154e1b8a5741ba5754d9f1bb1bc95e6fb567530610563789f84aa709d2af3de", changes: ["version", "hints.2"]},
  {id: "restore-a-database-writer", hash: "e7c0c1a217ab01ecb79dd3a490d7f3d69f526788bb99d00286f8b7be884d0c25", changes: ["version", "story.1", "hints.1"]},
  {id: "choose-a-retry-mitigation", hash: "6ca83f5bd42df0ea1f6ad09bb15d139a7b3b15abb3083a93b0e4d7e8b65ef46e", changes: ["version", "story.1"]},
];
function differences(a: unknown, b: unknown, path = ""): string[] {
  if (Object.is(a, b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key =>
      differences(left[key], right[key], path ? `${path}.${key}` : key));
  }
  return [path];
}
const prediction = (d: ChallengeDefinition) => answers(d, {"overall-health": "healthy", "busiest-type": "Virtual Machine"});
function variant(d: ChallengeDefinition, value: number) {
  const design = structuredClone(d.starter!);
  if (d.id === "notification-retry-storm") design.resources.find(r => r.id === "queue")!.asyncQueue!.maxReceives = value;
  else if (d.id === "restore-a-database-writer") design.resources.find(r => r.id === "db")!.databaseRecoveryPlan!.promoteAtSecond = value;
  else design.resources.find(r => r.id === "lb")!.retry!.maxAttempts = value;
  return design;
}
const run = (d: ChallengeDefinition, value: number) => buildRunReport(attemptRow(d, variant(d, value), prediction(d)));
const status = (r: ReturnType<typeof run>, id: string) => r.challenge!.criteria.find(c => c.id === id)!.status;

test("notification hint names the measured one-or-two delivery band, not an unspecified small number", () => {
  const d = latestChallenge("notification-retry-storm")!.definition;
  const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => run(d, n));
  expect(rows.map(r => r.challenge!.status)).toEqual(["met", "met", ...Array(8).fill("not-met")]);
  expect([status(rows[2]!, "work"), status(rows[2]!, "health")]).toEqual(["met", "not-met"]);
  expect(rows.slice(3).map(r => status(r, "work"))).toEqual(Array(7).fill("not-met"));
  expect(d.hints[2]).toContain("one or two");
  expect(d.hints[2]).not.toContain("a small number");
  expect(d.version).toBeGreaterThanOrEqual(2);
}, 240000);

test("writer story and hint distinguish passing seconds 3 through 5 from allowed but failing seconds 6 through 9", () => {
  const d = latestChallenge("restore-a-database-writer")!.definition;
  const rows = [3, 4, 5, 6, 7, 8, 9].map(n => run(d, n));
  expect(rows.map(r => r.challenge!.status)).toEqual(["met", "met", "met", "not-met", "not-met", "not-met", "not-met"]);
  expect(rows.map(r => [r.terminal!.traffic!.wholeRun!.completed, r.terminal!.traffic!.wholeRun!.failed]))
    .toEqual([[130, 10], [120, 20], [110, 30], [100, 40], [90, 50], [80, 60], [70, 70]]);
  expect(d.story[1]).toContain("3 through 5");
  expect(d.hints[1]).toContain("3 through 5");
  expect(d.hints[1]).toContain("6 through 9");
  expect(d.version).toBeGreaterThanOrEqual(2);
}, 120000);

test("retry story treats five attempts as a failing near miss, with the measured p95 for attempts one through five", () => {
  const d = latestChallenge("choose-a-retry-mitigation")!.definition;
  const old = findChallenge(d.id, 1)!.definition;
  const original = [1, 2, 3, 4, 5].map(n => run(old, n));
  expect(original.map(r => r.terminal!.traffic!.latencyMs.p95)).toEqual([4.654, 4.654, 69.527, 78.216, 83.216]);
  const rows = [1, 2, 3, 4, 5].map(n => run(d, n));
  // Version-forward runs use their own production seed; the failing band stays the same.
  expect(rows.map(r => r.terminal!.traffic!.latencyMs.p95)).toEqual([4.654, 4.654, 71.597, 74.432, 80.164]);
  expect(original.map(r => r.challenge!.status)).toEqual(["met", "met", "not-met", "not-met", "not-met"]);
  expect(rows.map(r => r.challenge!.status)).toEqual(["met", "met", "not-met", "not-met", "not-met"]);
  expect(d.story[1]).toContain("near miss");
  expect(d.story[1]).not.toContain("two plausible mitigations");
  expect(d.version).toBeGreaterThanOrEqual(2);
}, 120000);

for (const {id, hash, changes} of families) {
  test(`${id}: only claim text changes; all older lesson reviews and the old challenge hash remain resolvable`, () => {
    const old = findChallenge(id, 1)!, current = findChallenge(id, 2)!;
    expect(old.hash).toBe(hash);
    expect(differences(old.definition, current.definition)).toEqual(changes);
    expect(latestChallenge(id)!.definition.version).toBeGreaterThanOrEqual(current.definition.version);
    const lesson = LEARNING_REGISTRY.findLesson(id, 3)!;
    expect(LEARNING_REGISTRY.findLesson(id)!.contentVersion).toBeGreaterThanOrEqual(3);
    expect(lesson.contentVersion).toBe(3);
    expect(differences(LEARNING_REGISTRY.findLesson(id, 2), lesson)).toEqual(["contentVersion"]);
    for (const version of [1, 2]) {
      const archived = LEARNING_REGISTRY.findLesson(id, version)!;
      expect(archived.contentVersion).toBe(version);
      expect(learningContent.archivedLessons).toContainEqual(archived);
      expect(REVIEWED_CHALLENGES[`${id}@${version}`]).toEqual({challengeId: id, version: 1, hash});
    }
    const key = `${id}@3`;
    expect(REVIEWED_CHALLENGES[key]).toEqual({challengeId: id, version: 2, hash: current.hash});
    const missing = {...REVIEWED_CHALLENGES}; delete missing[key];
    expect(() => checkLearningAuthoring(learningContent, missing)).toThrow(`${key}: missing challenge review`);
    expect(() => checkLearningAuthoring(learningContent, {...REVIEWED_CHALLENGES,
      [key]: {challengeId: id, version: 1, hash}})).toThrow("moved since contentVersion");
    expect(() => checkLearningAuthoring(learningContent, {...REVIEWED_CHALLENGES,
      [key]: {challengeId: id, version: 2, hash}})).toThrow("reviewed challenge identity is unavailable or changed");
  });

  test(`${id}: starter, reference and near miss retain v1/v2 verdicts; saved v1 attempts still use v1`, () => {
    const old = findChallenge(id, 1)!.definition, current = findChallenge(id, 2)!.definition;
    const near = variant(old, id === "notification-retry-storm" ? 3 : id === "restore-a-database-writer" ? 6 : 5);
    const rows = [old, current].map(d => [d.starter!, REFERENCE[id]!, near].map(s => attemptRow(d, s, prediction(d))));
    const reports = rows.map(pair => pair.map(row => buildRunReport(row)));
    expect(challengeSeed(old)).not.toBe(challengeSeed(current)); // Exercise both production seeds.
    expect(reports.map(pair => pair.map(r => r.challenge!.status)))
      .toEqual([["not-met", "met", "not-met"], ["not-met", "met", "not-met"]]);
    for (let i = 0; i < 3; i++) {
      expect(reports[1]![i]!.challenge!.criteria.map(c => [c.id, c.status]))
        .toEqual(reports[0]![i]!.challenge!.criteria.map(c => [c.id, c.status]));
      const row = rows[0]![i]!, snapshot = structuredClone(row);
      expect(buildRunReport(row)).toEqual(buildRunReport(row, buildRegistry([old])));
      expect(buildRunReport(row).challenge).toMatchObject({version: 1, definitionMatches: true});
      expect(row.challengeSpecHash).toBe(hash);
      expect(improvementSource(row, id).definition).toBe(old);
      expect(improvementSource(row, id).hash).toBe(hash);
      expect(learningAttempt(row)).toMatchObject({version: 1});
      expect(learningAttempt(row)!.latestVersion).toBeGreaterThanOrEqual(2);
      expect(row).toEqual(snapshot);
    }
    for (const change of [{terminalSnapshot: null}, {challengeSpecHash: hash}, {challengeVersion: 99}]) {
      expect(buildRunReport({...rows[1]![1]!, ...change}).challenge!.status).not.toBe("met");
    }
  }, 240000);
}
