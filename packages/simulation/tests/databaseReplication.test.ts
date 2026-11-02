import { expect, test } from "bun:test";
import type { DataReply } from "../src/model2/data/contracts";
import { replicaFixture, databaseDesign, prepareDatabase } from "./databaseReplication.fixture";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";


test("replication applies exactly at commit plus modeled delay, pending drains and idle lag is zero", () => {
  for (const delay of [1, 7]) {
    const f = replicaFixture(delay); f.submit(); f.clock.advanceTo(100);
    expect(f.ha()).toMatchObject({ primaryCommittedWrites: 1, replicaAppliedWrites: 0, pendingReplication: 1, primaryGeneration: 1, replicaGeneration: 0, lagMs: 0 });
    f.clock.advanceTo(100 + delay * 1000 - 1); expect(f.ha().replicaRows[0]!.version).toBe(1);
    expect(f.ha().oldestPendingAgeMs).toBe((delay * 1000 - 1) / 1000);
    f.clock.advanceTo(100 + delay * 1000);
    expect(f.ha()).toMatchObject({ replicaAppliedWrites: 1, pendingReplication: 0, replicaGeneration: 1, lagMs: 0, oldestPendingAgeMs: 0 });
    expect(f.ha().replicaRows[0]!.version).toBe(2);
  }
});

test("replication preserves atomic multi-key commits and repeated hot-key versions", () => {
  const f = replicaFixture(); f.config.plans.heavy!.statements[0]!.keys = ["k0", "k1"];
  for (let n = 1; n <= 3; n++) { f.submit(); f.clock.advanceTo(n * 100); }
  expect(f.ha().pendingReplication).toBe(3); f.clock.advanceTo(2300);
  expect(f.ha().replicaRows.slice(0, 2).map(r => r.version)).toEqual([4, 4]);
  expect(f.ha().replicaAppliedWrites).toBe(3);
});

test("saved replication strictly binds captured profile and materialized config", () => {
  const design = databaseDesign(); design.resources.at(-1)!.databaseReplication = { version: 1, enabled: true, replicationDelayMs: 10, readPolicy: "primary" };
  const f = prepareDatabase(design); expect(f.contract.version).toContain("/db-replication/1");
  expect(contractFromDesign(design, { adapterProfiles: [] })).toHaveProperty("refused");
  expect(contractFromDesign(design, { adapterProfiles: ["db-replication/1", "db-replication/1"] })).toHaveProperty("refused");
  const role = f.contract.nodes.db!.resources.find(r => r.config.kind === "relational")!;
  if (role.config.kind !== "relational") throw Error("relational");
  role.config.replication!.replicationDelayMs++; expect(compileProduct(design, f.contract).ok).toBe(false);
  expect(prepareDatabase().runtime.evidence().data.databases[0]!).not.toHaveProperty("databaseReplication");
});

test("replica preferred returns actual older rows in the lag window and fresh rows after catch-up", () => {
  const f = replicaFixture(2, "replica-preferred"); f.submit(); f.clock.advanceTo(100);
  const stale = f.submit("light"); f.clock.advanceTo(200);
  expect((stale.message!.response as DataReply).rows![0]!.version).toBe(1);
  expect((stale.message!.response as DataReply).readSource).toBe("replica");
  expect(f.ha()).toMatchObject({ replicaReads: 1, staleReplicaReads: 1, freshReplicaReads: 0 });
  f.clock.advanceTo(2100); const fresh = f.submit("light"); f.clock.advanceTo(2200);
  expect((fresh.message!.response as DataReply).rows![0]!.version).toBe(2);
  expect(f.ha()).toMatchObject({ replicaReads: 2, staleReplicaReads: 1, freshReplicaReads: 1 });
});

test("primary policy and unavailable replica route to writer; only matching keys prove staleness", () => {
  for (const policy of ["primary", "replica-preferred"] as const) {
    const f = replicaFixture(2, policy); f.submit(); f.clock.advanceTo(100);
    const other = f.submit("light", "k1"); f.clock.advanceTo(200);
    expect((other.message!.response as DataReply).rows![0]!.version).toBe(1);
    expect(f.ha().staleReplicaReads).toBe(0);
    f.db.replicaAvailability(false);
    const fallback = f.submit("light"); f.clock.advanceTo(300);
    expect((fallback.message!.response as DataReply).rows![0]!.version).toBe(2);
    expect((fallback.message!.response as DataReply).readSource).toBe("primary");
    expect(f.ha().replicaReads).toBe(f.ha().freshReplicaReads + f.ha().staleReplicaReads);
    if (policy === "primary") expect(f.ha().replicaReads).toBe(0);
  }
});

test("repeated hot-key reads keep per-key versions and conserve fresh plus stale outcomes", () => {
  const f = replicaFixture(2, "replica-preferred");
  for (let n = 0; n < 4; n++) { f.submit("heavy", "k0"); f.clock.advanceTo(n * 200 + 100); f.submit("light", "k0"); f.clock.advanceTo(n * 200 + 200); }
  const cold = f.submit("light", "k2"); f.clock.advanceTo(900);
  expect((cold.message!.response as DataReply).rows![0]!.version).toBe(1);
  expect(f.ha()).toMatchObject({ replicaReads: 5, staleReplicaReads: 4, freshReplicaReads: 1 });
  const primary = replicaFixture(); primary.submit(); primary.clock.advanceTo(100);
  const fresh = primary.submit("light"); primary.clock.advanceTo(200);
  expect((fresh.message!.response as DataReply).rows![0]!.version).toBe(2);
  expect(primary.ha()).toMatchObject({ primaryReads: 1, replicaReads: 0 });
});
