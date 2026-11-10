import type { LearningLesson } from "@infraforge/contracts/learning";

export const restoreSafeRedundancy: LearningLesson = {
  id: "restore-safe-redundancy", contentVersion: 1, trackId: "data", moduleId: "database-redundancy",
  title: "Restore safe redundancy", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Keep service recovery separate from restoring a caught-up replica after the old primary returns.",
  prerequisites: ["promotion-and-pending-work", "restore-a-database-writer"],
  problem: ["Promotion restores a writer. A returned old primary can remain fenced while service is Healthy, leaving redundancy missing."],
  explanation: ["Predict final overall health before running. Promotion is already fixed in the scenario; keep the saved promotion plan unchanged. Run the starter and retain its report. Compare the incident samples before failure, without a writer, after promotion and after the original primary returns.",
    "Improve that attempt with a hypothesis. Select db and change only Old-primary catch-up from Off to Snapshot and ordered replay. Run again under the same workload and seed. Compare the saved terminal requirement and HA measurements in both reports; the new adapter profile means Honest Compare permits descriptive comparison only.",
    "The old primary must stay fenced while the authoritative snapshot and ordered batches replay. At the stated horizon inspect its replica role, eligibility, pending batches and operations beside the promoted writer and writer epoch. For a separate near miss, change only the enabled run's modeled replication delay to its maximum allowed value and compare again. This also changes replication before promotion; inspect each run's loss separately.",
    "Caught up now does not mean nothing was lost earlier. Zero pending catch-up must never erase Unreplicated commits lost at promotion or regressed keys. Explain how Healthy service can coexist with a fenced member and missing redundancy. Missing measurements stay Unknown and cannot satisfy the requirement."],
  experiment: {challengeId: "restore-safe-redundancy", prediction: "Can the service finish Healthy while safe redundancy is still missing? Predict health, then inspect the separate redundancy requirement.",
    evidenceToInspect: ["Current writer; Original primary role; Replica role; Writer epoch", "Pending catch-up operations; Pending catch-up batches (including snapshot); Replica eligible at this sample", "Unreplicated commits lost at promotion; Pending replication", "Whole run: Completed; Whole run: Failed; Overall health"]},
  limitations: ["Results are educational model outputs. The replay delay is an InfraForge deterministic teaching model. It does not reproduce PostgreSQL/MySQL protocols, physical replication timing, disk or WAL recovery.",
    "This experiment demonstrates fencing, writer epochs, authoritative snapshot replacement, replay backlog and redundancy restoration at a sample. It provides no durability, data-preservation or availability guarantee.",
    "There are only an original primary, one replica and one promotion. No multi-replica quorum, automatic election, second promotion or read routing to the returned replica is represented.",
    "Incident boundaries and terminal readiness are point observations. Initial catch-up does not promise perpetual eligibility under later writes. Missing evidence stays Unknown; historical promotion loss remains recorded after full replay."],
  followUp: "Use the saved pair to explain why recovering service is not the same as recovering redundancy. Then compare the enabled policy with a slower replay delay, changing only that delay.",
  check: null,
};
