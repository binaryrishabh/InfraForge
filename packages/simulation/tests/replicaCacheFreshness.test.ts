import { expect, test } from "bun:test";
import { replicaCacheFreshness } from "./replicaCacheFreshness.fixture";
import { createProductModel2 } from "../src/model2/product/run";

test("replica-read staleness survives DB catch-up in the app cache; only TTL changes its visible lifetime", () => {
  const outcomes = [1, 60].map(ttl => {
    const f = replicaCacheFreshness(ttl);
    const initial = f.runtime.evidence().data.databases[0]!.rows[0]!.version;
    f.runtime.advanceTo(50000);
    const committed = f.runtime.evidence().data.databases[0]!.rows[0]!.version;
    expect(committed).toBeGreaterThan(initial);
    f.runtime.advanceTo(200000);
    const cold = f.runtime.evidence();
    expect(cold.data.applications[0]!.results.at(-1)!.version).toBe(initial);
    expect(cold.data.databases[0]!.databaseReplication!.staleReplicaReads).toBeGreaterThan(0);
    f.runtime.advanceTo(2300000);
    const caughtUp = f.runtime.evidence(), served = caughtUp.data.applications[0]!.results.at(-1)!;
    expect(caughtUp.data.databases[0]!.databaseReplication!.replicaRows[0]!.version).toBe(committed);
    expect(served.ok).toBe(true);
    return { ttl, initial, committed, served: served.version, source: served.source, reads: caughtUp.data.databases[0]!.logicalReads };
  });
  expect(outcomes[0]!.served).toBe(outcomes[0]!.committed);
  expect(outcomes[1]!.served).toBe(outcomes[1]!.initial);
  expect(outcomes[0]!.reads).toBeGreaterThan(outcomes[1]!.reads);
  const primary = replicaCacheFreshness(60, "primary"); primary.runtime.advanceTo(200000);
  const e = primary.runtime.evidence();
  expect(e.data.applications[0]!.results.at(-1)!.version).toBe(e.data.databases[0]!.rows[0]!.version);
  expect(e.data.databases[0]!.databaseReplication!.staleReplicaReads).toBe(0);
  console.info("replica-cache-freshness", JSON.stringify(outcomes));
});

test("writer loss closes the real app path while cached reads survive; promotion reconnects and invalidates stale cached data", () => {
  const f = replicaCacheFreshness(60);
  f.runtime.advanceTo(2300000);
  const before = f.runtime.evidence().network.paths.find(p => p.target === "db")!.pool;
  f.runtime.advanceTo(2400000);
  const lost = f.runtime.evidence();
  expect(lost.network.paths.find(p => p.target === "db")!.pool.closed).toBeGreaterThan(before.closed);
  expect(lost.data.databases[0]!.databaseReplication!.sessionInvalidations).toBeGreaterThan(0);
  f.runtime.advanceTo(2550000);
  expect(f.runtime.evidence().data.applications[0]!.results.at(-1)).toMatchObject({ ok: true, source: "cache-hit" });
  expect(f.runtime.inspectData.database("db")!.databaseReplication!.currentWriter).toBe("none");
  f.runtime.advanceTo(2800000);
  expect(f.runtime.evidence().data.applications[0]!.results.at(-1)!.ok).toBe(false);
  f.runtime.advanceTo(3400000);
  const promoted = f.runtime.evidence();
  const version = promoted.data.databases[0]!.databaseReplication!.replicaRows[0]!.version;
  expect(promoted.data.applications[0]!.results.at(-1)).toMatchObject({ ok: true, version, source: "database-fetch" });
  expect(promoted.network.paths.find(p => p.target === "db")!.pool.created).toBeGreaterThan(before.created);
  f.runtime.advanceTo(f.runtime.horizon);
  const final = f.runtime.evidence();
  expect(final.data.applications[0]!.results.at(-1)).toMatchObject({ ok: true, version });
  expect(final.data.databases[0]!.databaseReplication!.primaryProcessState).toBe("fenced");
  expect(final.counts.completed + final.counts.rejected).toBe(final.counts.offered);
  expect(final.counts.inFlight).toBe(0);
  const replay = createProductModel2(f.compiled);
  for (let at = 100000; at <= replay.horizon; at += 100000) replay.advanceTo(at);
  expect(replay.evidence()).toEqual(final);
});
