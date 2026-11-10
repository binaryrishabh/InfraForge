import type { LearningLesson } from "@infraforge/contracts/learning";
export const releaseTheCpuBudget: LearningLesson = {
  id: "release-the-cpu-budget", contentVersion: 1, trackId: "depth", moduleId: "cpu-budget",
  title: "Release the CPU budget", summary: "Explain why extra workers cannot spend CPU time that an application quota withholds.",
  kind: "executable-lab", level: "intermediate", availability: "available", prerequisites: ["response-time-and-throughput", "why-work-waits"],
  problem: ["The app has a low CPU reading, yet callers fail and unfinished work accumulates. More active workers sounds reasonable. First distinguish a concurrency limit from the CPU-time budget shared by all workers."],
  explanation: ["Predict overall health, run unchanged and save its report. Inspect CPU and whole-run Completed, Failed and In-flight. Read the captured Application CPU limit alongside these measurements. The CPU percentage uses modeled core capacity as its denominator; it does not prove the app is permitted to consume that capacity.",
    "Start an improvement from the saved starter with a hypothesis. Select app and change only Application CPU limit (%) from 25 to the larger percentage in the challenge hint. Keep Active workers, Queued requests, Instance size and workload unchanged. Review exactly one change, run and compare saved caller outcomes and CPU.",
    "The scheduler limits CPU time within a fixed window. Once the app spends that budget, runnable work waits for renewal. Raising the quota lets the same workers complete more work. CPU can rise while caller outcomes improve; a lower CPU reading alone is not the objective. The reference can still record degraded terminal health, which is different from failing the cumulative caller requirement.",
    "For a separate near miss, restore the starter and increase only Active workers from 8 to the hint's larger count. Review exactly one change and compare again. More workers share the unchanged budget and can hold more unfinished work. Inspect completions as well as failures: a reduction in failures can merely leave more callers in flight. Missing evidence remains Unknown."],
  experiment: {challengeId: "release-the-cpu-budget", prediction: "Predict overall health when queued work and caller failures coexist with a low CPU reading.",
    evidenceToInspect: ["Whole run: Completed; Whole run: Failed; Whole run: In-flight", "CPU", "Overall health"]},
  limitations: ["This is an educational CPU-time policy over modeled cores, not operating system quota fidelity, physical timing or a provider benchmark. No neighboring tenants, physical host contention or dynamic CPU frequencies are represented.",
    "Saved reports retain CPU and caller outcomes. Scheduler throttled time, runnable workers and queue depth are calibration observations, not saved report measurements for this lab. Memory remains Unknown under partial coverage.",
    "The fixed-horizon caller population keeps unfinished work separate. Final health and latency do not establish continuous health, a whole-run latency SLO or production availability.",
    "Releasing a quota is not a universal tuning rule. Resource isolation may be intentional. This single-app case has no dependency, retry, fault or autoscaling; increasing admission can overload a different system."],
  followUp: "Explain why CPU rose after the successful change. Use saved completions, failures and in-flight work to distinguish useful service from simply accepting more unfinished work.",
  check: null,
};
