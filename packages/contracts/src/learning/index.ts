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
}

export type LearningLesson = LessonContent & (
  | { kind: "reading"; experiment: null; check: LearningCheck | null }
  | { kind: "conceptual-exercise"; experiment: null; check: LearningCheck }
  | { kind: "executable-lab"; experiment: { challengeId: string; prediction: string | null }; check: LearningCheck | null }
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
