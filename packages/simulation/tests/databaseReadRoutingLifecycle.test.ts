import { expect, test } from "bun:test";
import { relationalDatabase } from "../src/model2/data/database";
import type { RelationalConfig, DataReply } from "../src/model2/data/contracts";
import type { Invocation } from "../src/model2/workload/contracts";
import { EventKernel } from "../src/model2/time";
import { dataFixture } from "./dataFixture";

function fixture(policy: "primary-only" | "replica-preferred") {
  const config = dataFixture({ dbCpu: 100, sessions: 4, activeTransactions: 1 }).resources.find(r => r.kind === "relational") as RelationalConfig;
  config.semantics = "postgresql-keyed/2";
  config.replication = { version: 1, enabled: true, replicationDelayMs: 2, readPolicy: "primary" };
  config.readRouting = { version: 1, policy };
  const clock = new EventKernel(10000), db = relationalDatabase(config, clock);
  const submit = (id: string, operation = "light", session = id, epoch?: number) => {
    const work: Invocation = { rootId: id, callId: id, sessionId: session, operation, offeredAt: clock.now, attempt: 0, message: { request: { kind: "query", key: "k0", ...(epoch === undefined ? {} : { writerEpoch: epoch }) } } };
    const opened = db.openSession(session), receipt = db.accept(work, () => {});
    return { work, receipt, opened, reply: () => work.message!.response as DataReply };
  };
  return { config, clock, db, submit, ha: () => db.evidence().databaseReplication!, routing: () => db.evidence().databaseReadRouting! };
}

for (const policy of ["primary-only", "replica-preferred"] as const) {
  test(`primary outage preserves only surviving member transactions and sessions: ${policy}`, () => {
    const f = fixture(policy), read = f.submit("r"), queued = f.submit("queued");
    f.clock.advanceTo(10);
    const invalid = f.db.primaryAvailability(false);
    expect(invalid).toEqual(policy === "primary-only" ? ["r", "queued"] : []);
    expect(f.db.sessionAlive("r")).toBe(policy === "replica-preferred");
    expect(f.submit("write-down", "heavy").reply().reason).toBe("no-writer-available");
    const during = f.submit("new-read");
    expect(during.receipt.admitted).toBe(policy === "replica-preferred");
    f.clock.advanceTo(500);
    for (const r of [read, queued, during]) expect(r.reply().ok).toBe(policy === "replica-preferred");
    expect(f.db.evidence().transactions.live).toBe(0);
    const sessions = f.db.evidence().sessions.total;
    expect(f.db.primaryAvailability(true)).toEqual([]);
    expect(f.db.evidence().sessions.total).toBe(sessions);
    const restored = f.submit("write-restored", "heavy"); f.clock.advanceTo(700);
    expect(restored.reply().ok).toBe(true); expect(f.ha().writerEpoch).toBe(1);
  });

  test(`replica outage terminates pinned reads; new reads fall back without replaying aborted work: ${policy}`, () => {
    const f = fixture(policy), read = f.submit("r"), write = f.submit("w", "heavy");
    f.clock.advanceTo(10); const invalid = f.db.replicaAvailability(false);
    expect(invalid).toEqual(policy === "replica-preferred" ? ["r"] : []);
    const fallback = f.submit("fallback");
    f.clock.advanceTo(500);
    expect(read.reply().ok).toBe(policy === "primary-only");
    if (policy === "replica-preferred") expect(read.reply().reason).toBe("database-replica-unavailable");
    expect(write.reply().ok).toBe(true); expect(fallback.reply()).toMatchObject({ ok: true, readSource: "primary" });
    const terminal = f.db.evidence().transactions;
    f.db.replicaAvailability(true);
    expect(f.db.evidence().transactions).toEqual(terminal);
    const after = f.submit("after-return"); f.clock.advanceTo(700);
    expect(after.reply().readSource).toBe(policy === "primary-only" ? "primary" : "replica");
    expect(f.db.evidence().transactions.live).toBe(0);
    expect(f.routing().members.replica.aborted).toBe(policy === "replica-preferred" ? 1 : 0);
  });

  test(`promotion fences active and queued old writes; fresh sessions use the promoted writer: ${policy}`, () => {
    const f = fixture(policy); f.submit("committed", "heavy"); f.clock.advanceTo(200);
    const active = f.submit("active", "heavy"), queued = f.submit("queued", "heavy");
    f.clock.advanceTo(210); const invalid = f.db.promoteReplica();
    expect(invalid).toEqual(["committed", "active", "queued"]);
    for (const work of [active, queued]) expect(work.reply().reason).toBe("fenced-writer-epoch");
    expect(f.db.sessionAlive("active")).toBe(false);
    expect(f.ha()).toMatchObject({ writerEpoch: 2, currentWriter: "replica", lostOperations: 1 });
    const old = f.submit("old-writer", "heavy", "old-writer", 1); expect(old.reply().reason).toBe("fenced-writer-epoch");
    f.db.primaryAvailability(false); f.db.primaryAvailability(true);
    const fresh = f.submit("fresh", "heavy"), read = f.submit("read");
    f.clock.advanceTo(500);
    expect(fresh.reply().ok).toBe(true); expect(read.reply()).toMatchObject({ ok: true, readSource: "replica" });
    expect(f.ha()).toMatchObject({ primaryProcessState: "fenced", replicaCommittedWrites: 1, primaryCommittedWrites: 1, fencedWriteRejections: 3 });
    f.clock.advanceTo(2200);
    expect(f.ha()).toMatchObject({ fencedReplicationRejections: 1, pendingReplication: 0, replicaAppliedWrites: 0 });
    expect(f.db.evidence().transactions).toMatchObject({ live: 0, admitted: 5, committed: 3, aborted: 2 });
  });
}

