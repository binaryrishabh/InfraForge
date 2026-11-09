import { expect, test } from "bun:test";
import { databaseReplica } from "../src/model2/data/replication";
import { EventKernel } from "../src/model2/time";
import { dataFixture } from "./dataFixture";
import { relationalDatabase } from "../src/model2/data/database";
import type { RelationalConfig } from "../src/model2/data/contracts";
import type { Invocation } from "../src/model2/workload/contracts";

function fixture() {
  const clock = new EventKernel(1000), rows = new Map([["k", { version: 1, bytes: 8 }]]);
  const db = databaseReplica({ version: 1, enabled: true, replicationDelayMs: 1, readPolicy: "primary", rejoin: "snapshot-replay/1" }, "db", clock, rows);
  let writer = rows;
  const write = (version: number, key = "k") => { const writes = new Map([[key, { version, bytes: 8 }]]); writer.set(key, writes.get(key)!); db.commit(writes); };
  return { clock, rows, db, write, promote: () => { writer = db.promote(); }, ha: () => db.evidence() };
}
const singleWriter = (f: ReturnType<typeof fixture>, expected: "primary" | "replica" | "none") => {
  const e = f.ha(); expect(e.currentWriter).toBe(expected);
  const writers = Number(e.primaryRole === "writer" && e.primaryProcessState === "available") + Number(e.replicaRole === "writer" && e.replicaProcessState === "writer");
  expect(writers).toBe(expected === "none" ? 0 : 1);
};

test("healthy replication, failure, promotion, fenced return, snapshot and ordered catch-up retain separate loss", () => {
  const f = fixture(); singleWriter(f, "primary");
  f.write(2); f.clock.advanceTo(1000); expect(f.ha()).toMatchObject({ replicaAppliedWrites: 1, pendingReplication: 0, rejoin: null });
  f.write(3); f.write(4, "old-only"); f.db.primaryAvailability(false); singleWriter(f, "none");
  f.promote(); singleWriter(f, "replica");
  expect(f.ha()).toMatchObject({ writerEpoch: 2, primaryEpoch: 1, promotionAtUs: 1000, lostOperations: 2, pendingReplication: 0,
    rejoin: { epoch: 2, memberId: '["db","original-primary",2]', state: "waiting-for-return", snapshotRows: 1, pendingBatches: 1, eligible: false } });
  const loss = f.ha().regressedKeys;
  f.write(3); f.write(4); f.clock.advanceTo(5000); singleWriter(f, "replica");
  expect(f.ha().rejoin).toMatchObject({ committedOperations: 2, replayedOperations: 0, pendingOperations: 2, pendingBatches: 3 });
  expect(f.ha().fencedReplicationRejections).toBe(2);
  f.db.primaryAvailability(true); singleWriter(f, "replica");
  expect(f.ha()).toMatchObject({ primaryProcessState: "fenced", primaryRole: "fenced", rejoin: { state: "catching-up", eligible: false } });
  f.clock.advanceTo(6000); // Authoritative snapshot, not max-version merge; remove old-only data.
  expect(f.ha().primaryRows).toEqual([{ key: "k", version: 2, bytes: 8 }]);
  expect(f.ha()).toMatchObject({ primaryEpoch: 2, primaryRole: "fenced", rejoin: { snapshotApplied: true, pendingOperations: 2, eligible: false } });
  f.clock.advanceTo(7000); expect(f.ha().primaryRows[0]!.version).toBe(3); singleWriter(f, "replica");
  f.clock.advanceTo(8000); singleWriter(f, "replica");
  expect(f.ha()).toMatchObject({ primaryRole: "replica", primaryProcessState: "replica", lostOperations: 2, regressedKeys: loss,
    rejoin: { state: "replica", pendingBatches: 0, pendingOperations: 0, replayedOperations: 2, eligible: true, joinedAtUs: 8000 } });
  expect(f.ha().primaryRows).toEqual(f.ha().replicaRows);
  expect(f.db.acceptEpoch(1)).toBe(false); expect(f.db.acceptEpoch(2)).toBe(true);
  expect(() => f.promote()).toThrow("already promoted");
  f.write(5); expect(f.ha().rejoin).toMatchObject({ state: "replica", eligible: false, pendingOperations: 1 });
  f.clock.advanceTo(9000); expect(f.ha().primaryRows).toEqual(f.ha().replicaRows); singleWriter(f, "replica");
});

