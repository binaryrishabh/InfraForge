import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RunReport } from "@infraforge/contracts/reports";
import { evidenceLabels, learningMeasurement } from "@infraforge/contracts/learning";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { diagnoseConsumerCreditV1 as old } from "../challenges/definitions/diagnose-consumer-credit/v1";
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

const id = old.id, current = findChallenge(id, 2)!.definition;
const oldHash = "a236d0e516f6213362c7241dc1dcc309157870d403553239b71a01bdc6867f34";
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
function differences(a: unknown, b: unknown, path = ""): string[] {
  if (Object.is(a, b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key =>
      differences(left[key], right[key], path ? `${path}.${key}` : key));
  }
  return [path];
}

for (const [file, hash] of [
  ["challenges/definitions/diagnose-consumer-credit/v1.ts", "099e3ab83a307c4c0d6fd92f7eef628768418644cb4292a00c7610e694d29521"],
  ["learning/content/diagnosis/lessons/diagnose-consumer-credit.ts", "9ac69cdf1289e7a6dcda8d6acb1cd8520f93f8a801f2da34768e83713706263c"],
  ["learning/content/missions/lessons/analytics-burst-buffer.ts", "2a375088de393d8ce312c74889d74d67fb964cbb752fb9caf7d6b99329966486"],
]) test(`queue report refresh preserves published source ${file}`, () => {
  expect(createHash("sha256").update(source(`../${file}`)).digest("hex")).toBe(hash!);
});

test("consumer credit v2 changes only reviewed text and version, preserving every executable input and old pin", () => {
  expect(differences(old, current)).toEqual(["version", "concepts.3", "debrief.2"]);
  expect(findChallenge(id, 1)!.definition).toBe(old);
  expect(specHash(old)).toBe(oldHash); expect(findChallenge(id, 1)!.hash).toBe(oldHash);
  const pins = source("./challengeAuthoring.test.ts");
  for (const version of [1, 2]) expect(pins).toContain(`"${id}@${version}": "${findChallenge(id, version)!.hash}"`);
  expect(validateInfrastructureName(current.title)).toBeNull();
  expect(latestChallenge(id)!.definition).toBe(current);
  expect(listLatestChallenges().filter(entry => entry.definition.id === id)).toEqual([findChallenge(id, 2)!]);
  expect(findChallenge(id, 3)).toBeNull();
  expect(REFERENCE[`${id}-v2`]).toEqual(REFERENCE[id]!);
  for (const label of ["Ready messages", "Oldest ready message age (seconds)"]) {
    expect(current.debrief[2]).toContain(label);
    expect(LEARNING_REGISTRY.findLesson(id)!.explanation[3]).toContain(label);
    expect(LEARNING_REGISTRY.findLesson("analytics-burst-buffer")!.explanation[1]).toContain(label);
    expect(learningMeasurement(label)).not.toBeNull();
  }
});

for (const family of [
  {id, version: 2, changed: ["contentVersion", "explanation.3", "experiment.evidenceToInspect.4", "limitations.1", "followUp"]},
  {id: "analytics-burst-buffer", version: 1, changed: ["contentVersion", "explanation.1"]},
]) test(`${family.id}: new lesson content corrects only report text and keeps archived lookups and reviews`, () => {
  const latest = LEARNING_REGISTRY.findLesson(family.id)!, prior = LEARNING_REGISTRY.findLesson(family.id, 1)!;
  expect(latest.contentVersion).toBe(2); expect(prior.contentVersion).toBe(1);
  expect(differences(prior, latest)).toEqual(family.changed);
  expect(learningContent.archivedLessons).toContainEqual(prior);
  expect(LEARNING_REGISTRY.listLessons({challengeId: family.id})).toEqual([latest]);
  expect(LEARNING_REGISTRY.findLesson(family.id, 3)).toBeNull();
  expect(REVIEWED_CHALLENGES[`${family.id}@1`]).toEqual({challengeId: family.id, version: 1, hash: findChallenge(family.id, 1)!.hash});
  const key = `${family.id}@2`, entry = findChallenge(family.id, family.version)!;
  expect(REVIEWED_CHALLENGES[key]).toEqual({challengeId: family.id, version: family.version, hash: entry.hash});
  expect(checkLessonClaims(latest, entry.definition)).toEqual([]);
  for (const label of latest.experiment!.evidenceToInspect!.flatMap(evidenceLabels)) {
    const measurement = learningMeasurement(label)!;
    expect(measurement).not.toBeNull();
    expect(source(`../../../${measurement.source}`)).toContain(measurement.marker);
  }
  for (const version of [1, 2]) {
    const missing = {...REVIEWED_CHALLENGES}; delete missing[`${family.id}@${version}`];
    expect(() => checkLearningAuthoring(learningContent, missing)).toThrow(`${family.id}@${version}: missing challenge review`);
  }
  expect(() => checkLearningAuthoring(learningContent, {...REVIEWED_CHALLENGES,
    [key]: {...REVIEWED_CHALLENGES[key]!, hash: "0".repeat(64)}})).toThrow("reviewed challenge identity is unavailable or changed");
  const copy = LEARNING_REGISTRY.findLesson(family.id, 1)!; copy.explanation[0] = "changed";
  expect(LEARNING_REGISTRY.findLesson(family.id, 1)).toEqual(prior);
});

