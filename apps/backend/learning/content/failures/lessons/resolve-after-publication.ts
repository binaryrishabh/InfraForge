import type { LearningLesson } from "@infraforge/contracts/learning";
export const resolveAfterPublication: LearningLesson = {
  id: "resolve-after-publication", contentVersion: 1, trackId: "failures", moduleId: "dns-publication",
  title: "Resolve after publication", summary: "Distinguish a published record from a resolver's retained negative answer.",
  kind: "executable-lab", level: "intermediate", availability: "available", prerequisites: ["dns-cache-lifetime"],
  problem: ["A hostname is absent at first. Its authority later publishes the app's address, while the caller's resolver can keep returning its cached negative answer."],
  explanation: ["Predict final overall health, then run the starter unchanged and keep its report. Diagnose DNS: Initial record, DNS: Published at and DNS: Current record generation beside DNS: Negative cache hits, DNS: Unresolved connections and Whole run: Failed. Record why failed opens can continue after publication.",
    "Improve the saved starter with a hypothesis. Select dns and change only Maximum cached TTL (seconds) from 60 to 1. Run under the same workload, seed and publication scenario. Use the one-change review and compare both saved reports: caller requirements, DNS: First successful resolution and Whole run: Completed.",
    "A shorter ceiling bounds newly received negative answers as well as positive answers. It cannot extend the authority's expiry. Publication does not clear the cache; after expiry a later connection open must resolve again. Healthy established connections can keep being reused without another lookup.",
    "For a separate near miss, restore the starter and change only app size from small to large. Review exactly one change and compare with the starter. Explain why more app CPU leaves unresolved opens unchanged. Keep publication time and resolver settings fixed for this comparison. Final health is a point observation and can be Healthy in a failing attempt. The requirement counts the entire recorded window. Missing values remain Unknown; negative authority replies, cached negative hits and failed caller opens have distinct populations."],
  experiment: {challengeId: "resolve-after-publication", prediction: "Can final Healthy service coexist with earlier unresolved caller failures? Predict overall health before the run.",
    evidenceToInspect: ["DNS: Initial record; DNS: Published at; DNS: Current record generation", "DNS: Negative cache hits; DNS: Cache expirations; DNS: First successful resolution", "DNS: Unresolved connections; Whole run: Completed; Whole run: Failed; Overall health"]},
  limitations: ["Results are educational model outputs. Times and TTLs are deterministic InfraForge teaching policy, not real-world DNS propagation measurements or provider benchmarks.",
    "Only one synthetic A record, resolver and existing destination are represented. No recursive hierarchy, DNSSEC, arbitrary names or internet addresses, record deletion or health routing is modeled.",
    "The ceiling affects answers on receipt; record publication does not invalidate cached negative answers, and expiry does not migrate an established connection. A successful lookup alone does not prove endpoint admission or availability.",
    "Counters cover the retained boundary; first resolution is a recorded event, not continuous health or recovery duration. Missing publication or resolution time stays Unknown."],
  followUp: "Use the two controlled pairs to separate naming state, resolver state and app capacity. Explain which saved evidence could distinguish publication from discovery.",
  check: null,
};
