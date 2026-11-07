import type { LearningLesson } from "@infraforge/contracts/learning";

export const memoryIsNotCpuV2: LearningLesson = {
  id: "memory-is-not-cpu", contentVersion: 2, trackId: "diagnosis", moduleId: "memory-admission",
  title: "Memory admission is not CPU", kind: "reading", level: "intermediate", availability: "available",
  summary: "Separate the room needed to admit work from the CPU time needed to execute it.", prerequisites: [],
  problem: ["A quiet processor can coexist with rejected work. Before adding replicas, ask whether a single request can fit on any individual VM."],
  explanation: ["With authored resident-memory modeling enabled, a VM has a baseline and a limit. Each admitted request holds its per-request allocation until it finishes, including time queued. Active execution may hold an additional allocation across dependency waits. Headroom is the limit minus current modeled resident memory.",
    "CPU measures consumed core time. Memory admission decides whether an allocation fits. A refusal can prevent CPU work from starting, so a low CPU reading does not establish usable capacity. A current resident amount within the limit can coexist with earlier allocation refusals.",
    "Replicas have separate memory limits. They can share traffic, but cannot combine their RAM to fit an oversized request. Enlarging an instance changes its limit; reducing an authored per-request allocation changes the demand. Changing an educational input is a hypothesis, not evidence that a real application uses less memory.",
    "Use the fit-a-request-in-memory lab for a controlled comparison. Its saved report has a memory measurements section for each recorded VM, separate from CPU and generic Memory percentage. Resident, Limit and Headroom describe the sampled allocation state; Refused allocations counts allocation refusals. Health probes also need allocations, so their refusal can lead the balancer to refuse callers without another VM allocation."],
  limitations: ["Authored baseline and allocation sizes are educational assumptions, not measured process RSS or provider benchmarks. This policy refuses allocations; it does not simulate OOM killing, garbage collection, swapping, leaks or restarts.",
    "Caller totals alone cannot identify the resource that caused failure. A terminal memory sample does not establish continuous health or reconstruct all earlier holdings. Missing or null memory readings remain Unknown. Refused allocations include probes and are a different population from failed original callers."],
  experiment: null, check: null,
  followUp: "Predict whether another identical VM can help when a single request cannot fit. Then test that near miss in the linked lab and distinguish allocation refusals from failed original callers.",
};
