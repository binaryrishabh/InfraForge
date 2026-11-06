import type { LearningLesson } from "@infraforge/contracts/learning";

export const oneVmOrAPool: LearningLesson = {
  id: "one-vm-or-a-pool", contentVersion: 1, trackId: "architecture", moduleId: "cross-resource-choices",
  title: "One VM or a pool", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Compare a large VM with pools under a real scripted VM crash, using cumulative caller evidence as well as final latency.",
  prerequisites: ["virtual-machines", "one-bigger-or-two-smaller", "retries-add-work"],
  problem: ["Requirements: 500 reads/second; through second 5, at least 2000 completed callers and at most 30 unsuccessful callers; p95 at most 20 ms in second 5; educational monthly estimate at most $200. The script crashes app just after second 2 and restores it, including restart, just after second 4.",
    "Compare the original large VM with a pool of catalog VMs and a pool of small VMs. Keep app as the target and retain the load balancer's selection and retry policy, the database and the traffic."],
  explanation: ["Run the starter. Read the exact crash target and restore receipt, then compare the final p95 with whole-run caller outcomes. A fast sample after restart cannot undo earlier failed callers.",
    "Build the catalog pool described in the challenge hints and run it. Then try the small-VM pool under the identical script. Explain why both can pass even when their educational cost, final CPU and final latency differ.",
    "Compare a pool with too little surviving CPU as the near miss. Judge cumulative completions and unsuccessful callers separately from in-flight callers; unfinished work is neither success nor failure. State the sampled-health concession of a cheaper passing pool."],
  experiment: {challengeId: "one-vm-or-a-pool", prediction: "Will the final health sample agree with the cumulative caller requirement after the scripted VM crash?",
    evidenceToInspect: ["Resolved targets:; Applies at; baseline restore at", "Whole run: Completed; Whole run: Failed; Whole run: In-flight", "CPU; Overall health; p95", "Monthly estimate (CostEstimate gate)"]},
  limitations: ["Results are educational model outputs. Instance capacities, synthetic work, restart timing and monthly estimates are educational assumptions.",
    "The script aborts the named fixed VM's owned calls and holds readiness until its restart ends. This does not model host repair, physical data loss or a database, load-balancer or shared-network outage.",
    "Cumulative counts cover only the fixed run horizon. Final p95 and resource CPU are sampled after the crash ends; they do not prove continuous health, failover time, maximum supported traffic or production availability."],
  followUp: "Recommend either passing pool using both reports. Explain the measured cost, CPU and latency concessions, and why the original large VM's fast final p95 is insufficient evidence of successful callers.", check: null,
};
