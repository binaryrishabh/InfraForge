import { expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { LearningCatalog, LearningLessonDetail } from "@infraforge/contracts/learning";
import { LearningList } from "../src/features/learning/LearningPage";
import { LessonBody, LessonView } from "../src/features/learning/LessonPage";
import { ContinueLearning } from "../src/features/learning/ContinueLearning";
import { ReportLessonContent } from "../src/features/learning/ReportLesson";
import { LessonActivityContent, LessonComparisonContent } from "../src/features/learning/LessonActivity";
import { EMPTY_FILTERS } from "../src/features/learning/discovery";
import { attempted, catalog, concept, lab, reading } from "./learningFixtures";

// Captured before moving decisions out of components. These snapshots include
// all tags, attributes, classes and copy; extraction must preserve them exactly.
const ready = <T,>(data: T | null) => ({ data, loading: false, error: null, retry() {} });
const detail = (lesson = reading): LearningLessonDetail => ({ lesson, progress: null, challenge: lesson.kind === "executable-lab"
  ? { id: lesson.experiment.challengeId, version: 2, specHash: "a".repeat(64), title: "First production API", summary: "Try the design.", evaluationSeconds: 120, requirementCount: 4, executable: true } : null });
const body = (data = detail(), answer: string | null = null, storageAvailable = true, read = false, links: LearningCatalog | null = catalog) =>
  <LessonBody detail={data} catalog={links} local={{ read, answer }} storageAvailable={storageAvailable} onLocal={() => {}} onOpen={() => {}} busy={false} />;
const list = (data = catalog, search = "") => <LearningList {...ready(data)} filters={{ ...EMPTY_FILTERS, search }} onFilters={() => {}} />;
const reviewCatalog = { ...catalog, progress: [attempted], suggestions: { ...catalog.suggestions,
  reviewCandidates: [{ lessonId: lab.id, reason: "Inspect the recorded attempt." }, { lessonId: "hidden", reason: "Never show this." }] } };
const cases: Record<string, ReactNode> = {
  catalog: list(), reviews: list(reviewCatalog), filtered: list(catalog, "dns"), "no-matches": list(catalog, "missing"),
  empty: list({ ...catalog, tracks: [], lessons: [] }),
  loading: <LearningList {...ready(catalog)} loading filters={EMPTY_FILTERS} onFilters={() => {}} />,
  error: <LearningList {...ready<LearningCatalog>(null)} error="Offline" filters={EMPTY_FILTERS} onFilters={() => {}} />,
  reading: body(), concept: body(detail(concept)), correct: body(detail(concept), "address", true, true),
  incorrect: body(detail(concept), "note", false), "invalid-answer": body(detail(concept), "removed-choice"),
  lab: body(detail(lab)), "lab-unavailable": body({ ...detail(lab), challenge: null }),
  "lab-recorded": body({ ...detail(lab), progress: attempted }), "links-unavailable": body(detail(lab), null, true, false, null),
  "lesson-loading": <LessonView {...ready<LearningLessonDetail>(null)} loading catalog={ready(catalog)} />,
  "lesson-error": <LessonView {...ready<LearningLessonDetail>(null)} catalog={ready(catalog)} />,
  continue: <ContinueLearning {...ready(catalog)} />,
  "continue-empty": <ContinueLearning {...ready({ ...catalog, suggestions: { continue: null, nextLesson: null, reviewCandidates: [] } })} />,
  followup: <ReportLessonContent {...ready({ ...detail(lab), lesson: { ...lab, followUp: "Explain the recorded limits." } })} />,
  "followup-empty": <ReportLessonContent {...ready(detail(reading))} />,
  "activity-empty": <LessonActivityContent {...ready(null)} />,
  "comparison-empty": <LessonComparisonContent {...ready(null)} />,
};
for (const [name, node] of Object.entries(cases)) test(`presentation remains unchanged: ${name}`, () => {
  expect(renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)).toMatchSnapshot();
});