test("returning replica keeps delayed outstanding commits until due and drains only ready commits", () => {
  const f = fixture("replica-preferred");
  f.db.replicaAvailability(false); f.submit("w1", "heavy"); f.clock.advanceTo(200);
  expect(f.ha()).toMatchObject({ pendingReplication: 1, replicaAppliedWrites: 0 });
  f.clock.advanceTo(500); f.db.replicaAvailability(true);
  expect(f.ha()).toMatchObject({ pendingReplication: 1, replicaAppliedWrites: 0 });
  const stale = f.submit("stale"); f.clock.advanceTo(700);
  expect(stale.reply().rows![0]!.version).toBe(1); expect(f.routing().maxStaleReadAgeMs).toBe(0.4);
  f.submit("w2", "heavy"); f.clock.advanceTo(2099);
  expect(f.ha()).toMatchObject({ pendingReplication: 2, replicaAppliedWrites: 0 });
  f.clock.advanceTo(2100); expect(f.ha()).toMatchObject({ pendingReplication: 1, replicaAppliedWrites: 1 });
  f.db.replicaAvailability(false); f.clock.advanceTo(3000);
  expect(f.ha()).toMatchObject({ pendingReplication: 1, replicaAppliedWrites: 1 });
  f.db.replicaAvailability(true);
  expect(f.ha()).toMatchObject({ pendingReplication: 0, replicaAppliedWrites: 2 });
  expect(f.ha().replicaRows).toEqual(f.ha().primaryRows);
});

test("idle routed sessions can rebind, busy sessions cannot; router connections have a finite bound", () => {
  const f = fixture("replica-preferred");
  const r = f.submit("r", "light", "shared");
  expect(f.submit("busy", "heavy", "shared").reply().reason).toBe("session-busy");
  f.clock.advanceTo(200); expect(r.reply().ok).toBe(true);
  expect(f.routing().members.replica.sessions).toBe(1);
  const w = f.submit("w", "heavy", "shared");
  expect(f.routing().members.replica.sessions).toBe(0); expect(f.routing().members.primary.sessions).toBe(1);
  f.clock.advanceTo(400); expect(w.reply().ok).toBe(true);
  for (let i = 0; i < 7; i++) expect(f.db.openSession(`unbound-${i}`)).toBe(true);
  expect(f.db.openSession("overflow")).toBe(false);
  expect(f.db.evidence().sessions.total).toBe(8); expect(f.routing().unboundSessions).toBe(7);
  expect(f.db.evidence().sessions.limit).toBe(8);
  f.db.closeSession("shared"); expect(f.routing().members.primary.sessions).toBe(0);
});

