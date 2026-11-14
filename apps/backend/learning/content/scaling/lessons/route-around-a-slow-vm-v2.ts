import type { LearningLesson } from "@infraforge/contracts/learning";

export const routeAroundASlowVmV2: LearningLesson = {
  id: "route-around-a-slow-vm", contentVersion: 2, trackId: "scaling", moduleId: "serving-under-load",
  title: "Route work with unfinished requests in mind", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Compare backend selection policies while keeping two VMs and their capacity unchanged.",
  prerequisites: ["load-balancer-policies", "percentiles-and-populations"],
  problem: ["Round robin takes turns between a fast VM and a VM with a 25% CPU quota. A Healthy label can coexist with waiting requests."],
  explanation: ["Run the starter and inspect p50 alongside p95. The median describes the middle completed response; the 95th percentile describes a slower part of the completed-response distribution.",
    "Select lb. Under Backend selection, change Round robin to Least outstanding. Keep the VMs, quotas, workload and health checks unchanged, then run again.",
    "Compare fast and slow throughput, unfinished work and cumulative Queued at VM. Try increasing only fast's Instance size as a near miss, with round robin restored."],
  experiment: {challengeId: "route-around-a-slow-vm", prediction: "Will overall health at second 6 expose the starter's long response-time tail?",
    evidenceToInspect: ["p50; p95", "CPU; Health; Requests/s", "Queued at VM (attempts)", "Whole run: In-flight"]},
  limitations: ["Results are educational model outputs. The scored p95 covers completions in second 6, excluding failed and unfinished requests. It is not a whole-run SLO.",
    "CPU is reported against physical capacity; 25% can exhaust this authored quota without a Saturated VM label.",
    "Least outstanding breaks ties by backend id. It does not promise fair distribution, continuous health or production performance.",
    "Raising only the slow VM's CPU quota to 50% also meets the latency requirement under round robin. This lesson keeps both quotas fixed to isolate backend selection."],
  followUp: "Explain why p50 alone could miss this queue. Cite both runs and identify which VM receives more useful work after the policy change.",
  check: {question: "Which report comparison best exposes a slow tail hidden by a low median?",
    choices: [{id: "tail", text: "p50 and p95 from the same completed-request window, alongside unfinished requests"},
      {id: "label", text: "The Healthy label alone"}], correctChoiceId: "tail",
    explanation: "A median and a slower percentile describe different parts of the same distribution; unfinished requests need a separate count."},
};
