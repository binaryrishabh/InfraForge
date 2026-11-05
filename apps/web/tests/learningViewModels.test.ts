import { expect, test } from "bun:test";
import { attempted, catalog, concept, lab, reading } from "./learningFixtures";
import type { LearningLessonDetail } from "@infraforge/contracts/learning";
import { EMPTY_FILTERS } from "../src/features/learning/discovery";
import { catalogView, lessonBodyView, lessonRowView, requestView, changeLearningFilter, selectCheckAnswer, toggleReadMark,
  comparisonView, reportLessonView, lessonRunSummaryView } from "../src/features/learning/viewModels";
import type { RunComparison, RunReport } from "@infraforge/contracts/reports";

const detail = (lesson = reading): LearningLessonDetail => ({ lesson, progress: null, challenge: null });
const local = { read: false, answer: null };

test("catalog view groups only matching visible lessons in authored order, with resources independent of filters", () => {
  const input = structuredClone(catalog);
  const view = catalogView(input, { ...EMPTY_FILTERS, search: "dns" });
  expect(view.countLabel).toBe("1 lesson found");
  expect(view.resources).toEqual(["DNS", "Database"]);
  expect(view.tracks[0]!.modules[0]!.lessons.map(row => row.lesson.id)).toEqual([concept.id]);
  expect(view.emptyMessage).toBeNull();
  expect(catalogView(input, { ...EMPTY_FILTERS, search: "missing" }).emptyMessage).toContain("No lessons match");
  expect(catalogView({ ...input, tracks: [] }, EMPTY_FILTERS).emptyMessage).toBe("No lessons are available yet.");
  expect(input).toEqual(catalog);
});

test("review suggestions hide unavailable lessons and include only visible conceptual prerequisites", () => {
  const view = catalogView({ ...catalog, suggestions: { ...catalog.suggestions, reviewCandidates: [
    { lessonId: lab.id, reason: "Keep the server reason." }, { lessonId: "hidden", reason: "Do not show." },
  ] } }, EMPTY_FILTERS);
  expect(view.reviews.map(row => ({ id: row.lesson.id, reason: row.reason, concepts: row.concepts.map(l => l.id) })))
    .toEqual([{ id: lab.id, reason: "Keep the server reason.", concepts: [concept.id] }]);
  expect(lessonRowView(lab, { ...catalog, progress: [attempted] }).activity).toBe("Recorded attempt");
  expect(lessonRowView(reading, catalog).mode).toBe("Conceptual only");
});

test("lesson view owns section order, next lesson, prediction/follow-up defaults and advisory links", () => {
  const view = lessonBodyView(detail(concept), catalog, local, true);
  expect(view.sections.map(section => section.title)).toEqual(["Problem", "Plain explanation", "Prediction prompt", "Limitations", "Follow-up", "Check question"]);
  expect(view.next?.id).toBe(lab.id);
  expect(view.prerequisites).toEqual([{ id: reading.id, lesson: reading, href: "/learning/lessons/request", label: reading.title }]);
  expect(view.prediction).toContain("Say your reasoning");
  expect(view.followUp).toBe("Explain the idea in your own words and name one limitation.");
  expect(lessonBodyView(detail(lab), catalog, local, true).sections.map(s => s.id)).toEqual([
    "problem", "explanation", "prediction", "experiment", "evidence", "limitations", "followUp", "check",
  ]);
  expect(lessonBodyView(detail(lab), catalog, local, true).next).toBeNull();
  expect(lessonBodyView(detail(concept), null, local, true).prerequisites).toBeNull();
  expect(lessonBodyView(detail({ ...reading, id: "unlisted", followUp: "   " }), catalog, local, true).next).toBeNull();
});