test("outages pause ordered replay without losing queued commits or restoring the old writer", () => {
  const f = fixture(); f.promote(); f.write(2); f.clock.advanceTo(500);
  f.db.primaryAvailability(false); f.clock.advanceTo(2500);
  expect(f.ha().rejoin).toMatchObject({ snapshotApplied: false, pendingBatches: 2, eligible: false }); singleWriter(f, "replica");
  f.db.primaryAvailability(true); f.clock.advanceTo(3500);
  f.db.available(false); singleWriter(f, "none"); f.clock.advanceTo(6000);
  expect(f.ha().rejoin).toMatchObject({ snapshotApplied: true, pendingOperations: 1, writerAvailable: false, eligible: false });
  f.db.available(true); f.clock.advanceTo(6500); f.db.wholeAvailability(false); singleWriter(f, "none");
  f.clock.advanceTo(8500); expect(f.ha().rejoin!.replayedOperations).toBe(0);
  f.db.wholeAvailability(true); f.clock.advanceTo(9500); singleWriter(f, "replica");
  expect(f.ha().rejoin).toMatchObject({ eligible: true, replayedOperations: 1 });
  f.db.primaryAvailability(false); f.clock.advanceTo(10000); f.db.primaryAvailability(true); singleWriter(f, "replica");
  expect(f.ha().rejoin!.eligible).toBe(true); expect(f.ha().writerEpoch).toBe(2);
});

test("promotion closes stale PostgreSQL sessions; fresh sessions work before and after rejoin", () => {
  const config = dataFixture({ dbCpu: 100 }).resources.find(r => r.kind === "relational") as RelationalConfig;
  config.semantics = "postgresql-keyed/2";
  config.replication = { version: 1, enabled: true, replicationDelayMs: 1, readPolicy: "primary", rejoin: "snapshot-replay/1" };
  const clock = new EventKernel(1000), db = relationalDatabase(config, clock);
  const work = (id: string, sessionId: string, writerEpoch?: number): Invocation => ({ rootId: id, callId: id, sessionId, operation: "heavy", offeredAt: clock.now, attempt: 0, message: { request: { kind: "query", key: "k0", ...(writerEpoch === undefined ? {} : { writerEpoch }) } } });
  expect(db.openSession("old")).toBe(true);
  const active = work("active", "old"); expect(db.accept(active, () => {}).admitted).toBe(true);
  expect(db.openSession("idle")).toBe(true);
  db.promoteReplica(); expect(db.sessionAlive("old")).toBe(false);
  expect(db.sessionAlive("idle")).toBe(false); expect(active.message!.response).toMatchObject({reason: "fenced-writer-epoch"});
  const stale = work("stale", "old"); expect(db.accept(stale, () => {}).admitted).toBe(false);
  expect(stale.message!.response).toMatchObject({ reason: "session-not-established" });
  const obsolete = work("obsolete", "old", 1); expect(db.accept(obsolete, () => {}).admitted).toBe(false);
  expect(obsolete.message!.response).toMatchObject({ reason: "fenced-writer-epoch" });
  expect(db.openSession("fresh")).toBe(true); db.accept(work("new", "fresh"), () => {}); clock.advanceTo(5000);
  expect(db.evidence()).toMatchObject({ transactions: { committed: 1 }, databaseReplication: { primaryRole: "replica", writerEpoch: 2, rejoin: { eligible: true } } });
  db.primaryAvailability(false); db.primaryAvailability(true);
  expect(db.sessionAlive("fresh")).toBe(true); db.accept(work("after", "fresh"), () => {}); clock.advanceTo(10000);
  expect(db.evidence().transactions.committed).toBe(2); expect(db.evidence().databaseReplication!.currentWriter).toBe("replica");
});

test("same-time promotion and replay boundaries retain deterministic writer epoch, order and immutable payloads", () => {
  const trace = () => {
    const f = fixture(); const samples = [];
    f.write(2); f.clock.advanceTo(1000); f.promote();
    f.write(3); f.write(4); // Both commits share the promotion instant.
    for (const at of [1000, 1999, 2000, 2999, 3000, 4000]) { f.clock.advanceTo(at); singleWriter(f, "replica"); samples.push(f.ha()); }
    expect(samples.map(e => e.primaryRows[0]!.version)).toEqual([2, 2, 2, 2, 3, 4]);
    expect(samples.at(-1)!.rejoin).toMatchObject({eligible: true, replayedOperations: 2});
    expect(samples.every(e => e.writerEpoch === 2 && e.promotionAtUs === 1000)).toBe(true);
    return samples;
  };
  expect(trace()).toEqual(trace());
});
