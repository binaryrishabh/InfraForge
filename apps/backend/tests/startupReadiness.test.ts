import { expect, test } from "bun:test";
import { learningContent } from "../learning/content";
import { validateLearningContent } from "../learning/validate";
import { findLearningLesson, LEARNING_REGISTRY } from "../learning/registry";
import { checkLessonClaims } from "../learning/claims";
import { deriveLessonProgress } from "../learning/progress";
import { startupReportFixture } from "./startupReport.fixture";

test("startup concept is discoverable and its answer follows the real artifact-ready/process-starting interval", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  const lesson = findLearningLesson("a-replica-must-become-ready")!;
  expect(lesson).toMatchObject({kind: "conceptual-exercise", trackId: "scaling", moduleId: "startup-readiness", contentVersion: 1, experiment: null});
  expect(LEARNING_REGISTRY.findTrack("scaling")!.modules.find(m => m.id === lesson.moduleId)!.lessonIds).toContain(lesson.id);
  expect(checkLessonClaims(lesson)).toEqual([]);
  expect(deriveLessonProgress("reader", [lesson], [])).toEqual([]);
  expect(lesson.check!.correctChoiceId).toBe("acquired");
  expect(checkLessonClaims({...lesson, explanation: ["The recorded run serves 999 requests per second."]}).join(" ")).toContain("non-executable lesson");
  const fixture = startupReportFixture(), m = fixture.samples[11]!.metrics.app!.startup!;
  const artifact = m.clients!.find(c => c.id === "app#1/image")!.replicas![0]!;
  const process = m.controllers![0]!.replicas!.find(r => r.id === artifact.target)!;
  expect(artifact.state).toBe("running"); expect(artifact.artifactReadyAtUs).toBeGreaterThan(0);
  expect(process).toMatchObject({state: "starting", listenerReadyAtUs: null, endpointReady: false});
  expect(m.controllers![0]!.desired).toBeGreaterThan(m.controllers![0]!.inService!);
  const final = fixture.samples.at(-1)!.metrics.app!.startup!.controllers![0]!.replicas!.find(r => r.id === artifact.target)!;
  expect(final.listenerReadyAtUs).toBeGreaterThan(artifact.artifactReadyAtUs!);
  expect(final.endpointReady).toBe(true);
  // The earlier lesson's limit concerns its short window, not an absent startup engine/report.
  const initial = findLearningLesson("initial-replicas-and-later-limits")!;
  expect(initial.contentVersion).toBe(1);
  expect(initial.explanation.join(" ")).toContain("This run stops before the first controller evaluation");
  expect(initial.limitations.join(" ")).toContain("no combined scaling-and-retry experiment");
});
