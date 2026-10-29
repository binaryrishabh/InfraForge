import { expect, test } from "bun:test";
import { dbPoolCascade } from "./dbPoolCascadeFixture";
import { createProductModel2 } from "../src/model2/product/run";
import { createLiveModel2 } from "../src/model2/product/live";
import { networkLink } from "../src/model2/network/link";
import { pathTransport } from "../src/model2/network/transport";
import { relationalDatabase } from "../src/model2/data/database";
import type { Invocation } from "../src/model2/workload/contracts";
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

function database2() {
  const input = pgInput(), q = quantities("PG2 boundaries"), config = input.resources.find(r => r.kind === "relational") as RelationalConfig;
  config.semantics = "postgresql-keyed/2";
  for (const plan of Object.values(config.plans)) {
    plan.statementTimeout = q.q("statement.disabled", 0, "us"); plan.transactionTimeout = q.q("transaction.disabled", 0, "us");
    plan.lockTimeout = q.q("lock.disabled", 0, "us");
  }
  const clock = new EventKernel(10000), db = relationalDatabase(config, clock);
  const work = (id: string, operation = "heavy"): Invocation => ({ rootId: id, callId: id, sessionId: id, operation, attempt: 0, offeredAt: clock.now, message: { request: { kind: "query", key: "k0" } } });
  return { input, config, q, clock, db, work };
}

test("PG2 close mid statement retains an orphan slot then rolls back at the boundary", () => {
  const f = database2(); f.db.openSession("a"); f.db.accept(f.work("a"), () => {}); f.clock.advanceTo(100);
  f.db.closeSession("a"); expect(f.db.measure()).toMatchObject({ sessions: 1, orphaned: 1 }); expect(f.db.openSession("b")).toBe(false);
  f.clock.advanceTo(5000); expect(f.db.measure()).toMatchObject({ sessions: 0, orphaned: 0 });
  expect(f.db.evidence().rows[0]!.version).toBe(1); expect(f.db.openSession("b")).toBe(true);
});

test("PG2 close after entering commit preserves the committed effect and eventually frees its slot", () => {
  const f = database2(); const plan = f.config.plans.heavy!; plan.commitWait = f.q.q("commit.wait", 2000, "us"); plan.durability = "authored-log-ack";
  f.db.openSession("a"); f.db.accept(f.work("a"), () => {}); f.clock.advanceTo(1500);
  expect(f.db.evidence().queries.committing).toBe(1); f.db.closeSession("a"); expect(f.db.measure().sessions).toBe(1);
  f.clock.advanceTo(5000); expect(f.db.evidence().rows[0]!.version).toBe(2); expect(f.db.measure().sessions).toBe(0);
});

test("PG2 cancel before commit preserves the session and rolls back writes", () => {
  const f = database2(); f.db.openSession("a"); const receipt = f.db.accept(f.work("a"), () => {}); f.clock.advanceTo(100);
  expect(receipt.cancel()).toBe("cancelled"); expect(f.db.evidence().rows[0]!.version).toBe(1); expect(f.db.sessionAlive("a")).toBe(true);
});

function transport2() {
  const f = database2(), path = structuredClone(f.input.paths.find(p => p.target === "db")!);
  const links = new Map(f.input.links.map(l => [l.id, networkLink(l, f.clock)]));
  let alive = true; const events: Array<{ kind: string; detail: string }> = [];
  const transport = pathTransport(path, f.clock, links, (_target, work, done) => f.db.accept(work, done), () => alive,
    (kind, _id, detail) => events.push({ kind, detail }), id => f.db.closeSession(id),
    { holdLeaseUntilRemoteTerminal: true, open(id, done) { done(undefined, f.db.openSession(id) ? undefined : "session-limit"); return () => false; }, close: id => f.db.closeSession(id), returnTraffic: id => f.db.sessionAlive(id) });
  return { ...f, path, links, transport, events, crash: () => { alive = false; f.db.pause(true); } };
}

test("leases balance after success, DB error, pre-delivery cancel and DB crash before remote delivery", () => {
  for (const mode of ["success", "error", "cancel", "crash"] as const) {
    const f = transport2();
    if (mode === "error") f.config.plans.light!.statementTimeout = f.q.q("short.statement", 1, "us");
    const receipt = f.transport.exchange(f.work("a", "light"), () => {});
    if (mode === "cancel" || mode === "crash") {
      // The connection is established before the request's first hop completes.
      f.clock.advanceTo(11); if (mode === "crash") { f.crash(); f.clock.advanceTo(30); }
      receipt.cancel();
    }
    f.clock.advanceTo(5000); const pool = f.transport.measure().pool;
    expect(pool.acquired).toBe(1); expect(pool.released).toBe(pool.acquired); expect(pool.activeStreams).toBe(0); expect(pool.pending).toBe(0);
  }
});