test("consumer credit v2 refuses a stale lesson review", () => {
  expect(() => checkLearningAuthoring(learningContent, {...REVIEWED_CHALLENGES,
    [`${id}@2`]: REVIEWED_CHALLENGES[`${id}@1`]!})).toThrow("moved since contentVersion");
});

const near = structuredClone(current.starter!);
near.resources.find(r => r.id === "queue")!.asyncQueue!.visibilityTimeoutSeconds = 60;
const rows = [old, current].map(d => [d.starter!, REFERENCE[`${id}-v2`]!, near]
  .map(design => attemptRow(d, design, answers(d, {"overall-health": "degraded"}))));
const reports = rows.map(pair => pair.map(row => buildRunReport(row)));

test("consumer credit text version preserves real measurements, verdicts, old reports and progress identities", () => {
  expect(reports.map(pair => pair.map(report => report.challenge!.status))).toEqual([["not-met", "met", "not-met"], ["not-met", "met", "not-met"]]);
  expect(challengeSeed(old)).not.toBe(challengeSeed(current));
  for (let design = 0; design < 3; design++) {
    const before = reports[0]![design]!, after = reports[1]![design]!;
    const {capturedAt: _a, metricsComputedAt: _b, ...first} = before.terminal!;
    const {capturedAt: _c, metricsComputedAt: _d, ...second} = after.terminal!;
    expect(second).toEqual(first);
    expect(after.challenge!.criteria).toEqual(before.challenge!.criteria);
    expect(after.challenge!.predictions).toEqual(before.challenge!.predictions);
  }
  const oldRow = {...rows[0]![1]!, ownerId: "learner"}, newRow = {...rows[1]![1]!, ownerId: "learner"}, snapshot = structuredClone(oldRow);
  expect(buildRunReport(oldRow)).toEqual(buildRunReport(oldRow, buildRegistry([old])));
  expect(learningAttempt(oldRow)).toMatchObject({version: 1, status: "met", latestVersion: 2, canRetry: true});
  expect(improvementSource(oldRow, id).definition).toBe(old);
  const lessons = [LEARNING_REGISTRY.findLesson(id)!];
  expect(deriveLessonProgress("learner", lessons, [oldRow])[0]).toMatchObject({activity: "attempted", fromEarlierVersion: true, earlierVersionRequirementsMet: true});
  expect(deriveLessonProgress("learner", lessons, [oldRow, newRow])[0]).toMatchObject({activity: "requirements-met", attempts: 2, currentChallengeVersion: 2});
  expect(deriveLessonProgress("someone-else", lessons, [oldRow, newRow])[0]!.attempts).toBe(0);
  expect(classifyComparison(oldRow, newRow).challengeConditions).toBe("different");
  for (const change of [{terminalSnapshot: null}, {challengeSpecHash: oldHash}, {challengeVersion: 99}, {challengePrediction: null}]) {
    const bad = {...newRow, ...change};
    expect(buildRunReport(bad).challenge!.status).not.toBe("met");
    expect(deriveLessonProgress("learner", lessons, [bad])[0]!.activity).toBe("attempted");
  }
  expect(oldRow).toEqual(snapshot);
  console.info("Queue report text versions", JSON.stringify(reports.map(pair => pair.map(report => ({version: report.challenge!.version,
    status: report.challenge!.status, queue: report.terminal!.resources.find(r => r.id === "queue"), callers: report.terminal!.traffic!.wholeRun})))));
});

test("saved report renders real ready depth and age while absent or empty age remains Unknown", async () => {
  const before = reports[1]![0]!, after = reports[1]![1]!;
  const queue = (r: RunReport) => r.terminal!.resources.find(r => r.id === "queue")!;
  expect(queue(before).asyncQueue!.readyDepth).toBe(88);
  expect(queue(before).asyncQueue!.oldestReadyAgeSeconds!).toBeGreaterThan(10);
  expect(queue(after).asyncQueue).toMatchObject({readyDepth: 0, oldestReadyAgeSeconds: null});
  const absent = structuredClone(before); delete queue(absent).asyncQueue;
  const missing = structuredClone(after); delete queue(missing).asyncQueue; delete queue(missing).queueWork;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import {createElement as h} from "react";
    import {renderToStaticMarkup} from "react-dom/server";
    import {ReportMeasurements} from "./src/features/reports/components/ReportMeasurements";
    console.log(JSON.stringify((await Bun.stdin.json()).map(report => renderToStaticMarkup(h(ReportMeasurements, {report, number:1})))));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify([before, after, absent, missing])); child.stdin.end();
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({code, stderr}).toEqual({code: 0, stderr: ""});
  const markup = JSON.parse(stdout) as string[];
  const age = queue(before).asyncQueue!.oldestReadyAgeSeconds!.toLocaleString(undefined, {maximumFractionDigits: 6});
  expect(markup[0]).toContain(`<dt>Oldest ready message age (seconds)</dt><dd>${age}</dd>`);
  expect(markup[0]).toContain("<dt>Ready messages</dt><dd>88</dd>");
  expect(markup[1]).toContain("<dt>Ready messages</dt><dd>0</dd>");
  for (const index of [1, 2]) expect(markup[index]).toContain("<dt>Oldest ready message age (seconds)</dt><dd>Unknown</dd>");
  expect(markup[2]).toContain("<dt>Ready messages</dt><dd>Unknown</dd>");
  expect(markup[3]).not.toContain("Queue measurements for queue");
  // The queue-work requirement still omits age; it is a separate report reading.
  expect(before.challenge!.criteria.find(c => c.id === "work")!.detail).not.toContain("age");
});
