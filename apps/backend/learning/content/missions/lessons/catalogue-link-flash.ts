import type { LessonDefinition } from "@infraforge/contracts/learning";

export const catalogueLinkFlash: LessonDefinition = {
  id: "catalogue-link-flash", contentVersion: 1, trackId: "missions", moduleId: "first-applications",
  title: "Serve a flash of popular links", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Combine app headroom with cache working-set capacity in a read-only catalogue with a fixed burst.",
  prerequisites: ["where-does-the-time-go", "leave-room-for-a-burst", "move-reads-off-the-writer"],
  problem: ["A sixteen-key catalogue routes through DNS, a load balancer, an app and a database-backed cache. Its read-only traffic rises from 200 to 800 requests/second at 120 until 140. The mission evaluates at 125.",
    "Fixed requirements: Healthy modeled overall health and completed-request p95 at most 4.5 ms in second 125. Educational assumptions: 3 ms app CPU/read, 1 ms database CPU/miss, one initial app core, a one-entry logical cache and a 60-second TTL."],
  explanation: ["Predict health and run the starter. Trace the request path. Inspect app CPU, database CPU, completions and failed or unfinished callers; an idle database can also mean requests never reached it.",
    "Use the earlier bottleneck and burst lessons to change only app to c5.xlarge. Run and compare. Then restore the starter and change only cache logical capacity from one entry to sixteen. Predict which requirement each partial design still misses.",
    "Combine both changes, keeping workload, topology, TTL, database and its fixed hot-key pattern unchanged. Compare the three designs with the starter. Explain why cache capacity and app capacity solve different parts of the mission.",
    "Observe live cache hit, miss and eviction counters if useful. Saved reports retain database CPU and caller latency, but do not retain those cache counters; cite only measurements present in the report."],
  experiment: {challengeId: "catalogue-link-flash", prediction: "Can app headroom alone satisfy the latency requirement, and can cache capacity alone execute the app's burst CPU demand?",
    evidenceToInspect: ["Second-125 completed-request p95 and completed/failed requests per second", "App CPU and modeled health alongside database CPU at the same evaluation second",
      "Whole-run completed, failed and in-flight caller populations; captured app size and cache capacity for each controlled comparison"]},
  limitations: ["The read path can suggest a redirect service, but this mission does not verify unique-ID generation, URL validation, redirect HTTP codes or key-value semantics.",
    "The engine uses sixteen keys and its fixed hot-key access pattern. The flash increases arrival rate; it does not change the popularity distribution or reproduce arbitrary real cache workloads. Writes and mutable-data correctness are untested.",
    "Second-125 p95 covers successful completions in that second, not the whole flash or run. Terminal health does not prove continuous health, DNS failover or production availability. Cache counters are live-only in this report format.",
    "CPU, network and tier capacities are educational assumptions. This is not a provider benchmark, price recommendation or interview assessment."],
  followUp: "Explain both partial failures using their saved reports, then cite the combined result. Name an application-correctness question that the model cannot answer.",
  check: {question: "Does a passing catalogue mission prove a redirect service generates unique IDs?", choices: [{id: "no", text: "No; only the modeled read path was tested"}, {id: "yes", text: "Yes; low latency proves ID uniqueness"}],
    correctChoiceId: "no", explanation: "The model executes infrastructure demand and keyed reads. It does not implement or verify a unique-ID generator."},
};
