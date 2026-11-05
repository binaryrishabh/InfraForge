import type { LearningCatalog, LearningLesson, LessonProgress } from "@infraforge/contracts/learning";

// Presentation fixtures: no generated run outcomes or server verdicts are asserted here.
export const reading: LearningLesson = {
  id: "request", contentVersion: 1, trackId: "foundations", moduleId: "routing", title: "What is a request?",
  summary: "A client asks a server to do work.", kind: "reading", level: "beginner", availability: "available",
  prerequisites: [], experiment: null, check: null, problem: ["How does a client ask for a note?"],
  explanation: ["A request carries the operation and its inputs."], limitations: ["This is conceptual; no network traffic is sent."],
};
export const concept: LearningLesson = {
  ...reading, id: "dns", title: "DNS lookup", summary: "Resolve a name before connecting.", kind: "conceptual-exercise", prerequisites: [reading.id],
  check: { question: "What does DNS supply?", choices: [{ id: "address", text: "An address" }, { id: "note", text: "The note body" }],
    correctChoiceId: "address", explanation: "The client uses the address to connect to the service." },
};
export const lab: LearningLesson = {
  ...reading, id: "api-lab", title: "A database lab", summary: "Investigate database pressure.", level: "intermediate", kind: "executable-lab",
  prerequisites: [concept.id], experiment: { challengeId: "first-production-api", prediction: "Which part do you expect to constrain this design?" },
  limitations: ["Inspect the recorded run before drawing a conclusion."], check: concept.check,
};
export const catalog: LearningCatalog = {
  tracks: [{ id: "foundations", title: "Foundations", summary: "Start here.", availability: "available", modules: [
    { id: "routing", title: "Requests and routing", summary: "Follow a request.", availability: "available", lessonIds: [reading.id, concept.id, lab.id] },
  ] }], lessons: [lab, reading, concept], progress: [],
  suggestions: { continue: { lessonId: reading.id, reason: "First lesson in track order; no device reading marks are stored by the server." }, nextLesson: null, reviewCandidates: [] },
};
export const attempted: LessonProgress = {
  lessonId: lab.id, challengeId: lab.experiment!.challengeId, currentChallengeVersion: 2, activity: "attempted", attempts: 1,
  predictionReviewed: false, sameConditionsComparison: false, lastRunId: "run-1", lastAttemptAt: "2026-11-01T00:00:00Z", lastActivityAt: "2026-11-01T00:01:00Z",
  fromEarlierVersion: false, earlierVersionRequirementsMet: false, improvement: null,
};
