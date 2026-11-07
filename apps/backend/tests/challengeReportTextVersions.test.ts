import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { learningMeasurement } from "@infraforge/contracts/learning";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { fitARequestInMemoryV1 } from "../challenges/definitions/fit-a-request-in-memory/v1";
import { splitTheCapacityBudgetV1 } from "../challenges/definitions/split-the-capacity-budget/v1";
import { buildRegistry, challengeSeed, findChallenge, latestChallenge, listLatestChallenges, specHash } from "../challenges/registry";
import { learningAttempt } from "../challenges/history";
import { improvementSource } from "../challenges/improvements";
import { classifyComparison } from "../comparison/classify";
import { buildRunReport } from "../reports/report";
import { checkLearningAuthoring } from "../learning/authoring";
import { checkLessonClaims } from "../learning/claims";
import { learningContent } from "../learning/content";
import { LEARNING_REGISTRY } from "../learning/registry";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { deriveLessonProgress } from "../learning/progress";
import { answers, attemptRow, REFERENCE } from "./challengeHarness";

const families = [
  { old: fitARequestInMemoryV1, oldHash: "f9d6da9199e8abbc5045bcae85c2cec56d85f821ee86233d313a962be77e9763",
    sourceHash: "217e5c6d1d660200e6849b70200ac8704bcb82967690d820b122484288c55d14",
    oldLesson: 2, newLesson: 3, track: "diagnosis",
    lessonHash: "680fce59361475eb861d98cb5e395e52368b81873c52dbfb65bd5dfbb8467871",
    changed: ["version", "hints.0", "debrief.2"] },
  { old: splitTheCapacityBudgetV1, oldHash: "db47968e9080943fbcc8ac3c883fb4c0a4d486f143fc94b575ca7f57e8ca82a6",
    sourceHash: "d4b225cd94d7bf976cab038d4590ee605307c173a5ca4a6c9467458147e8df04",
    oldLesson: 3, newLesson: 4, track: "architecture",
    lessonHash: "3b07648e8dc84467d2234cfc9dfa65d4189ea8426ff19c43ad6a87f13bb6fac7",
    changed: ["version", "debrief.2"] },
];
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function differences(a: unknown, b: unknown, path = ""): string[] {
  if (Object.is(a, b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key =>
      differences(left[key], right[key], path ? `${path}.${key}` : key));
  }
  return [path];
}
const predictions = (d: ChallengeDefinition) => answers(d, {"database-health": "healthy", "busiest-type": "Virtual Machine", "overall-health": "healthy"});

