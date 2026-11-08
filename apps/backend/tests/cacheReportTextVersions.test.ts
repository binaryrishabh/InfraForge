import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { learningMeasurement, evidenceLabels } from "@infraforge/contracts/learning";
import { buildRegistry, challengeSeed, findChallenge, latestChallenge, listLatestChallenges } from "../challenges/registry";
import { learningAttempt } from "../challenges/history";
import { improvementSource } from "../challenges/improvements";
import { classifyComparison } from "../comparison/classify";
import { buildRunReport } from "../reports/report";
import { learningContent } from "../learning/content";
import { LEARNING_REGISTRY } from "../learning/registry";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { checkLearningAuthoring } from "../learning/authoring";
import { deriveLessonProgress } from "../learning/progress";
import { answers, attemptRow, REFERENCE } from "./challengeHarness";

const baseline = {
  "families": [
    {
      "id": "reuse-before-expiry",
      "symbol": "reuseBeforeExpiry",
      "track": "data",
      "module": "data/cache-lifetime.ts",
      "changed": [
        "version",
        "debrief.1"
      ]
    },
    {
      "id": "share-a-cache-fill",
      "symbol": "shareACacheFill",
      "track": "depth",
      "module": "depth/failure-controls.ts",
      "changed": [
        "version",
        "hints.2",
        "debrief.1"
      ]
    },
    {
      "id": "catalogue-link-flash",
      "symbol": "catalogueLinkFlash",
      "track": "missions",
      "module": "missions/first-applications.ts",
      "changed": [
        "version",
        "debrief.1"
      ]
    },
    {
      "id": "cache-or-database",
      "symbol": "cacheOrDatabase",
      "track": "architecture",
      "module": "architecture/cross-resource-choices.ts",
      "changed": [
        "version",
        "debrief.1"
      ]
    }
  ],
  "hashes": {
    "reuse-before-expiry": "7eb2268b199d88bf9f961d0638bc98f28aecfac5ea08db66cff6855ba10362c0",
    "share-a-cache-fill": "39cffc8c5eadbe309c710409abe4a0d4f3431b94c05ef9352f95596ef0ae6954",
    "catalogue-link-flash": "2d6afe745f45e31593096d34ae669138f45f2d6dadc2eff02295a71114ca7a6e",
    "cache-or-database": "7e141efce731cbf7f0c531002f8b6b8c4e82af638a63ff05bd45bb667e14c0b0"
  },
  "sources": {
    "challenges/definitions/reuse-before-expiry/v1.ts": "a024305a3c4c5c7d22ba64dd1124542194815d2d071753acf73044fc82e1200d",
    "learning/content/data/lessons/reuse-before-expiry-v2.ts": "26cc98ba6738804736c3d5409465142f9b519169430455da980fbdcd221e78f6",
    "challenges/definitions/share-a-cache-fill/v1.ts": "c1334b3d85c097ba4dace26fce6bf3f79a6e2a9529b62e29dfe39faa703736e9",
    "learning/content/depth/lessons/share-a-cache-fill-v2.ts": "8959fbbfcf4a5e3511fd20247488cec6441d9a69a291d74401d5de32392a6b8e",
    "challenges/definitions/catalogue-link-flash/v1.ts": "2f90ea493f7db536294a0f207a9608c5b462559f736479f581be35948d476958",
    "learning/content/missions/lessons/catalogue-link-flash-v2.ts": "be5401eb9cecba5e55f41608c73abee07748d3b28997b69b470840dca7aec74a",
    "challenges/definitions/cache-or-database/v1.ts": "2880a888b677cb3a3d0094573decc7482e255b1a2ab78edd2af67b7d6d665364",
    "learning/content/architecture/lessons/cache-or-database-v2.ts": "cbb77de69ca6d94b2dfe43528f82c236419e6ff4eb3a0aacd445e4b482ac9282",
    "learning/content/diagnosis/lessons/read-before-changing.ts": "e58ff99aad0ec7139b28c2f66d0c88f54718694a730c051e6179c06c5db53e66"
  }
};
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
function differences(a: unknown, b: unknown, path = ""): string[] {
  if (Object.is(a, b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => differences(left[key], right[key], path ? `${path}.${key}` : key));
  }
  return [path];
}

