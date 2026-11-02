import type { ResourceMetrics } from "@infraforge/contracts/telemetry";

const fields = [
  ["primaryProcessState", "Primary"],
  ["replicaProcessState", "Replica"],
  ["currentWriter", "Current writer"],
  ["replicaState", "Replica state"],
  ["primaryRole", "Original primary role"],
  ["replicaRole", "Replica role"],
  ["writerEpoch", "Writer epoch"],
  ["sessionInvalidations", "Sessions invalidated by HA changes"],
  ["connectionInvalidations", "Connections invalidated by HA changes"],
  ["failedWritesWithoutWriter", "Failed writes without a writer"],
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
  const display = (key: typeof fields[number][0]) => {
    const value = values[key];
    if (value == null) return "Unknown";
    if (key === "primaryProcessState") return value === "unavailable" ? "Down" : value === "fenced" ? "Fenced" : values.primaryRole === "writer" ? "Writer" : "Available";
    if (key === "replicaProcessState") return value === "unavailable" ? "Down" : value === "writer" ? "Writer" : "Replica";
    return String(value);
  };
  return <section aria-label="Database replication measurements" className="border-b border-line px-4 py-4 text-sm">
    <p>Educational async replication. Lag is the age of the oldest unapplied commit.</p>
    <p>Regressed keys: {values.regressedKeyCount == null ? "Unknown" : values.regressedKeyCount}. Details (up to 8): {values.regressedKeys == null ? "Unknown" : values.regressedKeys.length ? values.regressedKeys.map(r => `${r.key}: ${r.primaryVersion} → ${r.promotedVersion}`).join(", ") : "None"}</p>
    <dl>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{display(key)}</dd></div>)}</dl>
  </section>;
}
