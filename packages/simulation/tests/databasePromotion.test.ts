import { expect, test } from "bun:test";
import { replicaFixture } from "./databaseReplication.fixture";
import { databaseDesign, prepareDatabase } from "./databaseReplication.fixture";
import { interventionOptions } from "../src/model2/product/interventions";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";

export const promote = { interventionId: "db-promote-replica", revision: 1, target: { resourceId: "db" }, parameters: {} };
test("promotion loses only unapplied acknowledged commits and subsequent writes use replica", () => {
  const f = replicaFixture(); f.submit(); f.clock.advanceTo(100);
  f.db.promoteReplica();
  expect(f.ha()).toMatchObject({ currentWriter: "replica", replicaState: "promoted", promotionCount: 1, promotionAtUs: 100, lostOperations: 1, regressedKeys: [{ key: "k0", primaryVersion: 2, promotedVersion: 1 }] });
  expect(f.db.evidence().rows[0]!.version).toBe(1);
  f.submit(); f.clock.advanceTo(200);
  expect(f.db.evidence().rows[0]!.version).toBe(2);
  expect(f.ha()).toMatchObject({ primaryCommittedWrites: 1, replicaCommittedWrites: 1 });
  expect(() => f.db.promoteReplica()).toThrow("already promoted");
});
test("caught-up promotion has no loss; unavailable replica refuses", () => {
  const f = replicaFixture(); f.submit(); f.clock.advanceTo(2100); f.db.promoteReplica();
  expect(f.ha()).toMatchObject({ lostOperations: 0, regressedKeys: [] });
  const down = replicaFixture(); down.db.replicaAvailability(false); expect(() => down.db.promoteReplica()).toThrow("unavailable");
});
test("promotion intervention owns an enabled replica, applies at exact receipt time, and refuses second promotion", () => {
  const design = databaseDesign(); design.resources.at(-1)!.databaseReplication = { version: 1, enabled: true, replicationDelayMs: 1000, readPolicy: "replica-preferred" };
  const f = prepareDatabase(design);
  expect(interventionOptions(design, f.contract, f.compiled.input).some(o => o.interventionId === promote.interventionId)).toBe(true);
  f.contract.interventions = [{ id: "promote", atUs: 1_000_001, request: promote }];
  const c = compileProduct(design, f.contract); if (!c.ok) throw Error(JSON.stringify(c));
  expect(c.value.interventionReceipts![0]).toMatchObject({ atUs: 1_000_001, endUs: null });
  const runtime = createProductModel2(c.value); runtime.advanceTo(1_000_000);
  expect(runtime.inspectData.database("db")!.databaseReplication!.currentWriter).toBe("primary");
  runtime.advanceTo(1_000_001); expect(runtime.inspectData.database("db")!.databaseReplication!.currentWriter).toBe("replica");
  f.contract.interventions.push({ id: "again", atUs: 2_000_001, request: promote }); expect(compileProduct(design, f.contract).ok).toBe(false);
  delete design.resources.at(-1)!.databaseReplication;
  const old = prepareDatabase(design); expect(interventionOptions(design, old.contract, old.compiled.input).some(o => o.interventionId === promote.interventionId)).toBe(false);
});
