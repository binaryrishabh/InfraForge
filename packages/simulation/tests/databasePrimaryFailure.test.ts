import { expect, test } from "bun:test";
import { replicaFixture, databaseDesign, prepareDatabase, promote } from "./databaseReplication.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { interventionOptions } from "../src/model2/product/interventions";
import { withTimeline } from "../src/model2/product/timeline";
import { scenarioError } from "../src/model2/product/scenario";

export const failPrimary = { interventionId: "db-fail-primary", revision: 1, target: { resourceId: "db" }, parameters: { duration: 2 } };

test("primary-only failure aborts work, invalidates sessions, preserves replica and returns the unpromoted writer", () => {
  for (const policy of ["primary", "replica-preferred"] as const) {
    const f = replicaFixture(2, policy); f.submit(); f.clock.advanceTo(100);
    const interrupted = f.submit(); f.clock.advanceTo(150); f.db.primaryAvailability(false);
    expect(interrupted.message!.response).toMatchObject({ ok: false, reason: "database-primary-unavailable" });
    expect(f.db.sessionAlive(interrupted.sessionId!)).toBe(false);
    expect(f.ha()).toMatchObject({ currentWriter: "none", replicaProcessState: "available" });
    const write = f.submit(); const read = f.submit("light"); f.clock.advanceTo(250);
    expect(write.message!.response).toMatchObject({ ok: false, reason: "no-writer-available" });
    expect(read.message!.response).toMatchObject(policy === "primary" ? { ok: false, reason: "database-primary-unavailable" } : { ok: true, readSource: "replica", rows: [{ key: "k0", version: 1, bytes: 64 }] });
    expect(f.ha().failedWritesWithoutWriter).toBe(1);
    if (policy === "replica-preferred") expect(f.ha().staleReplicaReads).toBe(1);
    f.db.primaryAvailability(true); f.submit(); f.clock.advanceTo(350);
    expect(f.ha()).toMatchObject({ currentWriter: "primary", writerEpoch: 1, primaryCommittedWrites: 2, replicaProcessState: "available" });
  }
});

test("timed primary outage owns enabled HA, applies and restores at exact times, refuses Crash/duplicate overlap and horizon", () => {
  const design = databaseDesign(); design.resources.at(-1)!.databaseReplication = { version: 1, enabled: true, replicationDelayMs: 10, readPolicy: "primary" };
  const f = prepareDatabase(design);
  expect(interventionOptions(design, f.contract, f.compiled.input).some(o => o.interventionId === failPrimary.interventionId)).toBe(true);
  f.contract.interventions = [{ id: "fail", atUs: 1_000_001, request: failPrimary }];
  const compile = () => compileProduct(design, f.contract);
  const c = compile(); if (!c.ok) throw Error(JSON.stringify(c));
  const run = createProductModel2(c.value); run.advanceTo(1_000_000); expect(run.inspectData.database("db")!.databaseReplication!.currentWriter).toBe("primary");
  run.advanceTo(1_000_001); expect(run.inspectData.database("db")!.databaseReplication!).toMatchObject({ currentWriter: "none", replicaProcessState: "available" });
  run.advanceTo(3_000_001); expect(run.inspectData.database("db")!.databaseReplication!.currentWriter).toBe("primary");
  f.contract.interventions.push({ id: "again", atUs: 2_000_001, request: failPrimary }); expect(compile().ok).toBe(false); f.contract.interventions.pop();
  expect(compileProduct(design, withTimeline(f.contract, [{ id: "crash", kind: "crash", node: "db", atUs: 2_000_000, durationUs: 1_000_000, restartUs: 1_000_000 }])).ok).toBe(false);
  f.contract.interventions[0]!.atUs = 59_000_000; expect(compile().ok).toBe(false);
  const old = prepareDatabase(); expect(interventionOptions(databaseDesign(), old.contract, old.compiled.input).some(o => o.interventionId === failPrimary.interventionId)).toBe(false);
  expect(scenarioError({ version: 1, visibility: "revealed", steps: [{ id: "fail", atSecond: 1, request: failPrimary }] }, 10)).toContain("Free World");
});

test("primary outage permits explicit promotion while replica survives", () => {
  const design = databaseDesign(); design.resources.at(-1)!.databaseReplication = { version: 1, enabled: true, replicationDelayMs: 2000, readPolicy: "replica-preferred" };
  const f = prepareDatabase(design); f.contract.interventions = [{ id: "fail", atUs: 1_000_001, request: failPrimary }, { id: "promote", atUs: 2_000_001, request: promote }];
  const c = compileProduct(design, f.contract); if (!c.ok) throw Error(JSON.stringify(c));
  const run = createProductModel2(c.value); run.advanceTo(4_000_000);
  expect(run.inspectData.database("db")!.databaseReplication).toMatchObject({ currentWriter: "replica", writerEpoch: 2, primaryProcessState: "fenced" });
});
