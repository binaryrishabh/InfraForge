import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const balancerSharesTurnsV1: ChallengeDefinition = {
  engine: "2", id: "balancer-shares-turns", version: 1, title: "The balancer shares turns", difficulty: "starter",
  summary: "Two app servers sit behind a load balancer, but one is much smaller. Round robin gives each the same number of turns.",
  concepts: ["Request routing", "Round robin", "Capacity per server"],
  story: ["A load balancer sends requests to two app servers in turn. One is a small generic server with one assumed CPU core; the other is a c5.large with two. Each request needs 3 ms of app CPU work.",
    "At 800 reads/second each server gets half the requests. Run the starter, compare the two servers' CPU, then change one server and run again."],
  objective: "At second 12, record Healthy overall health and completed-request p95 at most 100 ms.",
  workload: {targetThroughput: 48000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "800 requests/second, all reads, light payloads. Full rate from the start; no ramp or fault.",
  evaluationSeconds: 12, evaluationNote: "Scored at second 12. p95 describes completions in the preceding second, not a whole-run SLO.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete the deployment checks"},
    {id: "health", kind: "overall-health", label: "Overall health is Healthy at second 12", allowed: ["healthy"]},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 100 ms at second 12", maxMs: 100}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will the starter record at second 12?"}],
  hints: ["Compare the CPU of app-a and app-b. Round robin counts turns, not CPU cores.",
    "Making the larger server even larger leaves the small server with the same half of the requests.",
    "Select app-a and choose c5.large under Instance size, so both servers match. Keep the load balancer and database unchanged."],
  debrief: ["Round robin hands requests to each attached server in turn. It does not look at how large a server is, so the small server receives half the work and runs out of CPU while the larger one has room.",
    "Enlarging app-b leaves app-a with the same half of the requests and the same problem. Resizing app-a to match app-b removes the overload under the same workload.",
    "Round robin is one routing policy. A load balancer that tracks unfinished requests behaves differently, and a pair of equal servers is simply the easiest layout to reason about. This run shows one workload, not a rule for every layout.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0], ["app-a", "Virtual Machine", 1, 0, {size: "small"}], ["app-b", "Virtual Machine", 1, 1, {skuId: "c5.large"}],
    ["db", "Database", 2, 0, {size: "large"}]], [["lb", "app-a"], ["lb", "app-b"], ["app-a", "db"], ["app-b", "db"]]),
};
