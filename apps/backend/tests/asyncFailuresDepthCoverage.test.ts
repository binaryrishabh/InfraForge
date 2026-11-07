import { expect, test } from "bun:test";
import { learningContent } from "../learning/content";
import { latestChallenge } from "../challenges/registry";
import { REFERENCE } from "./challengeHarness";

// Every reading/concept in scope has either real runnable practice for the named
// portion or an explicit conceptual-only boundary. A link is not full coverage.
const coverage = [
  {track: "async", concept: "parallelism-and-shared-capacity", labs: ["parallel-jobs-for-a-burst", "keep-up-with-the-queue"], limitation: "Worker CPU and ownership only; downstream saturation remains conceptual."},
  {track: "async", concept: "duplicate-effects-and-ownership", labs: ["leave-time-to-acknowledge"], limitation: "Repeated modeled object effects only; atomic deduplication and business transactions remain conceptual."},
  {track: "failures", concept: "retry-ownership-across-layers", labs: ["choose-a-retry-mitigation"], limitation: "Single-layer attempt pressure only; layered retry multiplication and shared deadline propagation remain conceptual."},
  {track: "failures", concept: "health-checks-and-failure-scope", labs: ["check-the-missing-server", "find-the-denying-rule"], limitation: "Distinct crash and policy comparisons; faster probes during a firewall denial remain conceptual."},
  {track: "async", concept: "why-work-waits", labs: ["keep-waiting-work", "keep-up-with-the-queue", "leave-time-to-acknowledge"], limitation: "Thought experiment only; later labs model logical retention, capacity and repeated object effects, not real delivery guarantees."},
  {track: "async", concept: "count-waiting-jobs", labs: ["keep-waiting-work", "keep-up-with-the-queue", "leave-time-to-acknowledge"], limitation: "Conceptual arithmetic and acknowledgement loss; no exactly-once business action or physical persistence proof."},
  {track: "async", concept: "queue-ownership-and-acknowledgement", labs: ["keep-up-with-the-queue", "leave-time-to-acknowledge"], limitation: "Logical ownership only; no physical durability or exactly-once transaction."},
  {track: "async", concept: "fan-out-subscribers", labs: ["open-one-subscriber"], limitation: "Independent dispatch, not physical isolation or ordering."},
  {track: "failures", concept: "firewall-rule-matching", labs: ["find-the-denying-rule", "leave-room-for-firewall-flows"], limitation: "Modeled admissions include probes; exposure scan is a separate population."},
  {track: "failures", concept: "dns-cache-lifetime", labs: [], limitation: "Conceptual only: saved reports omit resolver cache answers/expiry and no DNS recovery criterion exists."},
  {track: "failures", concept: "missing-failure-observations", labs: ["find-the-denying-rule", "choose-a-retry-mitigation"], limitation: "Practice diagnosis and naming missing observations, not a complete incident diagnosis or MTTR."},
  {track: "failures", concept: "mitigation-tradeoffs", labs: ["choose-a-retry-mitigation"], limitation: "Completion/latency tradeoff; no continuous recovery or availability proof."},
  {track: "depth", concept: "concurrent-cache-misses", labs: ["share-a-cache-fill"], limitation: "Single owner and read-only key; saved cache commands and helper coalescing counts are separate populations."},
  {track: "depth", concept: "retry-limits-and-budgets", labs: ["retrying-a-full-pool", "choose-a-retry-mitigation"], limitation: "Amplification only; concurrent-budget suppression remains conceptual because saved LB accounting omits it."},
  {track: "depth", concept: "circuit-breaker-boundaries", labs: [], limitation: "Conceptual only: saved report and audited labels omit path state, transitions, probes and circuit refusals."},
  {track: "depth", concept: "pool-isolation-boundaries", labs: ["budget-app-database-sessions", "bound-function-pool-pressure"], limitation: "Shared pool limits only; no tunable per-class reservation or per-class pool ownership."},
  {track: "depth", concept: "timeout-ownership", labs: [], limitation: "Conceptual only: saved clientRetry counters have audited labels, but workload timeouts cannot be edited in a challenge design."},
  {track: "depth", concept: "backpressure-boundaries", labs: ["keep-up-with-the-queue", "analytics-burst-buffer"], limitation: "Buffering/worker capacity only; adaptive upstream feedback is not implemented."},
];

test("async/failures/depth coverage is exhaustive, unique, and never substitutes a nonexistent lab for an unsupported mechanism", () => {
  const concepts = learningContent.lessons.filter(l => ["async", "failures", "depth"].includes(l.trackId) && l.kind !== "executable-lab");
  expect(coverage.map(row => row.concept).sort()).toEqual(concepts.map(l => l.id).sort());
  expect(new Set(coverage.map(row => row.concept)).size).toBe(coverage.length);
  for (const row of coverage) {
    expect(concepts.find(l => l.id === row.concept)!.trackId).toBe(row.track);
    expect(row.limitation.length).toBeGreaterThan(20);
    if (!row.labs.length) expect(row.limitation).toContain("Conceptual only:");
    for (const id of row.labs) {
      const lab = learningContent.lessons.find(l => l.id === id)!;
      expect(lab).toBeDefined(); expect(lab.kind).toBe("executable-lab"); expect(lab.availability).toBe("available");
      const d = latestChallenge(lab.experiment!.challengeId)!.definition;
      expect(d.engine).toBe("2"); expect(d.starter).toBeDefined(); expect(REFERENCE[d.id]).toBeDefined();
    }
  }
});
