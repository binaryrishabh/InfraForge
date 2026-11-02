import type { ResourceMetrics } from "@infraforge/contracts/telemetry";

const fields = [["writerEpoch", "Writer epoch"], ["primaryRole", "Original primary role"], ["replicaRole", "Replica role"], ["fencedWriteRejections", "Fenced writes rejected"], ["fencedReplicationRejections", "Old replication messages discarded"], ["promotionCount", "Promotions"], ["promotionAtUs", "Promotion time (us)"], ["lostOperations", "Unreplicated commits lost at promotion"], ["replicaCommittedWrites", "Promoted writer commits"], ["primaryReads", "Primary reads"], ["replicaReads", "Replica reads"], ["freshReplicaReads", "Fresh replica reads"], ["staleReplicaReads", "Stale replica reads"], ["currentWriter", "Current writer"], ["replicaState", "Replica state"], ["pendingReplication", "Pending replication"], ["lagMs", "Replica lag (ms; oldest pending age)"], ["primaryCommittedWrites", "Primary committed writes"], ["replicaAppliedWrites", "Replica applied writes"], ["primaryGeneration", "Primary data generation"], ["replicaGeneration", "Replica applied generation"]] as const;
export function DatabaseReplicationReadings({ metrics }: { metrics?: ResourceMetrics }) {
  const values = metrics?.databaseReplication;
  if (!values) return null;
  return <section aria-label="Database replication measurements" className="border-b border-line px-4 py-4 text-sm">
    <p>Educational async replication. Lag is the age of the oldest unapplied commit.</p>
    <p>Regressed keys: {values.regressedKeys == null ? "Unknown" : values.regressedKeys.length ? values.regressedKeys.map(r => `${r.key}: ${r.primaryVersion} → ${r.promotedVersion}`).join(", ") : "None"}</p>
    <dl>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{values[key] == null ? "Unknown" : String(values[key])}</dd></div>)}</dl>
  </section>;
}
