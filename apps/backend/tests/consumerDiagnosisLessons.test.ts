import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { evidenceLabels, learningMeasurement, LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { learningContent } from "../learning/content";
import { asyncAndDependencies, asyncAndDependenciesLessons } from "../learning/content/diagnosis/async-and-dependencies";
import { LEARNING_REGISTRY } from "../learning/registry";
import { checkLearningAuthoring } from "../learning/authoring";
import { checkLessonClaims } from "../learning/claims";
import { validateLearningContent } from "../learning/validate";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { definition } from "./challengeHarness";
import { specHash } from "../challenges/registry";

const [conceptual, lab] = asyncAndDependenciesLessons as [typeof asyncAndDependenciesLessons[number], typeof asyncAndDependenciesLessons[number]];

test("consumer diagnosis module: available lab and conceptual dependency exercise use canonical registration and valid prerequisites", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(checkLearningAuthoring(learningContent).labs).toBeGreaterThan(0);
  expect(LEARNING_REGISTRY.findTrack("diagnosis")!.modules.find(m => m.id === asyncAndDependencies.id)).toEqual(asyncAndDependencies);
  expect(LEARNING_REGISTRY.listLessons({trackId: "diagnosis", moduleId: asyncAndDependencies.id})).toEqual(asyncAndDependenciesLessons);
  expect(asyncAndDependencies.lessonIds).toEqual(asyncAndDependenciesLessons.map(l => l.id));
  expect(asyncAndDependencies.lessonIds).toEqual(["locate-the-missing-wait", "diagnose-consumer-credit"]);
  expect(lab).toMatchObject({contentVersion: 1, kind: "executable-lab", availability: "available", experiment: {challengeId: lab.id}, check: null});
  expect(conceptual).toMatchObject({contentVersion: 1, kind: "conceptual-exercise", availability: "available", experiment: null});
  for (const lesson of asyncAndDependenciesLessons) {
    expect(LEARNING_REGISTRY.findLesson(lesson.id)).toEqual(lesson);
    for (const id of lesson.prerequisites) expect(LEARNING_REGISTRY.findLesson(id)).not.toBeNull();
    expect(lesson.limitations.length).toBeGreaterThan(1); expect(lesson.followUp!.length).toBeGreaterThan(0);
  }
  expect(lab.explanation[0]).toContain("before editing"); expect(lab.explanation[1]).toContain("diagnosis first");
  expect(lab.explanation[2]).toContain("Change only"); expect(lab.explanation[3]).toContain("wrong fix");
  expect(lab.limitations.join(" ")).toContain("slow consumer"); expect(lab.limitations.join(" ")).toContain("live-panel");
  expect(conceptual.explanation.join(" ")).toContain("path-specific");
  expect(conceptual.check!.correctChoiceId).toBe("phases");
});

test("consumer diagnosis: reviewed identity and every evidence label resolve to existing saved renderers", () => {
  const d = definition(lab.id);
  expect(REVIEWED_CHALLENGES[`${lab.id}@1`]).toEqual({challengeId: d.id, version: 1, hash: specHash(d)});
  expect(checkLessonClaims(lab, d)).toEqual([]); expect(checkLessonClaims(conceptual)).toEqual([]);
  for (const label of lab.experiment!.evidenceToInspect!.flatMap(evidenceLabels)) {
    const measurement = learningMeasurement(label)!; expect(measurement).not.toBeNull();
    expect(readFileSync(new URL(`../../../${measurement.source}`, import.meta.url), "utf8")).toContain(measurement.marker);
  }
  expect(LEARNING_REPORT_MEASUREMENTS["Queue: acknowledged"].path).toBe("queueWork.acknowledged");
  const isolated = {tracks: [{...LEARNING_REGISTRY.findTrack("diagnosis")!, modules: [asyncAndDependencies]}],
    lessons: asyncAndDependenciesLessons.map(l => ({...l, prerequisites: []}))};
  expect(() => checkLearningAuthoring(isolated, {})).toThrow("missing challenge review");
  expect(checkLearningAuthoring(isolated)).toMatchObject({lessons: 2, labs: 1});
});

test("consumer diagnosis: age, worker phases and per-path waits remain unaudited; queue labels require saved requirement rendering", () => {
  const d = definition(lab.id);
  for (const label of ["Oldest ready message age (seconds)", "oldestReadyAgeSeconds", "Worker phase", "Active workers", "App slot holding time", "Per-path pool wait"]) {
    expect(learningMeasurement(label)).toBeNull();
    const bad = structuredClone(lab); bad.experiment!.evidenceToInspect = [label];
    expect(checkLessonClaims(bad, d).join("\n")).toContain(`report does not render measurement ${label}`);
  }
  const noQueue = {...d, criteria: d.criteria.filter(c => c.kind !== "queue-work")};
  expect(checkLessonClaims(lab, noQueue).join("\n")).toContain("without a queue-work requirement");
  const report = readFileSync(new URL("../../web/src/features/reports/components/ReportMeasurements.tsx", import.meta.url), "utf8");
  expect(report).not.toContain("AsyncQueueReadings"); expect(report).not.toContain("oldestReadyAgeSeconds");
  const live = readFileSync(new URL("../../web/src/features/canvas/components/inspector/AsyncSection.tsx", import.meta.url), "utf8");
  expect(live).toContain('"oldestReadyAgeSeconds", "Oldest ready message age (seconds)"');
});
