export interface DatabaseReplicationMetrics {
  version: 1;
  currentWriter: "primary" | "replica" | null;
  replicaState: "available" | "unavailable" | "promoted" | null;
  primaryCommittedWrites: number | null;
  replicaAppliedWrites: number | null;
  pendingReplication: number | null;
  lagMs: number | null;
  oldestPendingAgeMs: number | null;
  primaryGeneration: number | null;
  replicaGeneration: number | null;
}
