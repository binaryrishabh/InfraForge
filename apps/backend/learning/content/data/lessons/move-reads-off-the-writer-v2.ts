import type { LearningLesson } from "@infraforge/contracts/learning";

export const moveReadsOffTheWriterV2: LearningLesson = {
  id: "move-reads-off-the-writer", contentVersion: 2, trackId: "data", moduleId: "database-pressure",
  title: "Give reads a separate execution budget", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Route reads to an already provisioned replica and inspect where reads and writes actually run.",
  prerequisites: ["replica-reads-and-writer-work"],
  problem: ["The primary runs reads and writes while its replica is idle. Combined database CPU can hide a fully occupied primary."],
  explanation: ["Run the starter. Compare completed-request p95 with primary and replica consumed CPU microseconds. Inspect primary reads, replica reads and primary committed writes in the saved report.",
    "Select db. Under Database HA, change Read routing from Primary only to Replica preferred. Keep capacity, workload and app count unchanged, then run again.",
    "Check that reads moved and writes stayed on the primary. Inspect stale reads and replica lag too: a latency improvement does not establish fresh data. As a near miss, restore primary-only routing and increase only queued query capacity."],
  experiment: {challengeId: "move-reads-off-the-writer", prediction: "Can the primary exhaust its CPU budget while combined database health remains Healthy?",
    evidenceToInspect: ["p95; Completed requests/s; Failed requests/s; Whole run: In-flight", "Primary reads; Replica reads; Primary committed writes", "Primary CPU core-us; Replica CPU core-us", "Stale reads; Oldest missed commit age at read; Pending replication"]},
  limitations: ["Results are educational model outputs. p95 covers completed callers in second 6; it is not a whole-run SLO. Failed and unfinished callers have separate counts.",
    "The modeled replica has independent CPU, session and query budgets. Capacity refusals do not fall back to the primary; only unavailability does.",
    "Replication uses a fixed authored 1,000 ms delay. Stale-read measurements prove only observed logical row versions, not application consistency or provider timing. Counters include health probes.",
    "Uniform selection among 100 database keys is authored workload intent. There is no cache in this lab, no finite database IO and no shared physical host CPU model. Keeping primary-only reads and choosing a bigger writer also meets the latency requirement with the medium size. This lesson isolates read routing while keeping capacity fixed."],
  followUp: "Cite both reports to show where reads moved, what still writes to the primary, and why a passing latency requirement does not prove read freshness.",
  check: {question: "Which evidence shows that replica routing helped reads without moving writes?",
    choices: [{id: "counts", text: "Replica reads and CPU increase while primary write commits continue"},
      {id: "health", text: "The combined Healthy label alone"}], correctChoiceId: "counts",
    explanation: "Read-source, writer-commit and per-member work counters identify execution; combined health does not."},
};
