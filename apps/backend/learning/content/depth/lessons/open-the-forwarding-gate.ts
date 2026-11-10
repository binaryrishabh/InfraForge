import type { LearningLesson } from "@infraforge/contracts/learning";
export const openTheForwardingGate: LearningLesson = {
  id: "open-the-forwarding-gate", contentVersion: 1, trackId: "depth", moduleId: "lb-forwarding",
  title: "Open the forwarding gate", summary: "Explain caller failures when a load balancer serializes work ahead of spare backend capacity.",
  kind: "executable-lab", level: "intermediate", availability: "available", prerequisites: ["response-time-and-throughput", "why-work-waits"],
  problem: ["The app has spare CPU, yet calls wait and fail at the load balancer. A bigger waiting queue sounds helpful. First distinguish a limit on forwarded requests from room for waiting requests."],
  explanation: ["Predict the busiest resource type, run unchanged and keep its report. Inspect whole-run Completed, Failed and In-flight alongside Rejected at load balancer (calls), Queued at load balancer (calls), Admitted by backend (attempts), Refused by VM (attempts) and CPU. The busiest known CPU alone cannot identify an admission bottleneck; LB CPU is Unknown.",
    "Start an improvement from the saved starter with a hypothesis. Select lb and change only Active requests from 1 to the larger value in the challenge hint. Keep Queued requests, Queue wait (ms), app, database and workload unchanged. Review exactly one change, run and compare the saved caller requirement and LB evidence.",
    "The active gate holds a slot across a round trip, including the app's database wait. More active slots allow overlapping requests to use the measured downstream headroom. Check both caller outcomes and backend refusals before concluding that opening the gate helped; higher admission can overload a busier backend.",
    "For a separate near miss, restore the starter and increase only Queued requests to the hint's larger limit. Review one change and compare again. Extra waiting places do not increase forwarding capacity or extend the queue wait. Queued-at-LB counts calls that waited, not current depth. LB and backend counters overlap; do not add them as disjoint caller totals. Missing evidence remains Unknown."],
  experiment: {challengeId: "open-the-forwarding-gate", prediction: "Predict which resource type has the highest known CPU despite the active forwarding gate.",
    evidenceToInspect: ["Whole run: Completed; Whole run: Failed; Whole run: In-flight", "Rejected at load balancer (calls); Queued at load balancer (calls)", "Admitted by backend (attempts); Queued at VM (attempts); Refused by VM (attempts)", "CPU"]},
  limitations: ["Results are educational model outputs. This deterministic InfraForge experiment uses fixed arrivals and authored CPU demands. It models request admission and queue expiry, not physical packet handling or provider throughput benchmarks.",
    "LB CPU and memory are Unknown. Queue counters are cumulative waits rather than current queue depth; backend counters count attempts. They overlap and do not form a conserved caller population.",
    "The fixed-horizon caller counts include separate in-flight work. A final health or latency sample does not prove a whole-run latency target, continuous health, production availability or a steady-state maximum.",
    "Opening admission is useful here because downstream capacity is spare. It is not a universal tuning rule: an overloaded backend may need bounded admission, service capacity or less offered work instead. No retries, autoscaling, outlier ejection or connection draining are exercised."],
  followUp: "Use the saved caller and LB counters to explain why Active requests helped while Queued requests did not. Name the downstream evidence you would inspect before raising admission under a heavier workload.",
  check: null,
};
