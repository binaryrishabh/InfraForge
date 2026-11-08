import type { LearningLesson } from "@infraforge/contracts/learning";

export const catalogueLinkFlashV3: LearningLesson = {
  id: "catalogue-link-flash", contentVersion: 3, trackId: "missions", moduleId: "first-applications",
  title: "Serve a flash of popular links", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Combine app headroom with cache working-set capacity in a read-only catalogue with a fixed burst.",
  prerequisites: ["where-does-the-time-go", "leave-room-for-a-burst", "move-reads-off-the-writer", "cache-hits-and-misses", "dns-cache-lifetime"],
  problem: ["A fixed read-only catalogue routes through DNS, a load balancer, an app and a database-backed cache. The challenge pins a flash of traffic and a scored snapshot during that flash.",
    "Read the pinned challenge requirements and educational CPU, working-set and TTL assumptions before changing the app or cache. The terminal p95 requirement covers successful completions in the evaluation second."],
  explanation: ["Predict health and run the starter. Trace the request path. Inspect app CPU, database CPU, completions and failed or unfinished callers; an idle database can also mean requests never reached it.",
    "Use the earlier bottleneck and burst lessons to increase only app capacity using the challenge hint. Run and compare. Then restore the starter and change only cache logical capacity from one entry to sixteen. Predict which requirement each partial design still misses.",
    "Combine both changes, keeping workload, topology, TTL, database and its fixed hot-key pattern unchanged. Compare the three designs with the starter. Explain why cache capacity and app capacity solve different parts of the mission.",
    "Inspect saved Cache: Hits, Cache: Misses and Cache: Evictions alongside Application helper: Database fetches. Use the helper and cache identities to explain source work separately from app CPU and caller outcomes."],
  experiment: {challengeId: "catalogue-link-flash", prediction: "Can app headroom alone satisfy the latency requirement, and can cache capacity alone execute the app's burst CPU demand?",
    evidenceToInspect: ["p95; Completed requests/s; Failed requests/s", "CPU; Health; Overall health", "Whole run: Completed; Whole run: Failed; Whole run: In-flight", "Cache: Hits; Cache: Misses; Cache: Expirations; Cache: Evictions", "Application helper: Database fetches; Application helper: Coalesced waiters"]},
  limitations: ["Results are educational model outputs. The read path can suggest a redirect service, but this mission does not verify unique-ID generation, URL validation, redirect HTTP codes or key-value semantics.",
    "The engine uses sixteen keys and its fixed hot-key access pattern. The flash increases arrival rate; it does not change the popularity distribution or reproduce arbitrary real cache workloads. Writes and mutable-data correctness are untested.",
    "Second-125 p95 covers successful completions in that second, not the whole flash or run. Terminal health does not prove continuous health, DNS failover or production availability. Cache and helper counters are cumulative from run start through the snapshot, not final-second rates or caller totals. Missing or null counters stay Unknown; old reports are never backfilled.",
    "CPU, network and tier capacities are educational assumptions. This is not a provider benchmark, price recommendation or interview assessment."],
  followUp: "Explain both partial failures using their saved reports, then cite the combined result. Name an application-correctness question that the model cannot answer.",
  check: {question: "Does a passing catalogue mission prove a redirect service generates unique IDs?", choices: [{id: "no", text: "No; only the modeled read path was tested"}, {id: "yes", text: "Yes; low latency proves ID uniqueness"}],
    correctChoiceId: "no", explanation: "The model executes infrastructure demand and keyed reads. It does not implement or verify a unique-ID generator."},
};
