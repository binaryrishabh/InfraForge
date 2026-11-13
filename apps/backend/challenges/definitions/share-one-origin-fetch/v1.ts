import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const shareOneOriginFetchV1: ChallengeDefinition = {
  engine: "2", id: "share-one-origin-fetch", version: 1, title: "Share one origin fetch", difficulty: "core",
  summary: "Every time a hot object expires, requests that arrive during the refill each go to the origin. Let them share one fetch.",
  concepts: ["CDN coalescing", "Origin load", "Freshness requirement", "One-change experiments"],
  story: ["A CDN serves one large object to 400 readers a second from an object store. The object must never be older than one second, so its TTL stays at one second.",
    "Each time it expires, readers that arrive while the refill is in flight start their own origin fetch too, so the origin sees extra requests."],
  objective: "Through second 60, send at most 90 requests to the origin while the TTL stays at one second or less. Change one setting.",
  workload: {targetThroughput: 24000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "heavy"},
  workloadNote: "400 read-only requests/s for the same large object, steady. No writes or purges.",
  evaluationSeconds: 60, evaluationNote: "Origin requests are cumulative from the start through second 60.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "origin", kind: "cdn-origin-load", label: "At most 90 origin requests by second 60 with a TTL of one second or less", resourceId: "cdn", maxOriginRequests: 90, maxTtlSeconds: 1}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 60?"}],
  hints: ["Compare the CDN's origin requests with its fills and coalesced requests. Callers complete either way; the origin load is what differs.",
    "Giving the origin more room does not change how many fetches reach it. A longer TTL would cut them but this object must stay fresh within one second.",
    "Select cdn. Turn on sharing of one origin fetch (coalescing). Keep the one-second TTL and the origin unchanged."],
  debrief: ["With coalescing off, each request that misses while a fill is in flight issues its own origin fetch. With it on, they wait for the one fetch already running, so origin requests fall to about one per expiry.",
    "Enlarging the origin store looks like a way to cope with the extra fetches, but it only gives each of them more room; the same duplicate fetches still arrive. Raising the TTL would lower origin load but breaks the one-second freshness requirement. Callers are served in every variant; this lab is about origin load.",
    "Not verified: real CDN behaviour, geographic edges, purge propagation or stale serving. Waiter limits and timings are educational inputs.", MODEL_NOTE],
  starter: starter([["cdn", "CDN", 0, 0, {cdnCachePolicy: {version: 2, ttlSeconds: 1, coalesce: false}}],
    ["store", "Object Storage", 1, 0]], [["cdn", "store"]]),
};
