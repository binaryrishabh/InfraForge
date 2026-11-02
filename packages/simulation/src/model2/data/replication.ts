import type { DatabaseReplication } from "@infraforge/domain/resource";
import type { EventClock } from "../time";

type Row = { version: number; bytes: number };
// One atomic commit per message. Fixed delay and the kernel's ordering preserve commit order.
export function databaseReplica(config: DatabaseReplication, id: string, clock: EventClock, primary: Map<string, Row>) {
  const replica = new Map([...primary].map(([key, row]) => [key, { ...row }]));
  const pending = new Map<number, { at: number; ready: boolean; apply(): void }>();
  let primaryCommittedWrites = 0, replicaAppliedWrites = 0, primaryGeneration = 0, replicaGeneration = 0;
  let promoted = false, replicaCommittedWrites = 0, promotionAtUs: number | null = null, lostOperations = 0;
  let regressedKeys: Array<{ key: string; primaryVersion: number; promotedVersion: number }> = [];
  let primaryProcessState: "available" | "unavailable" | "fenced" = "available";
  let replicaProcessState: "available" | "unavailable" | "writer" = "available";
  let crashRestore: { primary: typeof primaryProcessState; replica: typeof replicaProcessState } | undefined;
  let primaryReads = 0, replicaReads = 0, freshReplicaReads = 0, staleReplicaReads = 0;
  let writerEpoch = 1, fencedWriteRejections = 0, fencedReplicationRejections = 0;
  const drainReady = () => { for (const work of [...pending.values()]) if (work.ready) work.apply(); };
  const currentWriter = () => promoted ? replicaProcessState === "writer" ? "replica" as const : "none" as const : primaryProcessState === "available" ? "primary" as const : "none" as const;
  return {
    epoch: () => writerEpoch,
    currentWriter,
    sourceAvailable: (source: "primary" | "replica") => source === "primary" ? primaryProcessState === "available" : replicaProcessState !== "unavailable",
    acceptEpoch(epoch: number) { if (epoch === writerEpoch) return true; fencedWriteRejections++; return false; },
    canPromote() { return replicaProcessState === "available" && !promoted; },
    promote() {
      if (promoted) throw Error("Database replica already promoted; v1 has no second replica");
      if (replicaProcessState === "unavailable") throw Error("Database replica unavailable");
      lostOperations = pending.size;
      regressedKeys = [...primary].filter(([key, row]) => row.version > (replica.get(key)?.version ?? 0)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, row]) => ({ key, primaryVersion: row.version, promotedVersion: replica.get(key)?.version ?? 0 }));
      promoted = true; replicaProcessState = "writer";
      if (primaryProcessState !== "unavailable") primaryProcessState = "fenced";
      writerEpoch++; promotionAtUs = clock.now; pending.clear(); return replica;
    },
    primaryAvailability(value: boolean) { primaryProcessState = value ? promoted ? "fenced" : "available" : "unavailable"; },
    available(value: boolean) { replicaProcessState = value ? promoted ? "writer" : "available" : "unavailable"; if (value) drainReady(); },
    wholeAvailability(value: boolean) {
      if (!value && !crashRestore) { crashRestore = { primary: primaryProcessState, replica: replicaProcessState }; primaryProcessState = "unavailable"; replicaProcessState = "unavailable"; }
      else if (value && crashRestore) { primaryProcessState = crashRestore.primary; replicaProcessState = crashRestore.replica; crashRestore = undefined; drainReady(); }
    },
    readSource(readOnly: boolean) { return promoted || readOnly && replicaProcessState !== "unavailable" && config.readPolicy === "replica-preferred" ? "replica" as const : "primary" as const; },
    read(key: string, source: "primary" | "replica") { return (source === "replica" ? replica : primary).get(key); },
    observed(source: "primary" | "replica", keys: string[], observed: Array<Row & { key: string }>) {
      if (source === "primary") { primaryReads++; return; }
      replicaReads++;
      const stale = keys.some(key => (observed.find(row => row.key === key)?.version ?? 0) < ((promoted ? replica : primary).get(key)?.version ?? 0));
      if (stale) staleReplicaReads++; else freshReplicaReads++;
    },
    commit(writes: Map<string, Row>) {
      if (!writes.size) return;
      if (promoted) { replicaCommittedWrites++; replicaGeneration++; return; }
      const generation = ++primaryGeneration, payload = [...writes].map(([key, row]) => [key, { ...row }] as const);
      const epoch = writerEpoch;
      const work = { at: clock.now, ready: false, apply() {
        if (epoch !== writerEpoch) { fencedReplicationRejections++; return; }
        if (replicaProcessState === "unavailable") { work.ready = true; return; }
        for (const [key, row] of payload) replica.set(key, row);
        pending.delete(generation); replicaGeneration = generation; replicaAppliedWrites++;
      } };
      primaryCommittedWrites++; pending.set(generation, work);
      clock.schedule(clock.now + config.replicationDelayMs * 1000, 2, JSON.stringify(["db-replication", id, String(generation).padStart(16, "0")]), work.apply);
    },
    evidence() {
      const oldest = pending.values().next().value;
      const age = oldest ? (clock.now - oldest.at) / 1000 : 0;
      return { version: 1 as const, currentWriter: currentWriter(), primaryProcessState, replicaProcessState, replicaState: replicaProcessState === "unavailable" ? "unavailable" as const : promoted ? "promoted" as const : "available" as const, primaryReads, replicaReads, freshReplicaReads, staleReplicaReads,
        writerEpoch, primaryEpoch: 1, replicaEpoch: promoted ? 2 : 1, primaryRole: promoted ? "fenced" as const : "writer" as const, replicaRole: promoted ? "writer" as const : "replica" as const,
        fencedWriteRejections, fencedReplicationRejections, fencingReasons: { "fenced-writer-epoch": fencedWriteRejections, "fenced-replication-epoch": fencedReplicationRejections },
        primaryRows: [...primary].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, row]) => ({ key, ...row })),
        replicaCommittedWrites, promotionCount: promoted ? 1 : 0, promotionAtUs, lostOperations, regressedKeys: regressedKeys.map(row => ({ ...row })),
        primaryCommittedWrites, replicaAppliedWrites, pendingReplication: pending.size, lagMs: age, oldestPendingAgeMs: age, primaryGeneration, replicaGeneration,
        replicaRows: [...replica].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, row]) => ({ key, ...row })) };
    },
  };
}
