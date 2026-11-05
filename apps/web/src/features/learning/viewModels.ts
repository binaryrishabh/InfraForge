import type { LearningCatalog, LearningLesson, LearningLessonDetail, LearningLessonSummary } from "@infraforge/contracts/learning";
import type { RunComparison, RunReport } from "@infraforge/contracts/reports";
import { challengeConditionsLabel } from "@/features/reports/labels";
import { activityLabel, availableLessons, discoverLessons, discoveryTerms, KIND_LABEL, lessonMode, prerequisiteLessons, type LearningFilters } from "./discovery";
import type { DeviceLessonState } from "./deviceLocal";
import { lessonRunMeasurements } from "./runSummaryData";

export interface LearningRequest<T> { data: T | null; loading: boolean; error: string | null; retry(): void }
type RequestView<T> = { state: "loading" } | { state: "error"; error: string } | { state: "empty" } | { state: "ready"; data: T };
type RequestInput<T> = Pick<LearningRequest<T>, "data" | "loading" | "error">;
export function requestView<T>(request: RequestInput<T>, fallback: string, missing?: "error"): Exclude<RequestView<T>, { state: "empty" }>;
export function requestView<T>(request: RequestInput<T>, fallback: string, missing: "empty"): RequestView<T>;
export function requestView<T>({ data, loading, error }: Pick<LearningRequest<T>, "data" | "loading" | "error">,
  fallback: string, missing: "error" | "empty" = "error"): RequestView<T> {
  if (loading) return { state: "loading" };
  if (error) return { state: "error", error };
  if (!data) return missing === "empty" ? { state: "empty" } : { state: "error", error: error ?? fallback };
  return { state: "ready", data };
}

// Public design/test inventory. A new state needs a rendering case in
// learningRouteStates.test.tsx; those tests compare exact keys at runtime.
export const LEARNING_VIEW_STATES = {
  request: ["loading", "error", "empty", "ready"],
  catalog: ["results", "empty", "no-matches"],
  visibility: ["visible", "draft-hidden"],
  kind: ["reading", "conceptual-exercise", "executable-lab"],
  lab: ["absent", "available", "unavailable"],
  check: ["absent", "unanswered", "correct", "incorrect"],
  storage: ["unused", "saved", "unavailable"],
  prerequisites: ["ready", "unavailable", "missing-reference"],
  catalogLinks: ["loading", "error", "ready"],
  progress: ["not-started", "attempted", "improved-after-attempt", "requirements-met", "earlier-version"],
  activity: ["absent", "recorded", "review-unavailable"],
  comparison: ["unavailable", "available"],
  followup: ["absent", "linked"],
  summary: ["absent", "recorded"],
  suggestion: ["empty", "suggested"],
  runStart: ["quota", "refused"],
} as const;
type ViewState<K extends keyof typeof LEARNING_VIEW_STATES> = typeof LEARNING_VIEW_STATES[K][number];

export function lessonPageView(input: RequestInput<LearningLessonDetail>) {
  const request = requestView(input, "This lesson could not be loaded.");
  switch (request.state) {
    case "loading": return { ...request, destination: "loading" };
    case "error": return { ...request, destination: "unavailable" };
    case "ready": return { ...request, destination: `${request.data.lesson.id}:${request.data.lesson.contentVersion}` };
  }
}

export function changeLearningFilter(filters: LearningFilters, key: keyof LearningFilters, value: string): LearningFilters {
  return { ...filters, [key]: value };
}

export function lessonRowView(lesson: LearningLessonSummary, catalog: LearningCatalog) {
  return { lesson, href: lessonHref(lesson.id), kindLabel: KIND_LABEL[lesson.kind], mode: lessonMode(lesson),
    activity: activityLabel(lesson, catalog.progress.find(p => p.lessonId === lesson.id)) };
}

export function catalogView(catalog: LearningCatalog, filters: LearningFilters) {
  const available = availableLessons(catalog);
  const lessons = discoverLessons(catalog, filters), ids = new Set(lessons.map(l => l.id));
  const visible = new Map(available.map(l => [l.id, l]));
  const trackOptions = catalog.tracks.filter(t => t.availability === "available");
  const tracks = trackOptions.flatMap(track => {
    const modules = track.modules.filter(m => m.availability === "available" && m.lessonIds.some(id => ids.has(id)))
      .map(module => ({ ...module, lessons: lessons.filter(l => l.trackId === track.id && l.moduleId === module.id).map(l => lessonRowView(l, catalog)) }));
    return modules.length ? [{ ...track, modules }] : [];
  });
  const reviews = catalog.suggestions.reviewCandidates.flatMap(suggestion => {
    const lesson = visible.get(suggestion.lessonId);
    return lesson ? [{ lesson, href: lessonHref(lesson.id), reason: suggestion.reason,
      concepts: prerequisiteLessons(lesson, catalog).flatMap(({ lesson: prerequisite }) =>
        prerequisite && prerequisite.kind !== "executable-lab" ? [{ ...prerequisite, href: lessonHref(prerequisite.id) }] : []),
    }] : [];
  });
  const state: ViewState<"catalog"> = lessons.length ? "results" : available.length ? "no-matches" : "empty";
  const visibility: ViewState<"visibility"> = catalog.lessons.some(l => l.availability === "draft") ||
    catalog.tracks.some(t => t.availability === "draft" || t.modules.some(m => m.availability === "draft")) ? "draft-hidden" : "visible";
  return { state, visibility, tracks, trackOptions, reviews,
    resources: [...new Set(available.flatMap(l => discoveryTerms(l, catalog).resources))].sort(),
    countLabel: `${lessons.length} ${lessons.length === 1 ? "lesson" : "lessons"} found`,
    emptyMessage: lessons.length ? null : available.length
      ? "No lessons match these filters. Try another search or clear the filters." : "No lessons are available yet.",
  };
}

