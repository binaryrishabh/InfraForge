import type { LearningLesson } from "@infraforge/contracts/learning";

export const fitARequestInMemoryV2: LearningLesson = {
  id: "fit-a-request-in-memory", contentVersion: 2, trackId: "diagnosis", moduleId: "memory-admission",
  title: "Fit a request in memory", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Test memory admission while CPU is spare, then explain why a second identical VM cannot fit an oversized request.",
  prerequisites: ["memory-is-not-cpu"],
  problem: ["The starter offers 100 reads/s. Its Small VM models a 1024 MiB baseline, 1536 MiB per held request and no extra active allocation. Compare that demand with the instance's modeled limit. Through second 6, complete at least 590 callers without unsuccessful callers."],
  explanation: ["Run unchanged and predict database health. Inspect CPU, Health and whole-run caller outcomes in the saved report. Missing p95 when nothing completes is Unknown. Do not diagnose CPU saturation from a resource's Saturated health label alone.",
    "In the saved report, open app: memory measurements. Compare Resident, Limit and Headroom with the configured baseline plus a request allocation. Inspect Holding requests, Active requests, Refused allocations and Peak resident alongside CPU and caller outcomes. Health probes can also be refused, leaving the balancer without a healthy backend; allocation refusals and failed callers count different populations.",
    "Change only the VM's instance size to provide more memory, keeping the authored allocations, database and workload fixed. Compare saved caller outcomes with the starter. Restore the starter, then separately lower only per-held-request MiB while keeping the original instance size. Keep memory modeling enabled. This second comparison isolates allocation demand without adding CPU capacity.",
    "For a near miss, restore the starter and add an identical Small VM behind the same balancer, with the same database connection and memory settings. Compare caller outcomes again. Each VM still needs enough local headroom for a single request; the balancer cannot pool their RAM."],
  experiment: {challengeId: "fit-a-request-in-memory", prediction: "Can the database remain Healthy while VM memory admission prevents useful work?",
    evidenceToInspect: ["CPU; Health; Whole run: Completed; Whole run: Failed; Whole run: In-flight", "p95",
      "VM memory: Resident; VM memory: Limit; VM memory: Headroom",
      "VM memory: Holding requests; VM memory: Active requests; VM memory: Refused allocations; VM memory: Peak resident"]},
  limitations: ["Results are educational model outputs. The authored memory amounts are assumptions, not process RSS measurements or cloud sizing advice. Lowering an input does not prove that a real program's memory footprint can be reduced.",
    "The saved memory block describes modeled allocations, separate from generic Memory percentage. Missing or null readings remain Unknown. The scored requirement uses cumulative caller outcomes, not a direct memory budget. Refused allocations include probes and must not be equated with failed callers.",
    "This policy rejects allocations rather than killing or restarting a VM. The final CPU and latency readings do not prove continuous health, a whole-run latency SLO, availability or recovery time."],
  followUp: "Explain the input, allocation decision, health-probe effect and caller outcome. Cite both controlled reports, distinguish the terminal memory sample from cumulative refusals, and explain why the second VM fails to remove this bound.", check: null,
};
