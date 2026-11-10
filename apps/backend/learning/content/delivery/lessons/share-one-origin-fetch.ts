import type { LearningLesson } from "@infraforge/contracts/learning";

export const shareOneOriginFetch: LearningLesson = {
  id: "share-one-origin-fetch", contentVersion: 1, trackId: "delivery", moduleId: "origin-load",
  title: "Share one origin fetch", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Cut a hot object's duplicate origin fetches with coalescing while keeping its freshness requirement.",
  prerequisites: ["request-journey", "cache-hits-and-misses"],
  problem: ["A busy CDN refills a one-second object every second. Run the starter and count how many origin requests that costs."],
  explanation: ["Predict overall health, then read the CDN's origin requests, fills and coalesced requests beside the caller outcomes.",
    "Select cdn and turn on Coalesce concurrent misses. Keep the one-second TTL and the origin unchanged. Compare the two saved reports and confirm one change.",
    "With coalescing, requests that arrive during a refill wait for the fetch already running instead of starting their own, so origin requests fall to about one per expiry.",
    "Restore the starter and raise only the TTL as a near miss. Origin requests fall too, but the object may now be older than the freshness requirement allows, so the objective is not met."],
  experiment: {challengeId: "share-one-origin-fetch", prediction: "Will turning on shared fills change what callers receive, or only what the origin sees?",
    evidenceToInspect: ["CDN: Origin requests", "CDN: Coalesced waiters"]},
  limitations: ["Results are educational model outputs with an assumed large object and request rate, not provider benchmarks or CDN tuning advice.",
    "Callers are served in every variant, so no user-impact claim is made. Geographic edges, purge propagation and stale serving are not modeled.",
    "A reading missing from the report stays Unknown."],
  followUp: "Cite the starter, the coalescing change and the near miss that only raised the TTL. Explain why fewer origin requests alone do not show the freshness requirement is kept. Compare share-a-cache-fill, the same single shared fetch at a cache.",
  check: null,
};
