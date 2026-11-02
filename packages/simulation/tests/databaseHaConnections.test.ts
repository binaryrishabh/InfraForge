import { expect, test } from "bun:test";
import { databaseDesign, prepareDatabase, promote } from "./databaseReplication.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { dataFixture } from "./dataFixture";
import { relationalDatabase } from "../src/model2/data/database";
import { EventKernel } from "../src/model2/time";
import type { RelationalConfig } from "../src/model2/data/contracts";

test("primary outage breaks actual writer pools and promotion opens fresh sessions before writes recover", () => {
  const design = databaseDesign(); design.workload.readWriteRatio = 0.5;
  design.resources.at(-1)!.databaseReplication = { version: 1, enabled: true, replicationDelayMs: 2000, readPolicy: "replica-preferred" };
  const f = prepareDatabase(design);
  f.contract.interventions = [
    { id: "fail", atUs: 1_000_001, request: { interventionId: "db-fail-primary", revision: 1, target: { resourceId: "db" }, parameters: { duration: 4 } } },
    { id: "promote", atUs: 3_000_001, request: promote },
  ];
  const c = compileProduct(design, f.contract); if (!c.ok) throw Error(JSON.stringify(c));
  const run = createProductModel2(c.value);
  const path = () => run.evidence().network.paths.find(p => p.target === "db")!;
  const ha = () => run.inspectData.database("db")!.databaseReplication!;
  run.advanceTo(1_000_000); const before = path().pool;
  expect(before.created).toBeGreaterThan(0);
  run.advanceTo(1_000_001);
  expect(path().pool.closed).toBeGreaterThan(before.closed);
  expect(ha().connectionInvalidations).toBeGreaterThan(0);
  expect(ha().sessionInvalidations).toBeGreaterThan(0);
  run.advanceTo(3_000_000);
  expect(ha()).toMatchObject({ currentWriter: "none", replicaProcessState: "available", replicaCommittedWrites: 0 });
  expect(ha().failedWritesWithoutWriter).toBeGreaterThan(0);
  expect(ha().replicaReads).toBeGreaterThan(0);
  const down = path().pool;
  run.advanceTo(3_000_001); expect(ha()).toMatchObject({ currentWriter: "replica", writerEpoch: 2 });
  run.advanceTo(4_000_000);
  expect(path().pool.created).toBeGreaterThan(down.created);
  expect(ha().replicaCommittedWrites).toBeGreaterThan(0);
  expect(run.inspectData.database("db")!.sessionEvents!.established).toBeGreaterThan(before.created);
});

test("sessions opened on the survivor reconnect when the unpromoted primary resumes writing", () => {
  const config = dataFixture({ dbCpu: 100 }).resources.find(r => r.kind === "relational") as RelationalConfig;
  config.semantics = "postgresql-keyed/2";
  config.replication = { version: 1, enabled: true, replicationDelayMs: 2, readPolicy: "replica-preferred" };
  const clock = new EventKernel(100), db = relationalDatabase(config, clock);
  db.openSession("primary"); db.primaryAvailability(false); db.openSession("survivor");
  expect(db.sessionAlive("primary")).toBe(false); expect(db.sessionAlive("survivor")).toBe(true);
  expect(db.primaryAvailability(true)).toEqual(["survivor"]);
  expect(db.sessionAlive("survivor")).toBe(false);
  const write = { rootId: "write", callId: "write", sessionId: "survivor", operation: "heavy", offeredAt: 0, attempt: 0, message: { request: { kind: "query" as const, key: "k0" } } };
  expect(db.accept(write, () => {}).admitted).toBe(false);
  expect(db.evidence().reasons["session-not-established"]).toBe(1);
  db.openSession("fresh"); expect(db.accept({ ...write, callId: "fresh-write", sessionId: "fresh" }, () => {}).admitted).toBe(true);
  clock.advanceTo(100);
  expect(db.evidence().databaseReplication).toMatchObject({ currentWriter: "primary", writerEpoch: 1, primaryCommittedWrites: 1 });
});
