// Real engine evidence for the web loop proof. No database or session is implied.
import assert from "node:assert/strict";
import { selectLearningSuggestions, type LearningCatalog } from "@infraforge/contracts/learning";
import { LEARNING_REGISTRY } from "../../learning/registry";
import { deriveLessonProgress } from "../../learning/progress";
import { buildRunReport } from "../../reports/report";
import { classifyComparison } from "../../comparison/classify";
import { specHash } from "../../challenges/registry";
import { answers, attemptRow, definition, REFERENCE } from "../challengeHarness";

const d = definition("where-does-the-time-go"), lesson = LEARNING_REGISTRY.findLesson(d.id)!;
const source = { ...attemptRow(d, d.starter!, answers(d, { busiest: "Virtual Machine" })), ownerId: "alice",
  id: "10000000-0000-4000-8000-000000000001", createdAt: new Date("2026-11-01T00:00:00Z") };
const improved = { ...attemptRow(d, REFERENCE[d.id]!, answers(d, { busiest: "Database" })), ownerId: "alice",
  id: "10000000-0000-4000-8000-000000000002", createdAt: new Date("2026-11-02T00:00:00Z"),
  improvementSourceId: source.id, learningIntent: "improvement", learningHypothesis: "I expect the app size change to reduce app CPU at the recorded second." };
const tracks = LEARNING_REGISTRY.listTracks(), lessons = LEARNING_REGISTRY.listLessons();
const catalogFor = (rows: typeof source[]): LearningCatalog => {
  const progress = deriveLessonProgress("alice", lessons, rows);
  return { tracks, lessons, progress, suggestions: selectLearningSuggestions(tracks, lessons, progress) };
};
const catalog = catalogFor([source]), laterCatalog = catalogFor([source, improved]);
const detail = { lesson, challenge: { id: d.id, version: d.version, specHash: specHash(d), title: d.title, summary: d.summary,
  evaluationSeconds: d.evaluationSeconds, requirementCount: d.criteria.length, executable: d.engine === "2" },
  progress: catalog.progress.find((p) => p.lessonId === lesson.id)! };
const laterDetail = { ...detail, progress: laterCatalog.progress.find((p) => p.lessonId === lesson.id)! };
const sourceReport = buildRunReport(source), improvedReport = buildRunReport(improved), comparison = classifyComparison(source, improved);
assert.equal(sourceReport.provenance.simulationModelVersion, "2");
assert.equal(sourceReport.guidedReview?.canImprove, true);
assert.equal(comparison.available, true); assert.equal(comparison.challengeConditions, "same");
assert.equal(comparison.designChangeReview?.count, 1);
assert.ok(sourceReport.guidedReview?.cues.length);
console.log(JSON.stringify({ catalog, laterCatalog, detail, laterDetail, sourceReport, improvedReport, comparison,
  design: { id: "10000000-0000-4000-8000-000000000003", userId: "alice", name: d.title,
    layout: { ...d.starter!, layoutVersion: 3 }, createdAt: source.createdAt.toISOString(), updatedAt: source.createdAt.toISOString() } }));
