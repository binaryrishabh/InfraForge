import { expect, test } from "bun:test";
import { replicaFixture } from "./databaseReplication.fixture";
import { databaseReplicationLive } from "../src/model2/product/databaseReplicationLive";
import { relationalDatabase } from "../src/model2/data/database";
import { dataFixture } from "./dataFixture";
import { EventKernel } from "../src/model2/time";
import type { RelationalConfig } from "../src/model2/data/contracts";
import type { Invocation } from "../src/model2/workload/contracts";

test("returned original primary stays fenced; late messages and old writer requests cannot overwrite the replica", () => {
  const f = replicaFixture(10); f.submit(); f.clock.advanceTo(100);
  const originalRows = f.ha().primaryRows;
  f.db.primaryAvailability(false); f.db.promoteReplica(); f.submit(); f.clock.advanceTo(200);
  f.db.primaryAvailability(true);
  const old: Invocation = { rootId: "old", callId: "old", sessionId: "old", operation: "heavy", offeredAt: 200, attempt: 0, message: { request: { kind: "query", key: "k0", writerEpoch: 1 } } };
  expect(f.db.accept(old, () => {}).admitted).toBe(false);
  f.submit(); f.clock.advanceTo(20_000);
  expect(f.ha()).toMatchObject({ currentWriter: "replica", primaryProcessState: "fenced", replicaProcessState: "writer", primaryRole: "fenced", replicaRole: "writer", writerEpoch: 2, promotionCount: 1, fencedWriteRejections: 1, fencedReplicationRejections: 1, lostOperations: 1, pendingReplication: 0, replicaCommittedWrites: 2 });
  expect(f.ha().primaryRows).toEqual(originalRows);
  expect(f.db.evidence().rows[0]!.version).toBe(3);
  const live = databaseReplicationLive(f.db.evidence().databaseReplication);
  expect(live).toMatchObject({ primaryProcessState: "fenced", replicaProcessState: "writer", connectionInvalidations: 0, failedWritesWithoutWriter: 0 });
  f.db.primaryAvailability(false); f.submit(); f.clock.advanceTo(20_100);
  expect(f.ha()).toMatchObject({ currentWriter: "replica", replicaCommittedWrites: 3 });
});

test("live regression detail is bounded and retains the full measured count", () => {
  const config = dataFixture({ keys: 20, dbCpu: 100 }).resources.find(r => r.kind === "relational") as RelationalConfig;
  config.replication = { version: 1, enabled: true, replicationDelayMs: 10, readPolicy: "primary" };
  config.plans.heavy!.statements[0]!.keys = [...config.keys];
  const clock = new EventKernel(100), db = relationalDatabase(config, clock);
  db.accept({ rootId: "write", callId: "write", operation: "heavy", offeredAt: 0, attempt: 0, message: { request: { kind: "query", key: "k0" } } }, () => {});
  clock.advanceTo(100); db.promoteReplica();
  const evidence = db.evidence().databaseReplication!;
  expect(evidence.regressedKeys).toHaveLength(20);
  const live = databaseReplicationLive(evidence);
  expect(live.regressedKeyCount).toBe(20);
  expect(live.regressedKeys).toEqual(evidence.regressedKeys.slice(0, 8));
});
