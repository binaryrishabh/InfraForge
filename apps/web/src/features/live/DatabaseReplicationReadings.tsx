import type { ResourceMetrics } from "@infraforge/contracts/telemetry";

const fields = [
  ["currentWriter", "Current writer"],
  ["replicaState", "Replica state"],
  ["primaryRole", "Original primary role"],
  ["replicaRole", "Replica role"],
  ["writerEpoch", "Writer epoch"],
  ["pendingReplication", "Pending replication"],
  ["lagMs", "Replica lag (ms; oldest pending age)"],
  ["primaryReads", "Primary reads"],
  ["replicaReads", "Replica reads"],
  ["freshReplicaReads", "Fresh replica reads"],
  ["staleReplicaReads", "Stale replica reads"],
  ["promotionCount", "Promotions"],
  ["promotionAtUs", "Promotion time (us)"],
  ["lostOperations", "Unreplicated commits lost at promotion"],
  ["fencedWriteRejections", "Fenced writes rejected"],
  ["fencedReplicationRejections", "Old replication messages discarded"],
  ["primaryCommittedWrites", "Primary committed writes"],
  ["replicaAppliedWrites", "Replica applied writes"],
  ["replicaCommittedWrites", "Promoted writer commits"],
  ["primaryGeneration", "Primary data generation"],
  ["replicaGeneration", "Replica data generation"],
] as const;
export function DatabaseReplicationReadings({ metrics }: { metrics?: ResourceMetrics }) {
  const values = metrics?.databaseReplication;
  if (!values) return null;
  return <section aria-label="Database replication measurements" className="border-b border-line px-4 py-4 text-sm">
    <p>Educational async replication. Lag is the age of the oldest unapplied commit.</p>
    <p>Regressed keys: {values.regressedKeys == null ? "Unknown" : values.regressedKeys.length ? values.regressedKeys.map(r => `${r.key}: ${r.primaryVersion} → ${r.promotedVersion}`).join(", ") : "None"}</p>
    <dl>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{values[key] == null ? "Unknown" : String(values[key])}</dd></div>)}</dl>
  </section>;
}
