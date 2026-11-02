import { expect, test } from "bun:test";
import { replicaFixture, databaseDesign, prepareDatabase } from "./databaseReplication.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { promote } from "./databaseReplication.fixture";
import { withTimeline } from "../src/model2/product/timeline";
import type { Invocation } from "../src/model2/workload/contracts";
import { relationalDatabase } from "../src/model2/data/database";
import { EventKernel } from "../src/model2/time";
import { dataFixture } from "./dataFixture";
import type { RelationalConfig } from "../src/model2/data/contracts";

test("promotion increments writer epoch and rejects old-epoch writes and late replication", () => {
  const f = replicaFixture(); f.submit(); f.clock.advanceTo(100); f.db.promoteReplica();
  expect(f.ha()).toMatchObject({ writerEpoch: 2, primaryEpoch: 1, replicaEpoch: 2, primaryRole: "fenced", replicaRole: "writer" });
  const old: Invocation = { callId: "old", rootId: "old", sessionId: "old", operation: "heavy", attempt: 0, offeredAt: 100, message: { request: { kind: "query", key: "k0", writerEpoch: 1 } } };
  expect(f.db.accept(old, () => {}).admitted).toBe(false);
  expect(f.db.evidence().reasons["fenced-writer-epoch"]).toBe(1);
  f.submit(); f.clock.advanceTo(2100);
  expect(f.ha()).toMatchObject({ fencedWriteRejections: 1, fencedReplicationRejections: 1, replicaCommittedWrites: 1 });
  expect(f.db.evidence().rows[0]!.version).toBe(2);
  expect(f.ha().primaryRows[0]!.version).toBe(2);
});

test("in-flight old writer transactions are fenced when promotion interrupts their commit", () => {
  const f = replicaFixture(); f.submit(); f.clock.advanceTo(50); f.db.promoteReplica(); f.clock.advanceTo(5000);
  expect(f.ha().fencedWriteRejections).toBe(1);
  expect(f.db.evidence().transactions).toMatchObject({ committed: 0, aborted: 1 });
  expect(f.db.evidence().rows[0]!.version).toBe(1);
});

test("real Crash/restart retains the single writer role and is deterministic one-shot versus stepped", () => {
  for (const promoted of [false, true]) {
    const design = databaseDesign(); design.resources.at(-1)!.databaseReplication = { version: 1, enabled: true, replicationDelayMs: 1000, readPolicy: "replica-preferred" };
    const f = prepareDatabase(design);
    if (promoted) f.contract.interventions = [{ id: "promote", atUs: 1_000_001, request: promote }];
    const contract = withTimeline(f.contract, [{ id: "crash", kind: "crash", node: "db", atUs: 2_000_001, durationUs: 1_000_000, restartUs: 1_000_000 }]);
    const c = compileProduct(design, contract); if (!c.ok) throw Error(JSON.stringify(c));
    const run = createProductModel2(c.value), stepped = createProductModel2(c.value);
    run.advanceTo(2_500_000); expect(run.up("db")).toBe(false);
    const beforeRestart = run.inspectData.database("db")!.databaseReplication!;
    run.advanceTo(5_000_000); expect(run.up("db")).toBe(true);
    const ha = run.inspectData.database("db")!.databaseReplication!;
    expect(ha).toMatchObject({ writerEpoch: promoted ? 2 : 1, currentWriter: promoted ? "replica" : "primary", primaryRole: promoted ? "fenced" : "writer", replicaRole: promoted ? "writer" : "replica" });
    expect(promoted ? ha.replicaCommittedWrites : ha.primaryCommittedWrites).toBeGreaterThan(promoted ? beforeRestart.replicaCommittedWrites : beforeRestart.primaryCommittedWrites);
    if (promoted) expect(ha.primaryRows).toEqual(beforeRestart.primaryRows);
    run.advanceTo(run.horizon); for (let at = 123457; at < stepped.horizon; at += 123457) stepped.advanceTo(at); stepped.advanceTo(stepped.horizon);
    expect(stepped.evidence()).toEqual(run.evidence());
    const oneShot = createProductModel2(c.value); oneShot.advanceTo(oneShot.horizon); expect(oneShot.evidence()).toEqual(stepped.evidence());
  }
});

test("replication disabled refuses promotion and crash/restart keeps historical primary rows", () => {
  const config = dataFixture().resources.find(r => r.kind === "relational") as RelationalConfig;
  const db = relationalDatabase(config, new EventKernel(10000));
  expect(() => db.promoteReplica()).toThrow("disabled"); db.pause(true); db.pause(false);
  expect(db.evidence()).not.toHaveProperty("databaseReplication"); expect(db.evidence().rows[0]!.version).toBe(1);
});


test("equal-time replication retains generation order past single-digit sequence numbers", async () => {
  const { databaseReplica } = await import("../src/model2/data/replication");
  const clock = new EventKernel(100), primary = new Map([["hot", { version: 1, bytes: 64 }]]);
  const replica = databaseReplica({ version: 1, enabled: true, replicationDelayMs: 1, readPolicy: "primary" }, "db", clock, primary);
  for (let version = 2; version <= 13; version++) { const writes = new Map([["hot", { version, bytes: 64 }]]); primary.set("hot", writes.get("hot")!); replica.commit(writes); }
  clock.advanceTo(1000); expect(replica.evidence()).toMatchObject({ replicaGeneration: 12, replicaAppliedWrites: 12, pendingReplication: 0, replicaRows: [{ key: "hot", version: 13, bytes: 64 }] });
});

test("unavailable replica holds due messages until return and primary reads remain available", () => {
  const f = replicaFixture(1, "replica-preferred"); f.submit(); f.clock.advanceTo(100); f.db.replicaAvailability(false);
  f.clock.advanceTo(1100); expect(f.ha()).toMatchObject({ pendingReplication: 1, replicaAppliedWrites: 0 });
  f.db.replicaAvailability(true); expect(f.ha()).toMatchObject({ pendingReplication: 0, replicaAppliedWrites: 1 });
});


test("automatic hot-key selection preserves a supplied writer epoch for fencing", () => {
  const f = replicaFixture(); f.config.access = "keyed-hot"; f.db.promoteReplica();
  const old: Invocation = { callId: "old-keyless", rootId: "old-keyless", operation: "heavy", attempt: 0, offeredAt: 0, message: { request: { kind: "query", writerEpoch: 1 } } };
  expect(f.db.accept(old, () => {}).admitted).toBe(false);
  expect(f.db.evidence().reasons["fenced-writer-epoch"]).toBe(1);
});


test("a queued replica-preferred read falls back if replica goes down before it executes", () => {
  const f = replicaFixture(2, "replica-preferred");
  if (f.config.activeTransactions.kind !== "known") throw Error("known admission budget");
  f.config.activeTransactions.value = 1;
  f.submit(); const read = f.submit("light"); f.clock.advanceTo(50); f.db.replicaAvailability(false); f.clock.advanceTo(200);
  expect(read.message!.response).toMatchObject({ ok: true, readSource: "primary", rows: [{ key: "k0", version: 2, bytes: 64 }] });
  expect(f.ha()).toMatchObject({ primaryReads: 1, replicaReads: 0 });
});