test("caller deadline during protected commit does not undo its row or relabel the remote outcome", () => {
  const input = dataFixture({ count: 1, cpu: 1, heavy: 1, timeout: 1500, dbCpu: 1000, cancellation: "cooperative" }), q = quantities("protected commit and actual caller deadline");
  input.workloadVersion = "m2e-pg/2";
  const arrival = input.arrivals[0]!; if (arrival.kind !== "periodic") throw Error("expected periodic arrival"); arrival.operation = "heavy";
  input.operations.forEach(op => op.onCallerStop = "request-cancellation");
  input.paths.forEach(path => path.pool.remoteCancellation = "request-cancellation");
  const db = input.resources.find(r => r.kind === "relational") as RelationalConfig;
  db.semantics = "postgresql-keyed/2"; db.plans.heavy!.commitWait = q.q("protected.commit.wait", 2000, "us"); db.plans.heavy!.durability = "authored-log-ack";
  input.ledger.push(...q.ledger);
  const run = createDataModel2(input); run.advanceTo(run.horizon); const e = run.evidence();
  expect(e.counts.deadlineExceeded).toBe(1); expect(e.data.databases[0]!.rows[0]!.version).toBe(2);
  expect(e.network.trace.events.some(event => event.kind === "remote-after-transport-stop" && event.detail === "completed")).toBe(true);
});

test("cache outage fills per-replica pools, autoscaling exceeds ten sessions, recovery drains state deterministically", () => {
  const f = dbPoolCascade(), run = createProductModel2(f.compiled), live = createLiveModel2(f.compiled, ["lb", "app", "cache", "db"]);
  const phases: ReturnType<typeof run.evidence>[] = [];
  for (const second of [4, 14, 24, 25, 27, 40, 45]) { run.advanceTo(second * 1e6); phases.push(run.evidence()); }
  const [before, full, outage, back, drained, idle, end] = phases;
  const db = (e: typeof before) => e!.data.databases[0]!;
  expect(db(before).transactions.admitted).toBe(1);
  expect((db(full).transactions.admitted - db(before).transactions.admitted) / 10).toBeGreaterThanOrEqual(db(before).transactions.admitted / 4 * 10);
  expect(db(full).sessions.total).toBeGreaterThan(10); expect(db(full).sessions.limit).toBe(12);
  expect(full!.product.controllers[0]!.replicas.filter(r => r.state === "ready")).toHaveLength(3);
  expect(db(outage).sessionEvents!.refused).toBeGreaterThan(0);
  const pending = back!.network.paths.filter(p => p.target === "db").reduce((n, p) => n + p.pool.pending, 0);
  expect(pending + db(back).transactions.live + (db(back).sessions.orphaned ?? 0)).toBeGreaterThan(0);
  expect(db(back).sessions.total).toBeGreaterThan(db(before).sessions.total);
  expect(db(drained).transactions.live).toBe(0); expect(db(idle).sessions.total).toBe(0);
  const again = createProductModel2(f.compiled);
  for (const second of [4, 14, 24, 25, 27, 40, 45]) again.advanceTo(second * 1e6);
  expect(JSON.stringify(again.evidence())).toBe(JSON.stringify(end));
  let refusalVisible = false;
  for (let i = 0; i < 27; i++) { live.advanceSecond(); const p = live.project(); if ((p.metrics.db!.errorRate ?? 0) > 0) { refusalVisible = true; expect(p.metrics.db!.health).not.toBe("healthy"); } }
  expect(refusalVisible).toBe(true);
});

test("normal sequential load reuses one connection without filling a ten-connection pool", () => {
  const input = pgInput(), q = quantities("normal pool"), config = input.paths.find(p => p.target === "db")!.pool;
  config.maxConnections = q.q("ten", 10, "count"); const clock = new EventKernel(10000), pool = connectionPool("normal", config, clock, () => true);
  for (let i = 0; i < 20; i++) { pool.acquire(String(i), lease => lease.release(), () => { throw Error("unexpected refusal"); }); clock.advanceTo((i + 1) * 100); expect(pool.measure().connections).toBeLessThan(10); expect(pool.measure().pending).toBe(0); }
  expect(pool.measure()).toMatchObject({ created: 1, acquired: 20, released: 20 });
});

test("transport close cannot cancel away a PG2 orphan before its statement boundary", () => {
  const f = transport2(); f.path.pool.responseTimeout = f.q.q("short.response", 100, "us");
  f.transport.exchange(f.work("a"), () => {}); f.clock.advanceTo(200);
  expect(f.db.measure()).toMatchObject({ sessions: 1, orphaned: 1 }); expect(f.db.openSession("b")).toBe(false);
  f.clock.advanceTo(5000); expect(f.db.measure()).toMatchObject({ sessions: 0, orphaned: 0 }); expect(f.db.evidence().rows[0]!.version).toBe(1);
});
