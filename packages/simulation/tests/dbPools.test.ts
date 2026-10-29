import { expect, test } from "bun:test";
import { dataFixture } from "./dataFixture";
import { quantities } from "./workloadFixture";
import { createDataModel2 } from "../src/model2/data/run";
import { connectionPool, type Lease } from "../src/model2/network/pool";
import { EventKernel } from "../src/model2/time";
import { RETRYABLE_FAILURES } from "../src/model2/network/contracts";
import type { RelationalConfig } from "../src/model2/data/contracts";

function pgInput() {
  const input = dataFixture({ sessions: 1, count: 30, interval: 1, coalesce: false, slots: 64, dbCpu: 1000 });
  input.workloadVersion = "m2e-pg/1";
  (input.resources.find(r => r.kind === "relational") as RelationalConfig).semantics = "postgresql-keyed/1";
  input.paths.find(p => p.target === "db")!.pool.evidenceProfile = "postgresql-pools/2";
  return input;
}

test("session limit refuses a connection and its reserved owner with causal identity", () => {
  const run = createDataModel2(pgInput()); run.advanceTo(run.horizon); const e = run.evidence();
  const path = e.network.paths.find(p => p.target === "db")!;
  expect(path.reasons["session-limit"]).toBeGreaterThan(0);
  expect(e.network.trace.totals["db-session-refused"]).toBeGreaterThan(0);
  expect(e.network.trace.totals["connection-released"]).toBe(path.pool.released);
  expect(RETRYABLE_FAILURES.some(reason => String(reason) === "session-limit")).toBe(false);
});

test("pool stays lazy at normal load, saturates in FIFO order and clears timed out waiters", () => {
  const q = quantities("pool mechanics"), config = dataFixture().paths[0]!.pool;
  config.maxConnections = q.q("max", 1, "count"); config.acquireTimeout = q.q("timeout", 100, "us"); config.establish = q.q("establish", 1, "us");
  const clock = new EventKernel(10000), pool = connectionPool("test", config, clock, () => true);
  expect(pool.measure().connections).toBe(0);
  let first: Lease | undefined; const order: string[] = [], failures: string[] = [];
  pool.acquire("a", lease => { first = lease; order.push("a"); }, r => failures.push(r)); clock.advanceTo(2);
  expect(pool.measure()).toMatchObject({ connections: 1, pending: 0, acquired: 1 });
  pool.acquire("b", lease => { order.push("b"); lease.release(); }, r => failures.push(r));
  pool.acquire("c", lease => { order.push("c"); lease.release(); }, r => failures.push(r));
  expect(pool.measure().pending).toBe(2); first!.release();
  expect(order).toEqual(["a", "b", "c"]); expect(pool.measure()).toMatchObject({ pending: 0, acquired: 3, released: 3 });
  pool.acquire("held", () => {}, r => failures.push(r)); pool.acquire("timeout", () => {}, r => failures.push(r)); clock.advanceTo(200);
  expect(failures).toEqual(["acquire-timeout"]); expect(pool.measure().pending).toBe(0);
});
