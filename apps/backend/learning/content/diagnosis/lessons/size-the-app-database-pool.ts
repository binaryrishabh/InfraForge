import type { LearningLesson } from "@infraforge/contracts/learning";
export const sizeTheAppDatabasePool: LearningLesson = {
  id: "size-the-app-database-pool", contentVersion: 1, trackId: "diagnosis", moduleId: "application-pools",
  title: "Size the app database pool", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Use saved path wait and caller outcomes to distinguish an application transport pool from database CPU and session admission.",
  prerequisites: ["connection-pool-budgets"],
  problem: ["The read service has spare CPU but callers fail. Run its starter unchanged and explain which connection bound is constraining work before changing capacity."],
  explanation: ["Inspect CPU, Connections, Refused session opens and the app-to-db path's Duration: Acquired pool wait. Its duration sums ended acquisition phases from run start and includes establishment; it is not a whole-run latency percentile.",
    "State a prediction and one-change hypothesis. Select db and change only Application database connections from 1 to 2. This setting bounds each application's connections per replica and database path, separately from Active queries and the database's session ceiling.",
    "Compare the two saved reports: p95 covers completions in the final second, while Whole run: Completed and Whole run: Failed cover the retained cumulative boundary. The real one-change review must count one setting.",
    "Restore the starter and enlarge only the database as a near miss. Explain why lower DB CPU can coexist with pool wait and caller failures. If path evidence is missing, leave the mechanism Unknown."],
  experiment: {challengeId: "size-the-app-database-pool", prediction: "Can the database remain Healthy while the application waits for its transport pool?",
    evidenceToInspect: ["CPU; Connections; Refused session opens", "Duration: Acquired pool wait", "p95; Whole run: Completed; Whole run: Failed; Whole run: In-flight"]},
  limitations: ["Results are educational model outputs, not a provider benchmark or a production pool-sizing recommendation. Fixed synthetic CPU demands and steady read traffic do not represent arbitrary applications.",
    "Acquired pool wait includes establishment and only ended acquisition phases. Failed, cancelled and pending acquisitions have no measured wait duration; direct pool peak occupancy is Unknown. Current sessions and pending counts are samples, not continuous history.",
    "The final-second tail excludes failed and unfinished callers. The pair proves neither a whole-run latency SLO nor continuous health, availability, reserved per-class pools, lock contention or finite database IO behavior."],
  followUp: "Cite both reports and the near miss. Explain which connection limit changed, why database sessions and query slots are separate, and why another workload might not benefit.", check: null,
};
