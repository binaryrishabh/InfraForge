import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { learningContent } from "../learning/content";
import { monitoringLossAndFreshnessV2 as monitoringLossAndFreshness } from "../learning/content/observability/lessons/monitoring-loss-and-freshness-v2";
import { LEARNING_REGISTRY } from "../learning/registry";
import { checkLearningAuthoring } from "../learning/authoring";
import { validateLearningContent } from "../learning/validate";
import { checkLessonClaims } from "../learning/claims";
import { REGISTRY } from "../challenges/registry";

test("observability offers two independent beginner entries before its versioned intermediate concept", () => {
  const lessons = LEARNING_REGISTRY.listLessons({ trackId: "observability" });
  expect(lessons.map(l => [l.id, l.level, l.kind])).toEqual([
    ["what-is-monitoring", "beginner", "reading"],
    ["missing-readings-are-unknown", "beginner", "conceptual-exercise"],
    ["monitoring-loss-and-freshness", "intermediate", "conceptual-exercise"],
    ["move-monitoring-samples", "intermediate", "executable-lab"],
    ["sample-often-enough", "intermediate", "executable-lab"],
    ["scale-on-delivered-samples", "advanced", "executable-lab"],
  ]);
  expect(LEARNING_REGISTRY.findModule("observability", "monitoring-ownership")!.lessonIds).toEqual(lessons.slice(0, 3).map(l => l.id));
  expect(LEARNING_REGISTRY.findModule("observability", "monitoring-throughput")!.lessonIds).toEqual(["move-monitoring-samples", "sample-often-enough"]);
  for (const entry of lessons.slice(0, 2)) {
    expect(entry.prerequisites).toEqual([]);
    expect(entry.experiment).toBeNull();
    expect(checkLessonClaims(entry)).toEqual([]);
    const unsupported = structuredClone(learningContent);
    unsupported.lessons.find(l => l.id === entry.id)!.followUp = "The recorded run completed 99 requests/second.";
    expect(() => checkLearningAuthoring(unsupported)).toThrow("digits-with-units result claim");
  }
  const old = LEARNING_REGISTRY.findLesson("monitoring-loss-and-freshness", 1)!;
  expect(createHash("sha256").update(JSON.stringify(old)).digest("hex")).toBe("cc961dba9f931697124a5edfa0af42c8ebce09612ad3cdb8c326d5501e0358ca");
  expect(lessons[2]).toEqual({ ...old, contentVersion: 2, prerequisites: ["missing-readings-are-unknown"] });
  expect(LEARNING_REGISTRY.findLesson(old.id, 3)).toBeNull();
  expect(lessons.filter(l => l.id === old.id)).toHaveLength(1);
});

test("beginner monitoring vocabulary uses existing saved-report labels and the check preserves missing evidence", () => {
  const reading = LEARNING_REGISTRY.findLesson("what-is-monitoring")!;
  const exercise = LEARNING_REGISTRY.findLesson("missing-readings-are-unknown")!;
  const prose = reading.explanation.join(" ");
  for (const label of ["Monitoring: Generated samples", "Monitoring: Buffered samples", "Monitoring backend: Received samples",
    "Monitoring: Collection age", "Monitoring backend: Measurement age", "Monitoring: Collection freshness state"]) {
    expect([...reading.explanation, ...exercise.explanation].join(" ")).toContain(label);
    expect(LEARNING_REPORT_MEASUREMENTS).toHaveProperty(label);
  }
  expect(prose).toContain("Unknown means the saved reading is missing; zero means a recorded value of zero");
  expect(exercise.check!.correctChoiceId).toBe("unknown");
  expect(exercise.check!.choices.map(c => c.id)).toEqual(["zero", "failed", "unknown"]);
  expect(exercise.check!.explanation).toContain("Unknown is not a measured zero or a failure verdict");
  expect(exercise.followUp).toContain("(monitoring-loss-and-freshness)");
});

test("monitoring lesson is a checked conceptual exercise and refuses invented run claims", () => {
  const l = monitoringLossAndFreshness;
  expect(learningContent.lessons.filter(row => row.id === l.id)).toEqual([l]);
  expect(l.kind).toBe("conceptual-exercise"); expect(l.experiment).toBeNull();
  expect(l.check!.correctChoiceId).toBe("separate");
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(checkLessonClaims(l)).toEqual([]);
  const changed = structuredClone(l);
  changed.followUp = "The recorded run exported 99 samples in 12 seconds.";
  expect(checkLessonClaims(changed).join(" ")).toContain("digits-with-units result claim");
  const content = structuredClone(learningContent);
  content.lessons.find(row => row.id === l.id)!.explanation[0] = "The recorded run shows a complete history.";
  expect(validateLearningContent(content).join(" ")).toContain("non-executable lesson claims simulated results");
});

test("monitoring claim vocabulary requires real report markers and refuses imaginary freshness guarantees", () => {
  const labels = Object.entries(LEARNING_REPORT_MEASUREMENTS).filter(([label]) => label.startsWith("Monitoring"));
  expect(labels).toHaveLength(25);
  const root = new URL("../../../", import.meta.url);
  const reportSource = readFileSync(new URL("apps/web/src/features/reports/components/ReportMeasurements.tsx", root), "utf8");
  expect(reportSource).toContain("<MonitoringReadings");
  for (const [, definition] of labels) expect(readFileSync(new URL(definition.source, root), "utf8")).toContain(definition.marker);
  const original = learningContent.lessons.find(row => row.id === "where-does-the-time-go")!;
  const definition = REGISTRY.latest(original.experiment!.challengeId)!.definition;
  const lab = structuredClone(original);
  lab.experiment!.evidenceToInspect = labels.map(([label]) => label);
  expect(checkLessonClaims(lab, definition)).toEqual([]);
  const content = structuredClone(learningContent);
  content.lessons.find(row => row.id === original.id)!.experiment!.evidenceToInspect = ["Monitoring: Generated samples", "Monitoring backend: Measurement age"];
  expect(() => checkLearningAuthoring(content)).not.toThrow();
  lab.experiment!.evidenceToInspect = ["Monitoring: Complete history", "Monitoring backend: Healthy"];
  expect(checkLessonClaims(lab, definition).join(" ")).toContain("report does not render measurement Monitoring: Complete history");
  expect(checkLessonClaims(lab, definition).join(" ")).toContain("report does not render measurement Monitoring backend: Healthy");
});
