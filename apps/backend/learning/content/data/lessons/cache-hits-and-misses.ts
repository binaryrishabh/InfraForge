import type { LearningLesson } from "@infraforge/contracts/learning";

export const cacheHitsAndMisses: LearningLesson = {
  "id": "cache-hits-and-misses",
  "contentVersion": 1,
  "trackId": "data",
  "moduleId": "database-pressure",
  "title": "What a cache miss costs",
  "summary": "Follow a lookup when a cache has a reusable value and when it must fetch one.",
  "kind": "reading",
  "level": "beginner",
  "availability": "available",
  "prerequisites": [
    "database-read-and-write"
  ],
  "experiment": null,
  "problem": [
    "A catalogue looks up a product in a cache before asking its database. What happens when the cache has no reusable value?"
  ],
  "explanation": [
    "A cache keeps values for reuse. In a cache-aside read path, a hit can return a reusable value; a miss requires fetching the value from the underlying source and may then fill the cache.",
    "A miss still pays for the cache lookup and the source work. A cache is therefore not a replacement for source capacity under every workload. A small working set can be reusable; constantly changing keys can keep requiring source work.",
    "Capacity limits how many values can be retained. Eviction makes room; a time-to-live limits reuse duration. A retained value can still be older than the source, so speed and freshness are separate questions."
  ],
  "check": {
    "question": "In this read path, which work is still needed after a miss?",
    "choices": [
      {
        "id": "none",
        "text": "No source work; the absent value is already cached."
      },
      {
        "id": "source",
        "text": "Fetch the value from the underlying source."
      },
      {
        "id": "writer",
        "text": "Send every future write to the cache instead."
      }
    ],
    "correctChoiceId": "source",
    "explanation": "A miss means the cache cannot supply a reusable value. The read must still obtain it from the source in this example."
  },
  "limitations": [
    "This reading uses a cache-aside example. It establishes no hit rate, saved cost or freshness guarantee, and does not verify invalidation or write correctness."
  ],
  "followUp": "Draw the hit and miss paths. Circle the work that remains when every key is new."
};