for (const family of families) {
  const { old, oldHash } = family, id = old.id;
  test(`${id}: v2 changes only version and the reviewed report text; v1 source, pin and registry remain identical`, () => {
    const current = findChallenge(id, 2)!;
    expect(findChallenge(id, 1)!.definition).toBe(old);
    expect(findChallenge(id, 1)!.hash).toBe(oldHash);
    expect(specHash(old)).toBe(oldHash);
    expect(hash(source(`../challenges/definitions/${id}/v1.ts`))).toBe(family.sourceHash);
    const pins = source("./challengeAuthoring.test.ts");
    expect(pins).toContain(`"${id}@1": "${oldHash}"`);
    expect(pins).toContain(`"${id}@2": "${current.hash}"`);
    expect(differences(old, current.definition)).toEqual(family.changed);
    expect(validateInfrastructureName(current.definition.title)).toBeNull();
    expect(latestChallenge(id)).toBe(current);
    expect(listLatestChallenges().filter(entry => entry.definition.id === id)).toEqual([current]);
    expect(findChallenge(id, 3)).toBeNull();
  });

  test(`${id}: new lesson content resolves v2 while every old lesson review still resolves v1`, () => {
    const latest = LEARNING_REGISTRY.findLesson(id)!, prior = LEARNING_REGISTRY.findLesson(id, family.oldLesson)!;
    expect(latest.contentVersion).toBe(family.newLesson);
    expect(differences(prior, latest)).toEqual(["contentVersion"]);
    expect(hash(source(`../learning/content/${family.track}/lessons/${id}-v${family.oldLesson}.ts`))).toBe(family.lessonHash);
    expect(LEARNING_REGISTRY.listLessons({challengeId: id})).toEqual([latest]);
    for (let version = 1; version <= family.oldLesson; version++) {
      const archived = LEARNING_REGISTRY.findLesson(id, version)!;
      expect(archived.contentVersion).toBe(version);
      expect(learningContent.archivedLessons).toContainEqual(archived);
      expect(REVIEWED_CHALLENGES[`${id}@${version}`]).toEqual({challengeId: id, version: 1, hash: oldHash});
    }
    const identity = `${id}@${family.newLesson}`, entry = findChallenge(id, 2)!;
    expect(REVIEWED_CHALLENGES[identity]).toEqual({challengeId: id, version: 2, hash: entry.hash});
    expect(checkLearningAuthoring(learningContent).archived).toBeGreaterThanOrEqual(18); // Later lanes archive more versions.
    expect(checkLessonClaims(latest, entry.definition)).toEqual([]);
    const missing = {...REVIEWED_CHALLENGES}; delete missing[identity];
    expect(() => checkLearningAuthoring(learningContent, missing)).toThrow(`${identity}: missing challenge review`);
    expect(() => checkLearningAuthoring(learningContent, {...REVIEWED_CHALLENGES,
      [identity]: {challengeId: id, version: 1, hash: oldHash}})).toThrow("moved since contentVersion");
    expect(() => checkLearningAuthoring(learningContent, {...REVIEWED_CHALLENGES,
      [identity]: {challengeId: id, version: 2, hash: oldHash}})).toThrow("reviewed challenge identity is unavailable or changed");
  });

  test(`${id}: real v1/v2 runs retain identical measurements and verdicts, and old history/progress stays versioned`, () => {
    const current = findChallenge(id, 2)!.definition;
    const rows = [old, current].map(d => [d.starter!, REFERENCE[id]!].map(design => attemptRow(d, design, predictions(d))));
    const reports = rows.map(pair => pair.map(row => buildRunReport(row)));
    expect(reports.map(pair => pair.map(report => report.challenge!.status))).toEqual([["not-met", "met"], ["not-met", "met"]]);
    expect(challengeSeed(current)).not.toBe(challengeSeed(old));
    for (let design = 0; design < 2; design++) {
      const before = reports[0]![design]!, after = reports[1]![design]!;
      // Compare every terminal field except wall-clock capture times, with each
      // version's actual production seed. No measurements are hand-authored.
      const {capturedAt: _a, metricsComputedAt: _b, ...first} = before.terminal!;
      const {capturedAt: _c, metricsComputedAt: _d, ...second} = after.terminal!;
      expect(second).toEqual(first);
      expect(after.challenge!.criteria).toEqual(before.challenge!.criteria);
      expect(after.challenge!.predictions).toEqual(before.challenge!.predictions);
      const cost = (report: typeof after) => {
        const stage = report.stages.find(s => s.name === "CostEstimate")!;
        return {monthlyEstimateUsd: stage.monthlyEstimateUsd, lineItems: stage.lineItems, budgets: report.monthlyBudgets};
      };
      expect(cost(after).monthlyEstimateUsd).toBeGreaterThan(0);
      expect(cost(after)).toEqual(cost(before));
    }
    const oldRow = {...rows[0]![1]!, ownerId: "learner"}, newRow = {...rows[1]![1]!, ownerId: "learner"};
    const snapshot = structuredClone(oldRow);
    const beforeRegistry = buildRegistry([old]);
    expect(buildRunReport(oldRow)).toEqual(buildRunReport(oldRow, beforeRegistry));
    expect(learningAttempt(oldRow)).toMatchObject({version: 1, status: "met", latestVersion: 2, canRetry: true});
    const improvement = improvementSource(oldRow, id);
    expect(improvement.definition).toBe(old);
    expect(improvement.hash).toBe(oldHash);
    expect(improvement.input.seed).toBe(challengeSeed(old));
    const lessons = [LEARNING_REGISTRY.findLesson(id)!];
    expect(deriveLessonProgress("learner", lessons, [oldRow])[0]).toMatchObject({activity: "attempted", attempts: 1,
      currentChallengeVersion: 2, fromEarlierVersion: true, earlierVersionRequirementsMet: true, predictionReviewed: true});
    expect(deriveLessonProgress("learner", lessons, [oldRow, newRow])[0]).toMatchObject({activity: "requirements-met", attempts: 2,
      fromEarlierVersion: true, earlierVersionRequirementsMet: true, sameConditionsComparison: false});
    expect(classifyComparison(oldRow, newRow).challengeConditions).toBe("different");
    expect(deriveLessonProgress("someone-else", lessons, [oldRow, newRow])[0]!.attempts).toBe(0);
    expect(oldRow).toEqual(snapshot);
    for (const change of [{terminalSnapshot: null}, {challengeSpecHash: oldHash}, {challengeVersion: 99}, {challengePrediction: null}]) {
      const bad = {...newRow, ...change};
      expect(buildRunReport(bad).challenge!.status).not.toBe("met");
      expect(deriveLessonProgress("learner", lessons, [bad])[0]!.activity).toBe("attempted");
    }
    console.info("Report text version calibration", JSON.stringify(reports.map(pair => pair.map(report => ({
      id, version: report.challenge!.version, status: report.challenge!.status, health: report.terminal!.health,
      callers: report.terminal!.traffic!.wholeRun, p95: report.terminal!.traffic!.latencyMs.p95,
      resources: report.terminal!.resources.map(r => ({id: r.id, cpu: r.cpu, vmMemory: r.vmMemory})), monthly: report.stages.find(s => s.name === "CostEstimate")!.monthlyEstimateUsd, budgets: report.monthlyBudgets,
    })))));
  }, 120000);
}

test("corrected challenge wording names audited saved-report labels and retains generic Memory honesty", () => {
  const memory = findChallenge("fit-a-request-in-memory", 2)!.definition;
  const reportRenderer = source("../../web/src/features/reports/components/ReportMeasurements.tsx");
  const memoryRenderer = source("../../web/src/features/live/VmMemoryReadings.tsx");
  expect(reportRenderer).toContain("<VmMemoryReadings metrics={r.vmMemory}");
  for (const label of ["Resident", "Limit", "Headroom", "Holding requests", "Active requests", "Refused allocations", "Peak resident"]) {
    expect(memory.hints[0]).toContain(label); expect(memory.debrief[2]).toContain(label);
    expect(learningMeasurement(`VM memory: ${label}`)).not.toBeNull();
    expect(memoryRenderer).toContain(`"${label}"`);
  }
  expect(memory.debrief[2]).toContain("Its generic Memory percentage is unavailable here.");
  expect(memory.debrief[2]).toContain("Missing or null memory readings remain Unknown");
  const budget = findChallenge("split-the-capacity-budget", 2)!.definition;
  for (const label of ["Monthly resource price line items", "Remaining monthly budget"]) {
    expect(budget.debrief[2]).toContain(label);
    expect(learningMeasurement(label)).toMatchObject({source: "apps/web/src/features/reports/components/ReportMeasurements.tsx", marker: label});
    expect(reportRenderer).toContain(label);
  }
  expect(budget.debrief[2]).toContain("negative amount means over budget");
  expect(budget.debrief[2]).toContain("Missing or invalid cost evidence remains Unknown");
});
