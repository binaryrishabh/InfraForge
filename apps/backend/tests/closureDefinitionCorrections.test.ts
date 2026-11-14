import { expect, test } from "bun:test";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { buildRegistry, challengeSeed, findChallenge, latestChallenge } from "../challenges/registry";
import { buildRunReport } from "../reports/report";
import { improvementSource } from "../challenges/improvements";
import { learningAttempt } from "../challenges/history";
import { LEARNING_REGISTRY } from "../learning/registry";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { checkLearningAuthoring } from "../learning/authoring";
import { learningContent } from "../learning/content";
import { answers, attemptRow, REFERENCE } from "./challengeHarness";

const families = [
  {id: "retrying-a-full-pool", hash: "5d8317a0a3d135a19466ec5e1da5b86e7d46bd6a4ffaebbaadaec4bf443ca49c", paths: ["version", "story.1", "hints.1"]},
  {id: "limit-or-capacity", hash: "48a7fce6157a217fd36abfc226be5a74d9aa453906fe2a23fb21175beed66423", paths: ["version", "hints.1"]},
  {id: "protect-one-api-route", hash: "695b5f64876c96ff10cc0f6f37a9f74190b41a9378d92c0cc75a163ca7a509ea", paths: ["version", "hints.2"]},
];
function differences(a: unknown, b: unknown, path = ""): string[] {
  if (Object.is(a, b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(k => differences(left[k], right[k], path ? `${path}.${k}` : k));
  }
  return [path];
}
function nearMiss(d: ChallengeDefinition) {
  const s = structuredClone(d.starter!);
  if (d.id === "retrying-a-full-pool") s.resources.find(r => r.id === "lb")!.retry!.maxAttempts = 4;
  else s.resources.find(r => r.id === "gateway")!.apiGateway!.routes![0]!.burstRequests = 2;
  return s;
}
for (const {id, hash, paths} of families) {
  test(`${id}: only claim text changes and both immutable versions and reviews resolve`, () => {
    const old = findChallenge(id, 1)!, next = findChallenge(id, 2)!;
    expect(old.hash).toBe(hash);
    expect(differences(old.definition, next.definition)).toEqual(paths);
    expect(latestChallenge(id)!.definition.version).toBeGreaterThanOrEqual(2);
    const previous = LEARNING_REGISTRY.findLesson(id, 1)!;
    expect(learningContent.archivedLessons).toContainEqual(previous);
    expect(LEARNING_REGISTRY.findLesson(id)!.contentVersion).toBeGreaterThanOrEqual(2);
    expect(REVIEWED_CHALLENGES[`${id}@1`]).toEqual({challengeId: id, version: 1, hash});
    expect(REVIEWED_CHALLENGES[`${id}@2`]).toEqual({challengeId: id, version: 2, hash: next.hash});
    const missing = {...REVIEWED_CHALLENGES}; delete missing[`${id}@2`];
    expect(() => checkLearningAuthoring(learningContent, missing)).toThrow("missing challenge review");
    expect(() => checkLearningAuthoring(learningContent, {...REVIEWED_CHALLENGES, [`${id}@2`]: {challengeId: id, version: 2, hash}})).toThrow("reviewed challenge identity is unavailable or changed");
  });
  test(`${id}: starter, reference and near miss retain verdicts under both production seeds`, () => {
    const old = findChallenge(id, 1)!.definition, next = findChallenge(id, 2)!.definition;
    expect(challengeSeed(old)).not.toBe(challengeSeed(next));
    const rows = [old, next].map(d => [d.starter!, REFERENCE[id]!, nearMiss(d)].map(s => attemptRow(d, s, answers(d, {health: "critical"}))));
    const reports = rows.map(set => set.map(row => buildRunReport(row)));
    console.info("cx4-version-measurements", id, JSON.stringify(reports.map(set => set.map(r => r.challenge!.criteria.map(c => ({id: c.id, status: c.status, detail: c.detail}))))));
    expect(reports.map(set => set.map(r => r.challenge!.status))).toEqual([["not-met", "met", "not-met"], ["not-met", "met", "not-met"]]);
    for (let i = 0; i < 3; i++) {
      expect(reports[1]![i]!.challenge!.criteria.map(c => [c.id, c.status])).toEqual(reports[0]![i]!.challenge!.criteria.map(c => [c.id, c.status]));
      const row = rows[0]![i]!, before = structuredClone(row);
      expect(buildRunReport(row)).toEqual(buildRunReport(row, buildRegistry([old])));
      expect(row.challengeSpecHash).toBe(hash);
      expect(buildRunReport(row).challenge).toMatchObject({version: 1, definitionMatches: true});
      expect(improvementSource(row, id).definition).toBe(old);
      expect(learningAttempt(row)).toMatchObject({version: 1});
      expect(learningAttempt(row)!.latestVersion).toBeGreaterThanOrEqual(2);
      expect(row).toEqual(before);
    }
    for (const change of [{terminalSnapshot: null}, {challengeSpecHash: hash}, {challengeVersion: 99}]) {
      expect(buildRunReport({...rows[1]![1]!, ...change}).challenge!.status).not.toBe("met");
    }
  }, 180000);
}
