import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const keepAnAssetCachedV1: ChallengeDefinition = {
  engine: "2", id: "keep-an-asset-cached", version: 1, title: "Keep an asset cached", difficulty: "starter",
  summary: "Keep one already filled asset reusable while its object-store origin is unavailable.",
  concepts: ["CDN TTL", "Origin fetches", "Expiry", "Caller outcomes"],
  story: ["A CDN receives two reads per second for one unchanged, preloaded 1024-byte object. The cache starts empty and fills from store. Its one-second TTL starts at each successful fill; hits do not extend that lifetime.",
    "At second 2, store crashes for 30 seconds. The CDN keeps running. There are no writes or purges. Decide whether the cached object will still be usable while the origin is unavailable."],
  objective: "Complete at least 60 original callers with no unsuccessful callers through second 32. Change only the CDN TTL.",
  workload: {targetThroughput: 120, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Authored: two read-only requests/s for the same unchanged asset; light payloads, no retries, writes or purges.",
  evaluationSeconds: 32,
  evaluationNote: "Cumulative caller outcomes through second 32, the crash's last active second. This does not score origin recovery or whole-run latency.",
  experiment: {fault: DeploymentChaosNames.Crash, atSimulatedSecond: 2, target: {resourceId: "store", type: "Object Storage"},
    hypothesis: "Can the cached asset serve callers through second 32 even while store remains failed?"},
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "callers", kind: "caller-outcomes", label: "Complete 60 callers without unsuccessful callers through second 32", minCompleted: 60, maxUnsuccessful: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "Will overall health at second 32 still reflect a failed origin even if the CDN serves its cached asset?"}],
  hints: ["Compare saved CDN expirations and origin requests with whole-run completed and failed callers. A cache miss still needs the origin.",
    "Select cdn. In CDN cache, change Cache TTL (seconds) from 1 to 60. Keep the origin, workload and coalescing unchanged.",
    "Try 10 seconds as a near miss. It extends reuse, but does not cover the observation window. A longer TTL cannot refresh mutable data or repair store."],
  debrief: ["The longer fill-based TTL keeps the one unchanged object reusable during this bounded origin outage. Compare cumulative saved expirations, stored fills and origin requests to caller outcomes. CDN internal counts are separate populations from original callers.",
    "The origin remains failed at evaluation; serving a cached asset does not restore it. This exercise requires caller outcomes, not Healthy overall status. A ten-second TTL still expires while the origin is unavailable.",
    "Coalescing shares an in-progress same-key origin fetch. It cannot make an unavailable origin answer. Purges are not scheduled here: internal epoch and key-generation fences prevent pre-purge fills from repopulating the cache, while their existing waiters can still receive the replies.",
    "No stale serving beyond TTL, geographical edges, propagation, writes or freshness requirement is modeled here. Waiter-capacity refusal totals and purge epoch values remain Unknown. This is no availability guarantee or general TTL recommendation.", MODEL_NOTE],
  starter: starter([["cdn", "CDN", 0, 0, {cdnCachePolicy: {version: 1, ttlSeconds: 1}}],
    ["store", "Object Storage", 1, 0]], [["cdn", "store"]]),
};
