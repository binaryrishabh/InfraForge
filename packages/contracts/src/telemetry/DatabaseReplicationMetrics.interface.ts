export interface DatabaseReplicationMetrics {
  version: 1;
  currentWriter: "primary" | "replica" | null;
  replicaState: "available" | "unavailable" | "promoted" | null;
  writerEpoch: number | null;
  primaryEpoch: number | null;
  replicaEpoch: number | null;
  primaryRole: "writer" | "fenced" | null;
  replicaRole: "replica" | "writer" | null;
  fencedWriteRejections: number | null;
  fencedReplicationRejections: number | null;
  replicaCommittedWrites: number | null;
  promotionCount: number | null;
  promotionAtUs: number | null;
  lostOperations: number | null;
  regressedKeys: Array<{ key: string; primaryVersion: number; promotedVersion: number }> | null;
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