test("equal-time member failure precedes CPU completion; recovery precedes arrivals and replication keeps its delay", () => {
  const f = fixture("replica-preferred"), read = f.submit("r");
  f.clock.schedule(100, 0, "fail-replica", () => f.db.replicaAvailability(false));
  f.clock.schedule(100, 3, "new-arrival", () => f.submit("fallback"));
  f.clock.advanceTo(300);
  expect(read.reply()).toMatchObject({ ok: false, reason: "database-replica-unavailable" });
  expect(f.routing().members.primary.committed).toBe(1);
  f.submit("w", "heavy"); f.clock.advanceTo(500);
  let newRead: ReturnType<typeof f.submit>;
  f.clock.schedule(600, -1, "recover-replica", () => f.db.replicaAvailability(true));
  f.clock.schedule(600, 3, "arrival-after-recovery", () => { newRead = f.submit("after-recovery"); });
  f.clock.advanceTo(800);
  expect(newRead!.reply()).toMatchObject({ ok: true, readSource: "replica", rows: [{ key: "k0", version: 1, bytes: 64 }] });
  expect(f.ha()).toMatchObject({ replicaAppliedWrites: 0, pendingReplication: 1 });
  f.clock.advanceTo(2400); expect(f.ha()).toMatchObject({ replicaAppliedWrites: 1, pendingReplication: 0 });
});

test("promotion invalidates in-flight reader sessions rather than silently rerouting their snapshots", () => {
  const f = fixture("replica-preferred"), read = f.submit("r");
  f.clock.advanceTo(10); expect(f.db.promoteReplica()).toEqual(["r"]);
  expect(read.reply()).toMatchObject({ ok: false, reason: "writer-promoted" });
  const next = f.submit("next"); f.clock.advanceTo(300);
  expect(next.reply()).toMatchObject({ ok: true, readSource: "replica" });
  expect(f.routing().members.replica).toMatchObject({ admitted: 2, committed: 1, aborted: 1 });
});

test("member accounting conserves cancellation, timeout and orphaned transactions without releasing live slots early", () => {
  const f = fixture("replica-preferred"), cancelled = f.submit("cancel"), orphan = f.submit("orphan");
  expect(cancelled.receipt.cancel()).toBe("cancelled");
  f.db.closeSession("orphan");
  expect(f.db.evidence().sessions.orphaned).toBe(1);
  expect(f.routing().members.replica.active).toBe(1);
  f.clock.advanceTo(200);
  expect(orphan.reply().reason).toBe("connection-closed");
  expect(f.db.sessionAlive("orphan")).toBe(false);
  const timeout = f.config.plans.light!.transactionTimeout;
  if (timeout.kind !== "known") throw Error("Timeout"); timeout.value = 50;
  const timed = f.submit("timeout"); f.clock.advanceTo(300);
  expect(timed.reply().reason).toBe("transaction-timeout");
  expect(f.db.sessionAlive("timeout")).toBe(false);
  expect(f.routing().members.replica).toMatchObject({ admitted: 3, committed: 0, cancelled: 1, aborted: 2, active: 0, queued: 0, sessions: 1 });
});

test("only snapshot-only transactions use the read replica; locking reads stay with the writer", () => {
  const f = fixture("replica-preferred"); f.config.plans.light!.statements[0]!.kind = "lock-read";
  const read = f.submit("locked-read"); f.clock.advanceTo(200);
  expect(read.reply()).toMatchObject({ ok: true, readSource: "primary" });
  expect(f.routing().members.replica.admitted).toBe(0);
});
