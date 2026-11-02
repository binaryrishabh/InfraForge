import type { ResourceMetrics } from "@infraforge/contracts/telemetry";

const fields = [["currentWriter", "Current writer"], ["replicaState", "Replica state"], ["pendingReplication", "Pending replication"], ["lagMs", "Replica lag (ms; oldest pending age)"], ["primaryCommittedWrites", "Primary committed writes"], ["replicaAppliedWrites", "Replica applied writes"], ["primaryGeneration", "Primary data generation"], ["replicaGeneration", "Replica applied generation"]] as const;
export function DatabaseReplicationReadings({ metrics }: { metrics?: ResourceMetrics }) {
  const values = metrics?.databaseReplication;
  if (!values) return null;
  return <section aria-label="Database replication measurements" className="border-b border-line px-4 py-4 text-sm">
    <p>Educational async replication. Lag is the age of the oldest unapplied commit.</p>
    <dl>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{values[key] == null ? "Unknown" : String(values[key])}</dd></div>)}</dl>
  </section>;
}
