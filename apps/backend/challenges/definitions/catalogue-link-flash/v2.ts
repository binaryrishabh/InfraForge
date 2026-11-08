import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const catalogueLinkFlashV2: ChallengeDefinition = {
  engine: "2", id: "catalogue-link-flash", version: 2, title: "Mission: popular link flash", difficulty: "advanced",
  summary: "Combine app headroom and cache capacity for a read-only catalogue behind DNS and a load balancer.",
  concepts: ["Request routing", "Burst headroom", "Cache working set", "Database pressure"],
  story: ["A catalogue has sixteen modeled keys with the engine's fixed hot-key access pattern. DNS routes through a load balancer to one app, then a cache backed by a database. Traffic rises from 200 to 800 reads/second at second 120 until 140.",
    "Educational assumptions: each read uses 3 ms of app CPU and a database miss uses 1 ms of database CPU. The small app assumes one core. The cache holds one logical entry with a 60-second TTL. Meet the same fixed requirements by combining capacity choices.",
    "The catalogue can stand in for the read path of a redirect service. Unique-ID generation, URL validation, HTTP redirect codes and key-value semantics are conceptual only; this mission does not verify them."],
  objective: "At second 125, record Healthy overall health and completed-request p95 at most 4.5 ms. Compare app-only and cache-only changes before combining them.",
  workload: {targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "peak", peakMultiplier: 4, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Educational: 200 reads/s; fourfold burst at 120-140; light payloads; sixteen fixed hot-pattern keys, not arbitrary popularity traces.",
  evaluationSeconds: 125, evaluationNote: "Scores completions in second 125 during the burst, not a whole-run SLO. Inspect caller failures and unfinished work too.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "health", kind: "overall-health", label: "Overall modeled health is Healthy at second 125", allowed: ["healthy"]},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 4.5 ms at second 125", maxMs: 4.5}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded during the flash at second 125?"}],
  hints: ["Trace DNS -> load balancer -> app -> cache -> database. Compare app CPU, database CPU and caller completions; one healthy database does not prove enough app headroom.",
    "A larger app cannot hold the catalogue's cache working set. More cache entries cannot execute app CPU work. Test each change separately with the fixed workload.",
    "Try c5.xlarge for app and sixteen logical entries under cache policy. Keep the sixteen-key hot pattern, TTL and database unchanged; compare both partial designs."],
  debrief: ["This mission combines app headroom with cache working-set capacity. Controlled partial designs isolate each setting: app size alone leaves the miss-dependent latency tail; cache capacity alone leaves app CPU overloaded during the flash.",
    "The saved report records database CPU, caller outcomes and second-125 latency alongside cumulative Cache: Hits, Cache: Misses and Cache: Evictions. Application helper: Database fetches records helper source work. Cache commands and helper requests are separate from original callers, so do not invent a caller hit ratio or infer low database CPU alone proves successful requests. Missing or null evidence stays Unknown.",
    "Not verified: ID uniqueness, key-value or redirect semantics, URL safety, mutable-data correctness, arbitrary key distributions, DNS failover, continuous health or availability. Capacity and latency limits are educational inputs, not cloud benchmarks.", MODEL_NOTE],
  starter: starter([["dns", "DNS", 0, 0], ["lb", "Load Balancer", 1, 0], ["app", "Virtual Machine", 2, 0, {size: "small"}],
    ["cache", "Cache", 3, 0, {cachePolicy: {version: 2, capacityEntries: 1}}],
    ["db", "Database", 4, 0, {skuId: "db.t3.micro", dataKeyspace: {version: 1, count: 16, accessPattern: "hot-key"}}]],
  [["dns", "lb"], ["lb", "app"], ["app", "cache"], ["cache", "db"]]),
};
