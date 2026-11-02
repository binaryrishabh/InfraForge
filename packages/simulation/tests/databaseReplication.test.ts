import { expect, test } from "bun:test";
import { relationalDatabase } from "../src/model2/data/database";
import { EventKernel } from "../src/model2/time";
import type { DataReply, RelationalConfig } from "../src/model2/data/contracts";
import type { Invocation } from "../src/model2/workload/contracts";
import { dataFixture } from "./dataFixture";
import { databaseDesign, prepareDatabase } from "./databaseReplication.fixture";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";

export function replicaFixture(delay = 2, policy: "primary" | "replica-preferred" = "primary") {
  const config = dataFixture({ dbCpu: 100 }).resources.find(r => r.kind === "relational") as RelationalConfig;
  config.replication = { version: 1, enabled: true, replicationDelayMs: delay, readPolicy: policy };
  const clock = new EventKernel(10000), db = relationalDatabase(config, clock);
  let sequence = 0;
  const submit = (operation = "heavy", key = "k0") => {
    const id = `work-${sequence++}`;
    const work: Invocation = { rootId: id, callId: id, sessionId: id, operation, attempt: 0, offeredAt: clock.now, message: { request: { kind: "query", key } } };
    db.accept(work, () => {}); return work;
  };
  return { config, clock, db, submit, ha: () => db.evidence().databaseReplication! };
}

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
