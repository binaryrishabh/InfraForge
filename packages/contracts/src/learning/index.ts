/** Source-authored learning content. Prerequisites advise; they never lock a lesson. */
export type LessonKind = "reading" | "conceptual-exercise" | "executable-lab";
export type LearningLevel = "beginner" | "intermediate" | "advanced";
export type LearningAvailability = "available" | "draft";

export interface LearningCheck {
  question: string;
  choices: { id: string; text: string }[];
  correctChoiceId: string;
  explanation: string;
}

interface LessonContent {
  id: string;
  contentVersion: number;
  trackId: string;
  moduleId: string;
  title: string;
  summary: string;
  level: LearningLevel;
  availability: LearningAvailability;
  prerequisites: string[];
  problem: string[];
  explanation: string[];
  limitations: string[];
  followUp?: string;
}

export type LearningLesson = LessonContent & (
  | { kind: "reading"; experiment: null; check: LearningCheck | null }
  | { kind: "conceptual-exercise"; experiment: null; check: LearningCheck }
  | { kind: "executable-lab"; experiment: { challengeId: string; prediction: string | null; evidenceToInspect?: string[] }; check: LearningCheck | null }
);

export interface LearningModule {
  id: string;
  title: string;
  summary: string;
  availability: LearningAvailability;
  lessonIds: string[];
}

export interface LearningTrack {
  id: string;
  title: string;
  summary: string;
  availability: LearningAvailability;
  modules: LearningModule[];
}

export interface LearningContent {
  tracks: readonly LearningTrack[];
  /** One current version per lesson id. */
  lessons: readonly LearningLesson[];
  /** Published previous versions, retained for explicit version lookups. */
  archivedLessons?: readonly LearningLesson[];
}

/** Only executable labs have server-derived progress. Reading marks stay on the device. */
export interface LessonProgress {
  lessonId: string;
  challengeId: string;
  currentChallengeVersion: number | null;
  activity: "not-started" | "attempted" | "improved-after-attempt" | "requirements-met";
  attempts: number;
  /** A recorded prediction and a judged attempt; does not assert that a person opened a review. */
  predictionReviewed: boolean;
  /** Two inactive attempts classified with the existing comparison classifier. */
  sameConditionsComparison: boolean;
  /** Most recently started attempt, ordered by createdAt then run id. */
  lastRunId: string | null;
  lastAttemptAt: string | null;
  /** Latest saved update among this lesson's attempts, not a measurement timestamp. */
  lastActivityAt: string | null;
  /** Older attempts remain activity; they cannot meet the current pinned challenge version. */
  fromEarlierVersion: boolean;
  earlierVersionRequirementsMet: boolean;
  /** More requirements met in an evaluated, same-conditions improvement of its recorded source. */
  improvement: { sourceRunId: string; runId: string } | null;
}

export interface LearningSuggestion { lessonId: string; reason: string }
export interface LearningSuggestions {
  nextLesson: LearningSuggestion | null;
  continue: LearningSuggestion | null;
  reviewCandidates: LearningSuggestion[];
}

export type LearningLessonSummary = Pick<LearningLesson,
  "id" | "contentVersion" | "trackId" | "moduleId" | "title" | "summary" | "kind" | "level" | "availability" | "prerequisites" | "experiment" | "limitations">;

export interface LearningCatalog {
  tracks: LearningTrack[];
  lessons: LearningLessonSummary[];
  /** Labs only. No server completion claim for reading or conceptual lessons. */
  progress: LessonProgress[];
  suggestions: LearningSuggestions;
}

export interface LearningChallengeSummary {
  id: string;
  version: number;
  specHash: string;
  title: string;
  summary: string;
  evaluationSeconds: number;
  requirementCount: number;
  executable: boolean;
}

export interface LearningLessonDetail {
  lesson: LearningLesson;
  progress: LessonProgress | null;
  challenge: LearningChallengeSummary | null;
}

/** Device-local reading marks are optional input for web callers, never server completion. */
export function selectLearningSuggestions(tracks: readonly LearningTrack[], lessons: readonly LearningLesson[], progress: readonly LessonProgress[],
  readLessonIds: ReadonlySet<string> = new Set()): LearningSuggestions {
  const available = new Map(lessons.filter((l) => l.availability === "available").map((l) => [l.id, l]));
  const ordered = tracks.filter((t) => t.availability === "available").flatMap((t) => t.modules.filter((m) => m.availability === "available")
    .flatMap((m) => m.lessonIds.flatMap((id) => { const l = available.get(id); return l && l.trackId === t.id && l.moduleId === m.id ? [l] : []; })));
  const byId = new Map(progress.map((p) => [p.lessonId, p]));
  const visible = new Map(ordered.map((l) => [l.id, l]));
  const attemptedOrRead = (id: string) => {
    const lesson = visible.get(id);
    return !!lesson && (lesson.kind === "executable-lab" ? (byId.get(id)?.attempts ?? 0) > 0 : readLessonIds.has(id));
  };
  const next = ordered.find((l) => (l.kind === "executable-lab" ? byId.get(l.id)?.activity !== "requirements-met" : !readLessonIds.has(l.id)) &&
    l.prerequisites.every(attemptedOrRead));
  const nextLesson = next ? { lessonId: next.id, reason: next.kind !== "executable-lab"
    ? "First lesson in track and module order without a device-local reading mark; its prerequisites are attempted or marked read. Reading marks are not stored by the server."
    : next.prerequisites.length
      ? "First lab in track and module order with prerequisites attempted or marked read; its current requirements have not been met."
      : "First lab in track and module order with no prerequisites and no requirements-met result for the current challenge version." } : null;
  const recent = ordered.map((l) => byId.get(l.id)).filter((p): p is LessonProgress => !!p?.lastAttemptAt)
    .sort((a, b) => b.lastAttemptAt!.localeCompare(a.lastAttemptAt!) || b.lastRunId!.localeCompare(a.lastRunId!))[0];
  return {
    nextLesson,
    continue: recent && recent.activity !== "requirements-met"
      ? { lessonId: recent.lessonId, reason: `Your most recent attempt is run ${recent.lastRunId}; this lesson has no requirements-met result for the current challenge version.` }
      : nextLesson,
    reviewCandidates: ordered.flatMap((l) => {
      const p = byId.get(l.id);
      if (!p || !p.attempts || p.activity === "requirements-met") return [];
      return [{ lessonId: l.id, reason: p.earlierVersionRequirementsMet
        ? `An earlier challenge version met its requirements; current version ${p.currentChallengeVersion} has no requirements-met attempt.`
        : `${p.attempts} recorded attempt${p.attempts === 1 ? "" : "s"}; no requirements-met result for the current challenge version.` }];
    }),
  };
}
