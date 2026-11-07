import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { learningContent } from "../learning/content";
import { monitoringLossAndFreshness } from "../learning/content/observability/lessons/monitoring-loss-and-freshness";
import { checkLearningAuthoring } from "../learning/authoring";
import { validateLearningContent } from "../learning/validate";
import { checkLessonClaims } from "../learning/claims";
import { REGISTRY } from "../challenges/registry";

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