export const LESSON_SECTION_TITLES = {
  problem: "Problem", explanation: "Plain explanation", prediction: "Prediction prompt", experiment: "Experiment",
  evidence: "Evidence to inspect", limitations: "Limitations", followUp: "Follow-up", check: "Check question",
} as const;
type LessonSection = keyof typeof LESSON_SECTION_TITLES;
export function lessonSections(kind: LearningLesson["kind"]) {
  const ids: LessonSection[] = ["problem", "explanation", "prediction",
    ...(kind === "executable-lab" ? ["experiment", "evidence"] as const : []), "limitations", "followUp", "check"];
  return ids.map(id => ({ id, title: LESSON_SECTION_TITLES[id] }));
}

export function lessonHref(id: string) { return `/learning/lessons/${encodeURIComponent(id)}`; }
export function selectCheckAnswer(local: DeviceLessonState, answer: string): DeviceLessonState { return { ...local, answer }; }
export function toggleReadMark(local: DeviceLessonState): DeviceLessonState { return { ...local, read: !local.read }; }

export function lessonBodyView(detail: LearningLessonDetail, catalog: LearningCatalog | null, local: DeviceLessonState, storageAvailable: boolean) {
  const { lesson, challenge, progress } = detail;
  const activity = activityLabel(lesson, progress);
  const ordered = catalog ? availableLessons(catalog).filter(l => l.trackId === lesson.trackId) : [];
  const index = ordered.findIndex(l => l.id === lesson.id);
  const next = index >= 0 ? ordered[index + 1] ?? null : null;
  const answer = lesson.check?.choices.find(c => c.id === local.answer)?.id ?? null;
  const authoredEvidence = lesson.kind === "executable-lab" && "evidenceToInspect" in lesson.experiment ? lesson.experiment.evidenceToInspect : undefined;
  const lab = lesson.kind === "executable-lab" ? {
    challengeId: lesson.experiment.challengeId, title: challenge?.title,
    canOpen: lesson.availability === "available" && challenge?.id === lesson.experiment.challengeId && challenge.executable,
    evidence: Array.isArray(authoredEvidence) ? authoredEvidence.filter((item): item is string => typeof item === "string") : [],
  } : null;
  const labState: ViewState<"lab"> = lab ? lab.canOpen ? "available" : "unavailable" : "absent";
  const checkState: ViewState<"check"> = !lesson.check ? "absent" : !answer ? "unanswered" : answer === lesson.check.correctChoiceId ? "correct" : "incorrect";
  const storageState: ViewState<"storage"> = !storageAvailable ? "unavailable" : local.read || answer ? "saved" : "unused";
  const prerequisites = catalog ? prerequisiteLessons(lesson, catalog).map(item => ({ ...item, href: lessonHref(item.id),
    label: item.lesson?.title ?? `Prerequisite unavailable: ${item.id}` })) : null;
  const prerequisiteState: ViewState<"prerequisites"> = !prerequisites ? "unavailable" : prerequisites.some(p => !p.lesson) ? "missing-reference" : "ready";
  return { lesson, kindLabel: KIND_LABEL[lesson.kind], mode: lessonMode(lesson), activity, lab, answer,
    kind: lesson.kind, labState, checkState, storageState, prerequisiteState,
    sections: lessonSections(lesson.kind), next: next ? { ...next, href: lessonHref(next.id) } : null,
    prerequisites,
    prediction: lesson.kind === "executable-lab"
      ? lesson.experiment.prediction ?? "Before running, predict what this design will do under the challenge's fixed conditions. Record your prediction in the existing challenge flow."
      : "Return to the problem. What would you expect to happen, and why? Say your reasoning before moving on.",
    followUp: "followUp" in lesson && typeof lesson.followUp === "string" && lesson.followUp.trim()
      ? lesson.followUp : "Explain the idea in your own words and name one limitation.",
    choices: lesson.check?.choices.map(choice => ({ ...choice, checked: answer === choice.id })) ?? [],
    feedback: answer && lesson.check ? `${checkState === "correct" ? "That matches the explanation. " : "Revisit the explanation. "}${lesson.check.explanation}` : null,
    latestRunId: activity && progress?.lastRunId ? progress.lastRunId : null,
    readLabel: local.read ? "Remove read mark" : "Mark as read",
    storageMessage: !storageAvailable ? "Could not save on this device. Your choices are available for this visit only."
      : local.read || answer ? "Reading mark and check answers: saved on this device." : "Reading marks and check answers can be saved on this device.",
  };
}

export function comparisonView(data: RunComparison | null) {
  if (!data?.available || data.runs.length !== 2 || data.runs[0].id === data.runs[1].id) return null;
  return { href: `/runs/compare?a=${encodeURIComponent(data.runs[0].id)}&b=${encodeURIComponent(data.runs[1].id)}`,
    conditions: challengeConditionsLabel(data.challengeConditions) };
}

export function reportLessonView(data: LearningLessonDetail | null) {
  if (!data || data.lesson.kind !== "executable-lab") return null;
  return { href: lessonHref(data.lesson.id), title: data.lesson.title, followUp: data.lesson.followUp };
}

export function lessonRunSummaryView(report: RunReport, lesson: LearningLesson) {
  if (lesson.kind !== "executable-lab" || report.challenge?.challengeId !== lesson.experiment.challengeId) return null;
  return { result: report.challenge, runId: report.run.id, limitations: lesson.limitations,
    measurements: lessonRunMeasurements(report, lesson.experiment.evidenceToInspect ?? []),
    terminalLabel: report.terminal?.simulatedSeconds === undefined ? "Unknown" : `second ${report.terminal.simulatedSeconds}` };
}
