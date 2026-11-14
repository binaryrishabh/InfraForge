import type { LearningLesson } from "@infraforge/contracts/learning";

export const restoreADatabaseWriterV2: LearningLesson = {
  id: "restore-a-database-writer", contentVersion: 2, trackId: "data", moduleId: "database-incident",
  title: "Restore a database writer", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Compare a primary outage with and without a saved promotion plan, then inspect the returning primary.",
  prerequisites: ["promoting-a-replica", "promotion-and-pending-work"],
  problem: ["The service already has an asynchronous replica. When the primary fails, that replica does not automatically become a writer."],
  explanation: ["Run the starter with no promotion. In the database incident record compare the healthy sample before failure, the first sample after failure and the sample when the original primary returns. Keep this report.",
    "Improve the attempt with a hypothesis. Select db and change only Promote at simulated second to an early second in the approved recovery window shown in the challenge. Run again with the same topology and workload. In the calibrated runs promotion at second 3, 4 or 5 meets the caller requirement, with second 5 exactly on both limits; second 6 and later miss it.",
    "Compare the no-writer sample before promotion with the sample after promotion and the original-primary return. Promotion closes existing sessions; the modeled pools open fresh sessions for later work. There is no manual connection-moving step in this model.",
    "Inspect the promoted writer's commits and the returning primary's fenced role. Final health cannot erase earlier caller failures; try promotion at second 6 or later as a near miss. Read lost operations and regressed keys beside pending replication: clearing pending work does not prove preservation or create a replacement replica."],
  experiment: {challengeId: "restore-a-database-writer", prediction: "Will the replica become writable without explicit promotion? Can final health alone describe the earlier caller failures?",
    evidenceToInspect: ["Whole run: Completed; Whole run: Failed; Whole run: In-flight", "Primary committed writes; Promoted writer commits; Pending replication", "Health; Overall health"]},
  limitations: ["Results are educational model outputs. No real provider detection, election, failover time, production availability or continuous recovery guarantee is measured.",
    "The model invalidates sessions and connections and requires fresh sessions after promotion. It does not model DNS endpoint changes or a real driver's reconnect timing and policy.",
    "There is one replica, no automatic promotion and no replacement or catch-up replica topology. This experiment cannot prove application correctness or preservation of every acknowledged write.",
    "Incident measurements are retained boundary samples, not a continuous trace. Missing values are Unknown; zero pending replication is not a substitute for recorded loss evidence."],
  followUp: "Use the saved reports to explain why a late promotion can leave the final writer correct while still missing the caller outcome requirement.",
  check: null,
};
