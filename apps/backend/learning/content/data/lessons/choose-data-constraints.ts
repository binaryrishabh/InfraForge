import type { LearningLesson } from "@infraforge/contracts/learning";

export const chooseDataConstraints: LearningLesson = {
  id: "choose-data-constraints", contentVersion: 1, trackId: "data", moduleId: "data-tradeoffs",
  title: "Choose constraints before choosing a data fix", kind: "reading", level: "advanced", availability: "available",
  summary: "Compare latency, freshness and session headroom without turning a local improvement into an overall verdict.",
  prerequisites: ["move-reads-off-the-writer", "budget-app-database-sessions", "replicas-do-not-take-writes", "percentiles-and-populations"],
  experiment: null,
  problem: ["A design can satisfy its latency requirement while leaving a freshness or session constraint unresolved. What would make it an acceptable choice for an application?"],
  explanation: [
    "Start with the application's constraints: which reads need current data, what caller failures are acceptable, and where session headroom is required. A passing lab requirement answers its authored question. It cannot choose these application requirements for you or rank designs from different workloads.",
    "Revisit Give reads a separate execution budget (move-reads-off-the-writer). Compare p95 with Primary CPU core-us, Replica CPU core-us, Primary committed writes and Stale reads. These separate where work executes from what data reads observe. Oldest missed commit age at read describes observed missed commits; it is not a bound on every future read or a read-after-write guarantee.",
    "In Count pools before adding app instances (budget-app-database-sessions), compare Connections and Refused session opens with Whole run: Failed and Whole run: p95 bucket. A session-headroom improvement need not improve every caller-latency population. The completed-request p95 at evaluation and the whole-run bucket answer different questions. Keep failed and unfinished callers separate from either percentile.",
    "Use Test a replica against a write bottleneck (replicas-do-not-take-writes) to challenge a proposed universal replica fix: inspect Primary committed writes and p95 in its replica-only near miss. Before combining routing, caching or app counts, establish a baseline for the same workload, change one supported control, and check every required constraint again. Separate labs do not establish that their fixes compose."
  ],
  check: {question: "A proposed data path meets its latency limit, but evidence for the application's required read freshness is missing. Which decision is justified?",
    choices: [{id: "accept", text: "Accept it because a passing latency requirement also proves freshness."},
      {id: "unproven", text: "Leave freshness unproven and obtain evidence for that constraint before accepting the path."},
      {id: "rank", text: "Rank it above every design from the other labs."}],
    correctChoiceId: "unproven", explanation: "Latency, session occupancy and freshness measure different constraints. A local pass cannot supply missing freshness evidence, and different workloads do not provide a controlled ranking."},
  limitations: ["Conceptual synthesis only: no combined cache, pool and replica experiment is supplied, and no simulated outcome is claimed for this lesson.",
    "Read-routing counters include health probes and logical row versions. Fixed replication delay and independent member CPU budgets do not model physical host sharing, finite database IO or application consistency guarantees.",
    "Missing counters stay Unknown. Terminal p95 excludes failed and unfinished callers; whole-run percentiles are buckets for completed callers, not exact values or a whole-run SLO."],
  followUp: "Reopen move-reads-off-the-writer and budget-app-database-sessions. For each report pair, name the controlled change, the constraint it tests and a separate application requirement left unproven.",
};
