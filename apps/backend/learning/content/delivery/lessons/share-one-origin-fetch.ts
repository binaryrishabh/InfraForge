import type { LearningLesson } from "@infraforge/contracts/learning";

export const shareOneOriginFetch: LearningLesson = {
  id: "share-one-origin-fetch", contentVersion: 1, trackId: "delivery", moduleId: "origin-load",
  title: "Share one origin fetch", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Reduce failed callers by sharing duplicate refills across a constrained origin link while holding TTL fixed.",
  prerequisites: ["request-journey", "cache-hits-and-misses"],
  problem: ["A busy CDN loses callers while its origin response link is constrained. The link restores before the run ends. Run the starter and compare cumulative caller loss with duplicate fetches."],
  explanation: ["Predict terminal health, then inspect whole-run completed and failed callers alongside CDN origin requests, fills and coalesced waiters. Read the saved bandwidth action; a healthy origin CPU label does not rule out a constrained response link.",
    "Change only Coalesce concurrent misses on cdn. Keep TTL, sizes and the scenario fixed. Compare saved reports and confirm one change: origin requests and failed callers fall, but the reference still loses some callers.",
    "Independent responses compete on the same link. Shared fills remove duplicate transfers; they do not make the link faster. Compare the whole-run p95 buckets too: waiting together can increase the latency tail even while fewer callers fail.",
    "Restore the starter and double only TTL as a near miss. It reduces lost callers but still misses the caller budget and violates the TTL bound. Try increasing Stored data capacity (MiB) separately; extra storage room does not change this link."],
  experiment: {challengeId: "share-one-origin-fetch", prediction: "Will the final health label reveal caller loss while the origin link was constrained?",
    evidenceToInspect: ["CDN: Origin requests", "CDN: Stored fills", "CDN: Coalesced waiters", "Whole run: Completed", "Whole run: Failed", "Whole run: p95 bucket"]},
  limitations: ["Results use authored transport payloads, bandwidth and arrival timing; they are educational outputs, not provider benchmarks. The stored object size differs from the assumed transport message size, so object response-body counters are not link-byte measurements.",
    "The reference reduces caller harm rather than eliminating it. The experiment measures neither mutable-object freshness nor geographic edges, purge propagation or stale serving.",
    "A much longer TTL can meet the caller budget while violating the stated TTL objective. The older TTL-only policy also shares fills by default; using the explicit switch keeps the intended experiment clear.",
    "A reading missing from the report stays Unknown. A terminal health sample establishes neither continuous health nor recovery time."],
  followUp: "Cite caller loss, origin requests and the recorded link constraint before and after the single change. Explain the longer TTL near miss and the latency tradeoff. Compare share-a-cache-fill, which shares database fills at a cache.",
  check: null,
};
