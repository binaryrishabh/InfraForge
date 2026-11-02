export interface DatabaseReplicationMetrics {
  version: 1;
  currentWriter: "primary" | "replica" | null;
  replicaState: "available" | "unavailable" | "promoted" | null;
  primaryReads: number | null;
  replicaReads: number | null;
  freshReplicaReads: number | null;
  staleReplicaReads: number | null;
  primaryCommittedWrites: number | null;
  replicaAppliedWrites: number | null;
  pendingReplication: number | null;
  lagMs: number | null;
  oldestPendingAgeMs: number | null;
  primaryGeneration: number | null;
  replicaGeneration: number | null;
}
