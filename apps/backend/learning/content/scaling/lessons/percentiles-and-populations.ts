import type { LearningLesson } from "@infraforge/contracts/learning";

export const percentilesAndPopulations: LearningLesson = {
  "id": "percentiles-and-populations",
  "contentVersion": 1,
  "trackId": "scaling",
  "moduleId": "serving-under-load",
  "title": "Read a percentile with its population",
  "summary": "Distinguish a slow response-time tail from failures and unfinished requests.",
  "kind": "conceptual-exercise",
  "level": "intermediate",
  "availability": "available",
  "prerequisites": [
    "response-time-and-throughput"
  ],
  "experiment": null,
  "problem": [
    "A response-time summary lists p50 and p95 for completed requests in one second. Other callers are still waiting. What does that summary leave out?"
  ],
  "explanation": [
    "A percentile describes a position in an ordered set of measurements. p50 describes the middle; p95 describes a slower part of that same set. A low median can coexist with a long slow tail.",
    "Always name the population and interval. A percentile of completed requests excludes callers that have not completed; failures may also be counted separately. A low p95 for completions cannot tell you how many callers gave up.",
    "Comparisons need matching populations and windows. A terminal-second percentile and a whole-run percentile answer different questions; neither can stand in for the other."
  ],
  "check": {
    "question": "What must accompany a p95 of completed requests to assess caller outcomes?",
    "choices": [
      {
        "id": "alone",
        "text": "Only the median; all callers are already included."
      },
      {
        "id": "health",
        "text": "Only a final Healthy label."
      },
      {
        "id": "population",
        "text": "The interval and separate failed and unfinished caller counts."
      }
    ],
    "correctChoiceId": "population",
    "explanation": "A percentile describes its measured completion population. Failed and unfinished callers need separate accounting over a stated interval."
  },
  "limitations": [
    "This is a conceptual interpretation of summaries, not a measured latency result. Percentile estimators and sample sizes can also affect reported values."
  ],
  "followUp": "Write one sentence a terminal-second p95 supports, and one whole-run claim it leaves unanswered."
};

