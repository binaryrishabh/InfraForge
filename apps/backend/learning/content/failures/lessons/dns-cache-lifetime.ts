import type { LearningLesson } from "@infraforge/contracts/learning";

export const dnsCacheLifetime: LearningLesson = {
  "id": "dns-cache-lifetime",
  "contentVersion": 1,
  "trackId": "failures",
  "moduleId": "incident-evidence",
  "title": "What a DNS cache keeps",
  "summary": "Separate a cached name answer from application reachability and recovery.",
  "kind": "conceptual-exercise",
  "level": "beginner",
  "availability": "available",
  "prerequisites": [
    "dns-resolution"
  ],
  "experiment": null,
  "problem": [
    "A DNS answer for a service is cached. The service then stops responding at that address. Does the cached answer establish that the application works?"
  ],
  "explanation": [
    "A DNS cache keeps an answer to a name lookup for reuse during its allowed lifetime. A time-to-live limits how long that answer can be reused without another lookup; it is not a health measurement of the application.",
    "Changing the authoritative answer does not itself replace every cached answer immediately. A client using a still-reusable older answer can continue choosing the earlier destination.",
    "Resolving a name, opening a connection and getting a useful application response are separate steps. To diagnose a failure, ask which answer the client used and which later step failed, instead of treating a successful lookup as end-to-end health."
  ],
  "check": {
    "question": "What does a still-reusable cached DNS answer establish?",
    "choices": [
      {
        "id": "health",
        "text": "The application is healthy throughout its lifetime."
      },
      {
        "id": "replace",
        "text": "Every client has already adopted a changed answer."
      },
      {
        "id": "answer",
        "text": "A prior name-lookup answer can be reused under the cache rules."
      }
    ],
    "correctChoiceId": "answer",
    "explanation": "DNS caching reuses a name answer. It does not continuously test the application or instantly propagate a changed answer."
  },
  "limitations": [
    "This is a conceptual DNS exercise. The current incident labs do not verify DNS cache expiry, failover timing or application recovery."
  ],
  "followUp": "Name one DNS observation and one application observation you would need before describing a recovery."
};