for (const [file, hash] of Object.entries(baseline.sources)) test(`cache text refresh preserves published source ${file}`, () => {
  expect(createHash("sha256").update(source(`../${file}`)).digest("hex")).toBe(hash);
});

for (const family of baseline.families) {
  const id = family.id, old = findChallenge(id, 1)!, current = findChallenge(id, 2)!;
  test(`${id}: v2 changes only specified guidance and keeps the old definition, pins and hidden reference`, () => {
    expect(differences(old.definition, current.definition)).toEqual(family.changed);
    expect(old.hash).toBe(baseline.hashes[id as keyof typeof baseline.hashes]);
    expect(latestChallenge(id)).toBe(current);
    expect(listLatestChallenges().filter(c => c.definition.id === id)).toEqual([current]);
    expect(validateInfrastructureName(current.definition.title)).toBeNull();
    expect(findChallenge(id, 3)).toBeNull();
    expect(REFERENCE[`${id}-v2`]).toEqual(REFERENCE[id]!);
    for (const entry of [old, current]) expect(source("./challengeAuthoring.test.ts")).toContain(`"${id}@${entry.definition.version}": "${entry.hash}"`);
    expect(current.definition.debrief[1]).toContain("Missing or null");
    expect(current.definition.debrief[1]).toContain("Application helper:");
  });

  test(`${id}: content v3 keeps v2 prose unchanged and binds only the new challenge review`, () => {
    const latest = LEARNING_REGISTRY.findLesson(id)!, prior = LEARNING_REGISTRY.findLesson(id, 2)!;
    expect(latest.contentVersion).toBe(3);
    expect(differences(prior, latest)).toEqual(["contentVersion"]);
    expect(learningContent.archivedLessons).toContainEqual(prior);
    expect(LEARNING_REGISTRY.listLessons({challengeId: id})).toEqual([latest]);
    expect(LEARNING_REGISTRY.findLesson(id, 4)).toBeNull();
    for (const version of [1, 2]) expect(REVIEWED_CHALLENGES[`${id}@${version}`]).toEqual({challengeId: id, version: 1, hash: old.hash});
    expect(REVIEWED_CHALLENGES[`${id}@3`]).toEqual({challengeId: id, version: 2, hash: current.hash});
    const key = `${id}@3`, missing = {...REVIEWED_CHALLENGES}; delete missing[key];
    expect(() => checkLearningAuthoring(learningContent, missing)).toThrow(`${key}: missing challenge review`);
    expect(() => checkLearningAuthoring(learningContent, {...REVIEWED_CHALLENGES, [key]: REVIEWED_CHALLENGES[`${id}@2`]!})).toThrow("moved since contentVersion");
    expect(() => checkLearningAuthoring(learningContent, {...REVIEWED_CHALLENGES, [key]: {...REVIEWED_CHALLENGES[key]!, hash: "0".repeat(64)}})).toThrow("reviewed challenge identity is unavailable or changed");
    for (const label of latest.experiment!.evidenceToInspect!.flatMap(evidenceLabels)) {
      const measurement = learningMeasurement(label)!;
      expect(measurement).not.toBeNull(); expect(source(`../../../${measurement.source}`)).toContain(measurement.marker);
    }
  });

  test(`${id}: real old/new starter/reference runs preserve verdicts and historical report/progress identity`, () => {
    const pairs = [old.definition, current.definition].map(d => [d.starter!, REFERENCE[id]!].map(design => attemptRow(d, design,
      answers(d, {"database-health": "healthy", "overall-health": "healthy", "busiest-type": "Database"}))));
    const reports = pairs.map(rows => rows.map(row => buildRunReport(row)));
    expect(reports.map(rows => rows.map(r => r.challenge!.status))).toEqual([["not-met", "met"], ["not-met", "met"]]);
    expect(challengeSeed(old.definition)).not.toBe(challengeSeed(current.definition));
    const oldRow = {...pairs[0]![1]!, ownerId: "learner"}, newRow = {...pairs[1]![1]!, ownerId: "learner"}, untouched = structuredClone(oldRow);
    expect(buildRunReport(oldRow)).toEqual(buildRunReport(oldRow, buildRegistry([old.definition])));
    expect(learningAttempt(oldRow)).toMatchObject({version: 1, status: "met", latestVersion: 2, canRetry: true});
    expect(improvementSource(oldRow, id).definition).toBe(old.definition);
    const lessons = [LEARNING_REGISTRY.findLesson(id)!];
    expect(deriveLessonProgress("learner", lessons, [oldRow])[0]).toMatchObject({activity: "attempted", fromEarlierVersion: true, earlierVersionRequirementsMet: true});
    expect(deriveLessonProgress("learner", lessons, [oldRow, newRow])[0]).toMatchObject({activity: "requirements-met", attempts: 2, currentChallengeVersion: 2});
    expect(deriveLessonProgress("someone-else", lessons, [oldRow, newRow])[0]!.attempts).toBe(0);
    expect(classifyComparison(oldRow, newRow).challengeConditions).toBe("different");
    for (const change of [{terminalSnapshot: null}, {challengeSpecHash: old.hash}, {challengeVersion: 99}, {challengePrediction: null}]) {
      const bad = {...newRow, ...change};
      expect(buildRunReport(bad).challenge!.status).not.toBe("met");
      expect(deriveLessonProgress("learner", lessons, [bad])[0]!.activity).toBe("attempted");
    }
    expect(oldRow).toEqual(untouched);
    for (const report of reports[1]!) {
      for (const r of report.terminal!.resources) {
        if (r.cache) expect(r.cache.hits).toBeGreaterThanOrEqual(0);
        for (const helper of r.applicationHelpers?.helpers ?? []) expect(helper.databaseFetches).toBeGreaterThanOrEqual(0);
      }
    }
    console.info("Cache text versions", JSON.stringify({id, versions: reports.map(rows => rows.map(r => ({version: r.challenge!.version,
      status: r.challenge!.status, p95: r.terminal!.traffic!.latencyMs.p95, callers: r.terminal!.traffic!.wholeRun,
      caches: r.terminal!.resources.filter(resource => resource.cache).map(resource => ({id: resource.id, ...resource.cache})),
      helpers: r.terminal!.resources.flatMap(resource => resource.applicationHelpers?.helpers ?? [])})))}));
  }, 180000);
}

test("report-first reading versions only its false duration omission and preserves hypothetical missing-evidence guidance", () => {
  const old = LEARNING_REGISTRY.findLesson("read-before-changing", 1)!, current = LEARNING_REGISTRY.findLesson(old.id)!;
  expect(current.contentVersion).toBe(2);
  expect(differences(old, current)).toEqual(["contentVersion", "limitations.2"]);
  expect(learningContent.archivedLessons).toContainEqual(old);
  for (const label of ["Duration: Slot hold", "Duration: Acquired pool wait"]) {
    expect(current.limitations[2]).toContain(label);
    const measurement = learningMeasurement(label)!; expect(measurement).not.toBeNull();
    expect(source(`../../../${measurement.source}`)).toContain(measurement.marker);
  }
  expect(current.limitations[2]).toContain("failed, cancelled or pending acquisition waits remain Unknown");
  expect(current.limitations[2]).toContain("ordinary worker phases");
  expect(current.check).toEqual(old.check); expect(current.experiment).toBeNull();
  expect(() => checkLearningAuthoring(learningContent)).not.toThrow();
});
