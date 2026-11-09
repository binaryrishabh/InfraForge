import type { EventClock } from "../time";

type Row = { version: number; bytes: number };
// One replacement incarnation on the original process, not a membership or consensus protocol.
// The authoritative promotion snapshot replaces divergent rows; lost acknowledgements stay lost.
export function databaseRejoin(id: string, epoch: number, delayMs: number, clock: EventClock, target: Map<string, Row>, writer: Map<string, Row>) {
  const copy = (rows: Map<string, Row>) => [...rows].map(([key, row]) => [key, { ...row }] as const);
  const snapshot = copy(writer), pending = new Map<number, ReturnType<typeof copy>>([[0, snapshot]]);
  let committed = 0, replayed = 0, snapshotApplied = false, joinedAtUs: number | null = null;
  let targetAvailable = false, writerAvailable = false, cancel: (() => boolean) | undefined;
  const pump = () => {
    if (cancel || !targetAvailable || !writerAvailable || !pending.size) return;
    const [sequence, payload] = pending.entries().next().value!;
    cancel = clock.schedule(clock.now + delayMs * 1000, 2, JSON.stringify(["db-rejoin", id, epoch, String(sequence).padStart(16, "0")]), () => {
      cancel = undefined;
      if (sequence === 0) { target.clear(); snapshotApplied = true; }
      for (const [key, row] of payload) target.set(key, { ...row });
      pending.delete(sequence);
      if (sequence > 0) replayed++;
      if (!pending.size && joinedAtUs === null) joinedAtUs = clock.now;
      pump();
    });
  };
  return {
    availability(targetUp: boolean, writerUp: boolean) {
      targetAvailable = targetUp; writerAvailable = writerUp;
      if ((!targetUp || !writerUp) && cancel) { cancel(); cancel = undefined; }
      pump();
    },
    commit(writes: Map<string, Row>) { pending.set(++committed, copy(writes)); pump(); },
    evidence() {
      return { version: 1 as const, memberId: JSON.stringify([id, "original-primary", epoch]), sourceMember: "replica" as const, epoch,
        state: !targetAvailable ? "waiting-for-return" as const : joinedAtUs !== null ? "replica" as const : "catching-up" as const,
        targetAvailable, writerAvailable, snapshotRows: snapshot.length, snapshotApplied, pendingBatches: pending.size,
        committedOperations: committed, replayedOperations: replayed, pendingOperations: committed - replayed,
        eligible: targetAvailable && writerAvailable && snapshotApplied && pending.size === 0, joinedAtUs };
    },
  };
}
