import type { LearningLesson } from "@infraforge/contracts/learning";

export const replicasDoNotTakeWrites: LearningLesson = {
  id: "replicas-do-not-take-writes", contentVersion: 1, trackId: "data", moduleId: "database-pressure",
  title: "Test a replica against a write bottleneck", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Run a plausible replica-only fix, observe why it fails, then change writer capacity.",
  prerequisites: ["replica-reads-and-writer-work"],
  problem: ["A small primary executes 650 writes/second. Adding a replica looks like more database capacity, but application writes still execute on the writer."],
  explanation: ["Run the starter and retain its report. For the near miss, select db and enable One replica with Replica preferred Read routing. Run without changing writer size.",
    "Compare primary committed writes, replica reads, member CPU work and caller p95. The few replica reads come from startup health probes; the authored application workload only writes.",
    "Restore the starter, then select db.t3.micro under Instance size and run again. Compare p95, completions and failures with the starter and the replica-only attempt."],
  experiment: {challengeId: "replicas-do-not-take-writes", prediction: "Will the small single writer be saturated at second 6? Will adding a replica change application write execution?",
    evidenceToInspect: ["p95; Completed requests/s; Failed requests/s; Whole run: In-flight", "Primary committed writes; Promoted writer commits; Replica reads", "Primary CPU core-us; Replica CPU core-us", "CPU; Health; Overall health"]},
  limitations: ["Results are educational model outputs. Generic Small assumes one core; db.t3.micro supplies two modeled cores and also changes query slots and session limits. This is a tier comparison, not a measured provider benchmark or credit simulation.",
    "The replica asynchronously applies committed row versions; it does not split application write execution. No multi-writer system or distributed transaction is modeled.",
    "Uniform selection among 100 logical keys is authored input. This lab makes no cache-key distribution or transaction-isolation claim.",
    "The latency requirement covers second-6 completions, excluding failed and unfinished callers. A combined Healthy label does not establish whole-run success."],
  followUp: "Use all three reports to explain why an idle replica can improve the combined CPU label while leaving write latency unchanged.",
  check: {question: "What extra work does the replica execute for the write-only application?",
    choices: [{id: "apply", text: "Apply committed versions after the modeled delay"},
      {id: "split", text: "Execute half the application's writes instead of the primary"}], correctChoiceId: "apply",
    explanation: "Application writes still go to the current writer. A replica receives committed versions later."},
};
