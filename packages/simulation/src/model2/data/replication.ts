import type { DatabaseReplication } from "@infraforge/domain/resource";
import type { EventClock } from "../time";

type Row = { version: number; bytes: number };
// One atomic commit per message. Fixed delay and the kernel's ordering preserve commit order.
export function databaseReplica(config: DatabaseReplication, id: string, clock: EventClock, primary: Map<string, Row>) {
  const replica = new Map([...primary].map(([key, row]) => [key, { ...row }]));
  const pending = new Map<number, { at: number }>();
  let primaryCommittedWrites = 0, replicaAppliedWrites = 0, primaryGeneration = 0, replicaGeneration = 0;
  let promoted = false, replicaCommittedWrites = 0, promotionAtUs: number | null = null, lostOperations = 0;
  let regressedKeys: Array<{ key: string; primaryVersion: number; promotedVersion: number }> = [];
  let available = true, primaryReads = 0, replicaReads = 0, freshReplicaReads = 0, staleReplicaReads = 0;
  return {
    canPromote() { return available && !promoted; },
    promote() {
      if (promoted) throw Error("Database replica already promoted; v1 has no second replica");
      if (!available) throw Error("Database replica unavailable");
      lostOperations = pending.size;
      regressedKeys = [...primary].filter(([key, row]) => row.version > (replica.get(key)?.version ?? 0)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, row]) => ({ key, primaryVersion: row.version, promotedVersion: replica.get(key)?.version ?? 0 }));
      promoted = true; promotionAtUs = clock.now; pending.clear(); return replica;
    },
    available(value: boolean) { available = value; },
    readSource(readOnly: boolean) { return promoted || readOnly && available && config.readPolicy === "replica-preferred" ? "replica" as const : "primary" as const; },
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
      primaryCommittedWrites++; pending.set(generation, { at: clock.now });
      clock.schedule(clock.now + config.replicationDelayMs * 1000, 2, JSON.stringify(["db-replication", id, generation]), () => {
        if (promoted) return;
        for (const [key, row] of payload) replica.set(key, row);
        pending.delete(generation); replicaGeneration = generation; replicaAppliedWrites++;
      });
    },
    evidence() {
      const oldest = pending.values().next().value;
      const age = oldest ? (clock.now - oldest.at) / 1000 : 0;
      return { version: 1 as const, currentWriter: promoted ? "replica" as const : "primary" as const, replicaState: promoted ? "promoted" as const : available ? "available" as const : "unavailable" as const, primaryReads, replicaReads, freshReplicaReads, staleReplicaReads,
        replicaCommittedWrites, promotionCount: promoted ? 1 : 0, promotionAtUs, lostOperations, regressedKeys: regressedKeys.map(row => ({ ...row })),
        primaryCommittedWrites, replicaAppliedWrites, pendingReplication: pending.size, lagMs: age, oldestPendingAgeMs: age, primaryGeneration, replicaGeneration,
        replicaRows: [...replica].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, row]) => ({ key, ...row })) };
    },
  };
}
