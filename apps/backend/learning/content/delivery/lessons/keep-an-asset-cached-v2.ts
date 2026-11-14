import type { LearningLesson } from "@infraforge/contracts/learning";

export const keepAnAssetCachedV2: LearningLesson = {
  id: "keep-an-asset-cached", contentVersion: 2, trackId: "delivery", moduleId: "first-cdn",
  title: "Keep an asset cached", summary: "Use fill-based TTL to reason about one cached asset during an origin outage.",
  kind: "executable-lab", level: "beginner", availability: "available",
  prerequisites: ["request-journey", "cache-hits-and-misses"],
  problem: ["A CDN serves the same unchanged asset. Its origin crashes after the initial fill. The starter expires cached content quickly, so later misses need the unavailable origin. Complete at least 60 original callers with no unsuccessful callers through second 32.",
    "Predict how the CDN can keep serving this asset while the origin remains failed. Keep the workload and topology fixed and compare a TTL-only change."],
  explanation: ["Run the starter. Inspect CDN: Expirations, CDN: Origin requests and whole-run caller failures. Expiry removes a reusable entry; a miss then needs a new origin fetch. Hits do not restart the entry's TTL.",
    "Select cdn. Under CDN cache, change Cache TTL (seconds) to 60. Run again. Compare saved CDN hits, stored fills and expirations with completed, failed and in-flight original callers. The counts have different owners; do not add origin fetches and coalesced waiters to caller completions.",
    "Try the shorter TTL suggested in the challenge as a near miss. Explain why longer reuse alone does not cover the whole observation window. In the calibrated runs a TTL of 30 seconds, the length of the outage, still leaves one caller unsuccessful and fails the requirement; 31 seconds meets it with one request still in flight at second 32, and 60 completes every caller. Overall health can still reflect the failed origin even when this asset is served.",
    "Coalescing joins requests to an existing same-key fetch; it cannot supply an answer from an unavailable origin. This lab schedules no purge. A purge can also fence an older in-progress fill from repopulating the cache; its existing waiters may still receive the origin reply."],
  experiment: {challengeId: "keep-an-asset-cached", prediction: "Will a longer TTL keep the asset reusable through evaluation while the origin remains failed?",
    evidenceToInspect: ["CDN: Hits; CDN: Misses", "CDN: Stored fills; CDN: Expirations", "CDN: Origin requests; CDN: Coalesced waiters", "Whole run: Completed; Whole run: Failed; Whole run: In-flight", "Overall health"]},
  limitations: ["Results are educational model outputs. This model uses one unchanged preloaded asset and one CDN resource. It does not model geographical edge populations, propagation, writes or a mutable-data freshness requirement. These timings are not provider benchmarks.",
    "This lab tests cumulative caller outcomes in a bounded outage. It does not establish origin recovery, continuous Healthy status, a whole-run latency objective or production availability. Content is not served after its TTL expires.",
    "The saved report retains cumulative CDN counts, not request-level traces. Purge epochs and aggregate waiter-capacity refusals remain Unknown. Purged entries are removed entries, not a count of purge actions; stale fills fenced are cache insertions prevented, not replies withheld from waiters."],
  followUp: "Use both reports to explain expiry, origin fetches and caller failures. Name a freshness requirement that could make a longer TTL inappropriate, and explain why repairing the origin is still necessary.",
  check: null,
};
