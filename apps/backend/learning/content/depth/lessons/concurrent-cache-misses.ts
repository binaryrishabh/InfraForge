import type { LearningLesson } from "@infraforge/contracts/learning";

export const concurrentCacheMisses: LearningLesson = {
  id: "concurrent-cache-misses", contentVersion: 1, trackId: "depth", moduleId: "failure-controls",
  title: "Share work while a cache fill is pending", kind: "reading", level: "intermediate", availability: "available",
  summary: "Separate room for a cached value from coordination while that value is missing.",
  prerequisites: ["cache-hits-and-misses"], experiment: null,
  problem: ["Several reads miss the same key before its first source fetch finishes. Does extra cache space prevent repeated source work?"],
  explanation: ["Cache capacity holds completed values. During a cold start or after expiry, a value may still be missing while its source fetch is in progress. Independent misses can start overlapping reads even when every key fits.",
    "Single-flight lets overlapping requests for the same key wait on an existing fetch within a coordinating owner. The first fetch still pays its source latency, and waiting requests share its outcome. Different keys need separate work.",
    "Coordination has a boundary. Separate application replicas can own separate in-progress maps. Sharing a result in one owner does not establish a distributed lock or a freshness policy."],
  check: {question: "What does Single-flight change while a value is missing?", choices: [
    {id: "space", text: "It creates more space for completed cache entries."},
    {id: "join", text: "It lets same-key requests join an in-progress fetch in its owner."}],
    correctChoiceId: "join", explanation: "Storage capacity and coordination of unfinished fetches are separate controls."},
  limitations: ["This reading establishes no measured reduction. The linked lab uses a read-only key and one aside owner; it tests no cross-replica lock, freshness or exactly-once guarantee."],
  followUp: "Explain why both a larger cache and Single-flight might matter, but solve different constraints.",
};
