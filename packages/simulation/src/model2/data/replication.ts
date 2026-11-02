import type { DatabaseReplication } from "@infraforge/domain/resource";
import type { EventClock } from "../time";

type Row = { version: number; bytes: number };
// One atomic commit per message. Fixed delay and the kernel's ordering preserve commit order.
export function databaseReplica(config: DatabaseReplication, id: string, clock: EventClock, primary: Map<string, Row>) {
  const replica = new Map([...primary].map(([key, row]) => [key, { ...row }]));
  const pending = new Map<number, { at: number }>();
  let primaryCommittedWrites = 0, replicaAppliedWrites = 0, primaryGeneration = 0, replicaGeneration = 0;
  return {
    commit(writes: Map<string, Row>) {
      if (!writes.size) return;
      const generation = ++primaryGeneration, payload = [...writes].map(([key, row]) => [key, { ...row }] as const);
      primaryCommittedWrites++; pending.set(generation, { at: clock.now });
      clock.schedule(clock.now + config.replicationDelayMs * 1000, 2, JSON.stringify(["db-replication", id, generation]), () => {
        for (const [key, row] of payload) replica.set(key, row);
        pending.delete(generation); replicaGeneration = generation; replicaAppliedWrites++;
      });
    },
    evidence() {
      const oldest = pending.values().next().value;
      const age = oldest ? (clock.now - oldest.at) / 1000 : 0;
      return { version: 1 as const, currentWriter: "primary" as const, replicaState: "available" as const,
        primaryCommittedWrites, replicaAppliedWrites, pendingReplication: pending.size, lagMs: age, oldestPendingAgeMs: age, primaryGeneration, replicaGeneration,
        replicaRows: [...replica].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, row]) => ({ key, ...row })) };
    },
  };
}