test("lab view refuses missing, mismatched, disabled or draft launch targets and filters malformed evidence", () => {
  const lesson = { ...lab, kind: "executable-lab" as const, followUp: "Keep this wording.", experiment: { ...lab.experiment!,
    prediction: null, evidenceToInspect: ["Inspect p95.", 5, null] as unknown as string[] } };
  const challenge = { id: lesson.experiment.challengeId, title: "Lab", version: 2, specHash: "a".repeat(64), summary: "Try it", evaluationSeconds: 120, requirementCount: 4, executable: true };
  const view = lessonBodyView({ lesson, challenge, progress: attempted }, catalog, local, true);
  expect(view.lab?.canOpen).toBe(true); expect(view.lab?.evidence).toEqual(["Inspect p95."]);
  expect(view.prediction).toContain("Before running"); expect(view.followUp).toBe(lesson.followUp);
  expect(view.latestRunId).toBe("run-1");
  for (const target of [null, { ...challenge, id: "wrong" }, { ...challenge, executable: false }]) {
    expect(lessonBodyView({ lesson, challenge: target, progress: null }, catalog, local, true).lab?.canOpen).toBe(false);
  }
  expect(lessonBodyView({ lesson: { ...lesson, availability: "draft" }, challenge, progress: null }, catalog, local, true).lab?.canOpen).toBe(false);
  expect(lessonBodyView({ ...detail(reading), progress: attempted }, catalog, local, true).latestRunId).toBeNull();
});

test("check feedback validates saved choices, and device wording never becomes server progress", () => {
  const view = (answer: string | null, read = false, available = true) => lessonBodyView(detail(concept), catalog, { read, answer }, available);
  expect(view("removed").answer).toBeNull(); expect(view("removed").feedback).toBeNull();
  expect(view("note").feedback).toBe(`Revisit the explanation. ${concept.check!.explanation}`);
  expect(view("address").feedback).toBe(`That matches the explanation. ${concept.check!.explanation}`);
  expect(view(null).storageMessage).toBe("Reading marks and check answers can be saved on this device.");
  expect(view(null, true).storageMessage).toBe("Reading mark and check answers: saved on this device.");
  expect(view("address", true, false).storageMessage).toContain("this visit only");
  expect(view(null, true).readLabel).toBe("Remove read mark");
  expect(selectCheckAnswer(local, "address")).toEqual({ read: false, answer: "address" });
  expect(toggleReadMark({ read: false, answer: "address" })).toEqual({ read: true, answer: "address" });
  expect(local).toEqual({ read: false, answer: null });
});

test("request projection preserves loading precedence, required/optional null and exact errors", () => {
  expect(requestView({ data: catalog, loading: true, error: "Old error" }, "Fallback").state).toBe("loading");
  expect(requestView({ data: null, loading: false, error: null }, "Fallback")).toEqual({ state: "error", error: "Fallback" });
  expect(requestView({ data: null, loading: false, error: null }, "Fallback", "empty")).toEqual({ state: "empty" });
  expect(requestView({ data: catalog, loading: false, error: "Offline" }, "Fallback")).toEqual({ state: "error", error: "Offline" });
  expect(requestView({ data: catalog, loading: false, error: null }, "Fallback")).toEqual({ state: "ready", data: catalog });
  expect(changeLearningFilter(EMPTY_FILTERS, "search", " dns ")).toEqual({ ...EMPTY_FILTERS, search: " dns " });
  expect(EMPTY_FILTERS.search).toBe("");
});

test("comparison and report follow-up projections refuse incomplete and duplicate pairs or non-labs", () => {
  const comparison = { available: true, runs: [{ id: "a" }, { id: "b" }], challengeConditions: null } as RunComparison;
  expect(comparisonView(comparison)?.href).toBe("/runs/compare?a=a&b=b");
  expect(comparisonView(comparison)?.conditions).toBe("Unknown");
  // Deliberately malformed runtime payload: the API type promises two runs.
  const invalidPairs: Array<RunComparison | null> = [null, { ...comparison, available: false },
    { ...comparison, runs: [] as unknown as RunComparison["runs"] }, { ...comparison, runs: [comparison.runs[0], comparison.runs[0]] }];
  for (const value of invalidPairs) {
    expect(comparisonView(value)).toBeNull();
  }
  expect(reportLessonView(detail(reading))).toBeNull();
  expect(reportLessonView(detail(lab))?.href).toBe("/learning/lessons/api-lab");
});

test("run summary is only a matching lab projection; missing terminal remains Unknown", () => {
  const report = { run: { id: "r" }, challenge: { challengeId: lab.experiment!.challengeId, version: 2, criteria: [], status: "unknown", metCount: 0, total: 0 },
    terminal: null, topology: {}, stages: [] } as unknown as RunReport;
  expect(lessonRunSummaryView(report, reading)).toBeNull();
  expect(lessonRunSummaryView({ ...report, challenge: null }, lab)).toBeNull();
  expect(lessonRunSummaryView(report, lab)?.terminalLabel).toBe("Unknown");
  expect(lessonRunSummaryView(report, lab)?.result).toEqual(report.challenge!);
});
