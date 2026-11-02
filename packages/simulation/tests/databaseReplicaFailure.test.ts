import { expect, test } from "bun:test";
import { databaseDesign, prepareDatabase, promote, replicaFixture } from "./databaseReplication.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { interventionOptions } from "../src/model2/product/interventions";
import { withTimeline } from "../src/model2/product/timeline";
import { scenarioError } from "../src/model2/product/scenario";

const failReplica = { interventionId: "db-fail-replica", revision: 1, target: { resourceId: "db" }, parameters: { duration: 2 } };
function prepared() {
  const design = databaseDesign(); design.workload.readWriteRatio = 0.5;
  design.resources.at(-1)!.databaseReplication = { version: 1, enabled: true, replicationDelayMs: 2000, readPolicy: "replica-preferred" };
  return { design, ...prepareDatabase(design) };
}

test("replica-only timed failure keeps primary commits serving, queues delayed replication and falls back reads", () => {
  const f = prepared();
  expect(interventionOptions(f.design, f.contract, f.compiled.input).some(o => o.interventionId === failReplica.interventionId)).toBe(true);
  f.contract.interventions = [{ id: "fail", atUs: 1_000_001, request: failReplica }];
  const c = compileProduct(f.design, f.contract); if (!c.ok) throw Error(JSON.stringify(c));
  const run = createProductModel2(c.value), stepped = createProductModel2(c.value);
  const ha = () => run.inspectData.database("db")!.databaseReplication!;
  run.advanceTo(1_000_000); const before = ha();
  run.advanceTo(3_000_000); const down = ha();
  expect(down).toMatchObject({ currentWriter: "primary", primaryProcessState: "available", replicaProcessState: "unavailable", replicaAppliedWrites: 0 });
  expect(down.primaryCommittedWrites).toBeGreaterThan(before.primaryCommittedWrites);
  expect(down.pendingReplication).toBeGreaterThan(before.pendingReplication);
  expect(down.lagMs).toBeGreaterThan(before.lagMs);
  expect(down.primaryReads).toBeGreaterThan(before.primaryReads);
  expect(down.failedWritesWithoutWriter).toBe(0);
  expect(down.replicaRows).toEqual(before.replicaRows);
  run.advanceTo(3_000_001); const returned = ha();
  expect(returned.replicaAppliedWrites).toBeGreaterThan(0);
  expect(returned.pendingReplication).toBeGreaterThan(0); // commits not yet due must remain pending
  expect(returned.replicaRows).not.toEqual(returned.primaryRows);
  run.advanceTo(run.horizon);
  for (let at = 123457; at < stepped.horizon; at += 123457) stepped.advanceTo(at);
  stepped.advanceTo(stepped.horizon);
  expect(run.evidence()).toEqual(stepped.evidence());
  const one = createProductModel2(c.value); one.advanceTo(one.horizon); expect(one.evidence()).toEqual(run.evidence());
});

test("replica catch-up applies only due atomic messages in commit order across double-digit generations", () => {
  const f = replicaFixture(1, "replica-preferred"); f.db.replicaAvailability(false);
  for (let n = 1; n <= 12; n++) { f.submit(); f.clock.advanceTo(n * 100); }
  expect(f.ha()).toMatchObject({ primaryCommittedWrites: 12, replicaAppliedWrites: 0, pendingReplication: 12 });
  f.db.replicaAvailability(true);
  expect(f.ha()).toMatchObject({ replicaAppliedWrites: 2, pendingReplication: 10, replicaGeneration: 2 });
  expect(f.ha().replicaRows[0]!.version).toBe(3);
  f.clock.advanceTo(2200);
  expect(f.ha()).toMatchObject({ replicaAppliedWrites: 12, pendingReplication: 0, lagMs: 0 });
  expect(f.ha().replicaRows).toEqual(f.ha().primaryRows);
});

test("compiler refuses promotion throughout replica outage regardless of row ordering, overlapping failures, Crash and horizon", () => {
  const f = prepared();
  const failure = { id: "fail", atUs: 1_000_001, request: failReplica };
  const promotion = { id: "promote", atUs: 2_000_001, request: promote };
  for (const rows of [[failure, promotion], [promotion, failure]]) {
    f.contract.interventions = rows; expect(compileProduct(f.design, f.contract).ok).toBe(false);
  }
  f.contract.interventions = [failure, { ...failure, id: "again", atUs: 2_000_001 }]; expect(compileProduct(f.design, f.contract).ok).toBe(false);
  f.contract.interventions = [promotion, { ...failure, atUs: 4_000_001 }]; expect(compileProduct(f.design, f.contract).ok).toBe(false);
  f.contract.interventions = [failure, { ...promotion, atUs: 3_000_001 }]; expect(compileProduct(f.design, f.contract).ok).toBe(true);
  f.contract.interventions = [failure];
  expect(compileProduct(f.design, withTimeline(f.contract, [{ id: "crash", kind: "crash", node: "db", atUs: 2_000_000, durationUs: 1_000_000, restartUs: 1_000_000 }])).ok).toBe(false);
  f.contract.interventions = [{ ...failure, atUs: 59_000_000 }]; expect(compileProduct(f.design, f.contract).ok).toBe(false);
  const old = prepareDatabase(); expect(interventionOptions(databaseDesign(), old.contract, old.compiled.input).some(o => o.interventionId === failReplica.interventionId)).toBe(false);
  expect(scenarioError({ version: 1, visibility: "revealed", steps: [{ id: "fail", atSecond: 1, request: failReplica }] }, 10)).toContain("Free World");
});
