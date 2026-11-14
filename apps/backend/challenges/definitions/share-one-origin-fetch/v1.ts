import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const shareOneOriginFetchV1: ChallengeDefinition = {
  engine: "2", id: "share-one-origin-fetch", version: 1, title: "Share one origin fetch", difficulty: "core",
  summary: "Duplicate refills compete on a constrained origin response link. Reduce lost callers without extending the cache lifetime.",
  concepts: ["CDN coalescing", "Origin load", "Freshness requirement", "One-change experiments"],
  story: ["A CDN serves one object to an average of 400 readers a second, arriving at random moments. Its TTL must stay at one second. Just after second 1, the scenario limits the origin response link to 2,000,000 bytes/s for 28 seconds.",
    "Readers that miss during a refill start separate fetches. Their responses compete on that link, and callers fail even though the origin still has CPU. Compare the origin requests, fills and cumulative caller outcomes."],
  objective: "Through second 30, complete 10500 callers with at most 50 unsuccessful and send at most 45 origin requests, keeping TTL at one second or less. Change one setting.",
  workload: {targetThroughput: 24000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "heavy", workloadDynamics: {version: 1, arrivalProcess: "poisson", applicationCpuCv: 0}},
  workloadNote: "400 reads/s on average at Poisson times; 262144 transport bytes/message, 1024 stored bytes. No writes or purges.",
  evaluationSeconds: 30, evaluationNote: "Caller outcomes and origin requests are cumulative through second 30. The origin link restores just after second 29; terminal health cannot erase earlier failures.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "origin", kind: "cdn-origin-load", label: "At most 45 origin requests by second 30 with a TTL of one second or less", resourceId: "cdn", maxOriginRequests: 45, maxTtlSeconds: 1},
    {id: "callers", kind: "caller-outcomes", label: "Complete 10500 callers with at most 50 unsuccessful through second 30", minCompleted: 10500, maxUnsuccessful: 50}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 30 after the origin link restores? Does that reveal earlier failed callers?"}],
  hints: ["Read whole-run failed callers beside origin requests and fills. Check the recorded bandwidth action: spare origin CPU does not prove that its response link has spare capacity.",
    "Doubling the TTL reduces duplicate work, but still misses the caller budget here and violates the stated TTL bound. More stored-data capacity does not change the constrained link.",
    "Inspect how the CDN handles concurrent misses for the same key. Can waiting readers use a fetch already in progress? Hold TTL, resource sizes and the scenario fixed."],
  debrief: ["Independent fills send duplicate responses onto the constrained link. Coalescing lets overlapping readers share a fetch, reducing origin work and failed callers. It does not remove all failures in this run. The final health label is not a record of earlier success.",
    "Doubling TTL is a plausible near miss: it reduces failures but still exceeds the caller limit and violates the TTL bound. Much longer TTLs can solve caller loss while failing the stated TTL objective. The older TTL-only policy also shares fills by default; the explicit switch isolates that behavior here.",
    "This is a transport-contention experiment, not a storage-capacity failure. The assumed transport payload is larger than the stored object; object response-body counters do not measure link bytes. Shared waiters can have a higher whole-run latency tail even while fewer callers fail. Geographic edges, mutable-object freshness, purges and provider behavior are not verified.", MODEL_NOTE],
  starter: starter([["cdn", "CDN", 0, 0, {cdnCachePolicy: {version: 2, ttlSeconds: 1, coalesce: false}}],
    ["store", "Object Storage", 1, 0]], [["cdn", "store"]]),
  scenario: {version: 1, visibility: "revealed", steps: [{id: "origin-bandwidth", atSecond: 1,
    request: {interventionId: "bandwidth", revision: 1, target: {edgeId: "cdn-store", direction: "response"}, parameters: {bandwidth: 2000000, duration: 28}}}]},
};
