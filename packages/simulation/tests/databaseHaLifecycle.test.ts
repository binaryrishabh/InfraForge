import { expect, test } from "bun:test";
import { databaseReplica } from "../src/model2/data/replication";
import { EventKernel } from "../src/model2/time";
import { replicaFixture } from "./databaseReplication.fixture";

test("HA member lifecycle has at most one available writer and preserves promotion across process returns", () => {
  const ha = databaseReplica({ version: 1, enabled: true, replicationDelayMs: 1, readPolicy: "replica-preferred" }, "db", new EventKernel(100), new Map());
  expect(ha.evidence()).toMatchObject({ currentWriter: "primary", primaryProcessState: "available", replicaProcessState: "available", writerEpoch: 1 });
  ha.primaryAvailability(false);
  expect(ha.evidence()).toMatchObject({ currentWriter: "none", primaryProcessState: "unavailable", replicaProcessState: "available" });
  ha.primaryAvailability(true);
  expect(ha.evidence()).toMatchObject({ currentWriter: "primary", writerEpoch: 1 });
  ha.primaryAvailability(false); ha.promote();
  expect(ha.evidence()).toMatchObject({ currentWriter: "replica", primaryProcessState: "unavailable", replicaProcessState: "writer", writerEpoch: 2 });
  ha.primaryAvailability(true);
  expect(ha.evidence()).toMatchObject({ currentWriter: "replica", primaryProcessState: "fenced", primaryRole: "fenced", replicaRole: "writer", writerEpoch: 2 });
  ha.wholeAvailability(false);
  expect(ha.evidence()).toMatchObject({ currentWriter: "none", primaryProcessState: "unavailable", replicaProcessState: "unavailable" });
  expect(ha.canPromote()).toBe(false);
  ha.wholeAvailability(true);
  expect(ha.evidence()).toMatchObject({ currentWriter: "replica", primaryProcessState: "fenced", replicaProcessState: "writer", writerEpoch: 2 });
});

test("whole resource Crash takes both HA processes down and keeps non-HA evidence absent", () => {
  const f = replicaFixture(); f.db.pause(true);
  expect(f.ha()).toMatchObject({ currentWriter: "none", primaryProcessState: "unavailable", replicaProcessState: "unavailable" });
  expect(() => f.db.promoteReplica()).toThrow("unavailable");
  f.db.pause(false);
  expect(f.ha()).toMatchObject({ currentWriter: "primary", primaryProcessState: "available", replicaProcessState: "available" });
});
