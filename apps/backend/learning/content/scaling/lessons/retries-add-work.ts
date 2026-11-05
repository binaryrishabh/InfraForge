import type { LearningLesson } from "@infraforge/contracts/learning";

export const retriesAddWork: LearningLesson = {
  "id": "retries-add-work",
  "contentVersion": 1,
  "trackId": "scaling",
  "moduleId": "serving-under-load",
  "title": "Retrying adds another attempt",
  "summary": "Count original callers separately from repeated backend attempts.",
  "kind": "conceptual-exercise",
  "level": "intermediate",
  "availability": "available",
  "prerequisites": [
    "more-users-more-pressure"
  ],
  "experiment": null,
  "problem": [
    "A caller gets no successful response and tries again while new callers keep arriving. What work has disappeared?"
  ],
  "explanation": [
    "A retry is another attempt to do work for an existing caller. It can help after a transient refusal, but it also competes with fresh requests. A retry policy cannot create capacity in an already full worker pool.",
    "Count original callers and backend attempts separately. One caller can produce several attempts, and an attempt can fail without completing useful work. Adding overlapping counters can count the same attempt twice.",
    "Maximum attempts bounds repetition. Backoff spaces attempts; jitter varies their timing. Those choices can reduce concentrated pressure, but neither guarantees more completions. An uncertain write result also raises the question of repeating an effect."
  ],
  "check": {
    "question": "A hundred original callers each make two backend attempts. How should those populations be described?",
    "choices": [
      {
        "id": "attempts",
        "text": "100 callers and 200 backend attempts."
      },
      {
        "id": "callers",
        "text": "200 new callers."
      },
      {
        "id": "success",
        "text": "200 successful completions."
      }
    ],
    "correctChoiceId": "attempts",
    "explanation": "Repeating an attempt does not create another original caller or prove success. Useful completions must be counted separately."
  },
  "limitations": [
    "This exercise predicts no particular retry outcome. Application idempotency and safe write retries are not verified by counting backend attempts."
  ],
  "followUp": "Explain why fewer retries might reduce pressure while leaving some callers unsuccessful."
};

