import type { DatabaseReplicationMetrics } from "@infraforge/contracts/telemetry";
import type { relationalDatabase } from "../data/database";

type Evidence = ReturnType<ReturnType<typeof relationalDatabase>["evidence"]>["databaseReplication"];
// Copy measured fields only. Missing evidence stays Unknown; row inventories remain in engine evidence.
export function databaseReplicationLive(value: Evidence): DatabaseReplicationMetrics {
  return { version: 1,
    currentWriter: value?.currentWriter ?? null,
    primaryProcessState: value?.primaryProcessState ?? null,
    replicaProcessState: value?.replicaProcessState ?? null,
    sessionInvalidations: value?.sessionInvalidations ?? null,
    connectionInvalidations: value?.connectionInvalidations ?? null,
    failedWritesWithoutWriter: value?.failedWritesWithoutWriter ?? null,
    replicaState: value?.replicaState ?? null,
    writerEpoch: value?.writerEpoch ?? null,
    primaryEpoch: value?.primaryEpoch ?? null,
    replicaEpoch: value?.replicaEpoch ?? null,
    primaryRole: value?.primaryRole ?? null,
    replicaRole: value?.replicaRole ?? null,
    primaryCommittedWrites: value?.primaryCommittedWrites ?? null,
    replicaCommittedWrites: value?.replicaCommittedWrites ?? null,
    replicaAppliedWrites: value?.replicaAppliedWrites ?? null,
    pendingReplication: value?.pendingReplication ?? null,
    lagMs: value?.lagMs ?? null,
    oldestPendingAgeMs: value?.oldestPendingAgeMs ?? null,
    primaryGeneration: value?.primaryGeneration ?? null,
    replicaGeneration: value?.replicaGeneration ?? null,
    primaryReads: value?.primaryReads ?? null,
    replicaReads: value?.replicaReads ?? null,
    freshReplicaReads: value?.freshReplicaReads ?? null,
    staleReplicaReads: value?.staleReplicaReads ?? null,
    promotionCount: value?.promotionCount ?? null,
    promotionAtUs: value?.promotionAtUs ?? null,
    lostOperations: value?.lostOperations ?? null,
    regressedKeyCount: value?.regressedKeys.length ?? null,
    regressedKeys: value?.regressedKeys.slice(0, 8).map(row => ({ ...row })) ?? null,
    fencedWriteRejections: value?.fencedWriteRejections ?? null,
    fencedReplicationRejections: value?.fencedReplicationRejections ?? null,
  };
}
