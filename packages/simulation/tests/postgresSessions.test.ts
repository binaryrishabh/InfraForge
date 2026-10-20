import { expect, test } from "bun:test";
import { relationalDatabase } from "../src/model2/data/database";
import { createDataModel2 } from "../src/model2/data/run";
import { validateData } from "../src/model2/data/validate";
import { EventKernel } from "../src/model2/time";
import { dataFixture } from "./dataFixture";
import { quantities } from "./workloadFixture";
import type { RelationalConfig } from "../src/model2/data/contracts";
import type { Invocation } from "../src/model2/workload/contracts";
import { pathTransport } from "../src/model2/network/transport";
import { networkLink } from "../src/model2/network/link";

function fixture(sessions = 4, activeTransactions = 4) {
  const input = dataFixture({ sessions, activeTransactions }), q = quantities("Authored PostgreSQL semantic fixture; timing assumption-only");
  const config = input.resources.find(r => r.kind === "relational") as RelationalConfig;
  input.workloadVersion = "m2e-pg/1"; config.semantics = "postgresql-keyed/1";
  const set = (field: "statementTimeout" | "transactionTimeout" | "lockTimeout" | "commitWait", n: number) => {
    for (const [op, p] of Object.entries(config.plans)) p[field] = q.q(`${op}.${field}.${n}`, n, "us");
  };
  set("statementTimeout", 0); set("transactionTimeout", 0); set("lockTimeout", 0);
  const clock = new EventKernel(10000), db = relationalDatabase(config, clock);
  const work = (id: string, operation = "light", sessionId = id): Invocation => ({ rootId: id, callId: id, sessionId, operation, offeredAt: clock.now, attempt: 0, message: { request: { kind: "query", key: "k0" } } });
  const accept = (id: string, op = "light") => { db.openSession(id); return db.accept(work(id, op), () => {}); };
  return { input, config, q, set, clock, db, work, accept };
}

test("PG revision is opt-in and generic m2e refuses it; zero disables PG deadlines", () => {
  const f = fixture(); f.input.ledger.push(...f.q.ledger); expect(() => validateData(f.input)).not.toThrow();
  f.input.workloadVersion = "m2e/1"; expect(() => validateData(f.input)).toThrow("relational");
  f.input.workloadVersion = "m2e-pg/1"; f.config.semantics = "read-committed-keyed/1"; expect(() => validateData(f.input)).toThrow("relational");
});

test("idle connections consume app capacity before any query and close releases capacity", () => {
  const { db, work } = fixture(1);
  expect(db.openSession("idle")).toBe(true); expect(db.openSession("over")).toBe(false);
  expect(db.evidence().sessions).toMatchObject({ total: 1, idle: 1, active: 0 });
  expect(db.accept(work("not-open"), () => {}).admitted).toBe(false);
  db.closeSession("idle"); expect(db.openSession("replacement")).toBe(true);
});

test("statement timeout aborts work but preserves the persistent session", () => {
  const f = fixture(); f.set("statementTimeout", 100); f.accept("a"); f.clock.advanceTo(200);
  expect(f.db.evidence().reasons["statement-timeout"]).toBe(1); expect(f.db.evidence().sessions.idle).toBe(1);
  f.set("statementTimeout", 0); expect(f.db.accept(f.work("again", "light", "a"), () => {}).admitted).toBe(true);
  f.clock.advanceTo(5000); expect(f.db.evidence().transactions.committed).toBe(1);
});

test("transaction timeout terminates session and releases staged writes and locks", () => {
  const f = fixture(); f.set("transactionTimeout", 100); f.accept("a", "heavy"); f.clock.advanceTo(200);
  expect(f.db.evidence().reasons["transaction-timeout"]).toBe(1); expect(f.db.evidence().sessions.total).toBe(0);
  expect(f.db.evidence().rows[0]!.version).toBe(1); expect(f.db.evidence().locks.held).toHaveLength(0);
});

test("lock timeout applies while waiting, and connection close releases blocking owner", () => {
  const f = fixture(); f.config.plans.heavy!.statements[0]!.blockingWait = f.q.q("hold", 2000, "us");
  f.accept("holder", "heavy"); f.set("lockTimeout", 100); f.accept("blocked", "heavy"); f.clock.advanceTo(200);
  expect(f.db.evidence().reasons["lock-timeout"]).toBe(1); expect(f.db.evidence().sessions.total).toBe(2);
  f.db.closeSession("holder"); expect(f.db.evidence().locks.held).toHaveLength(0);
  expect(f.db.evidence().rows[0]!.version).toBe(1); expect(f.db.evidence().transactions.aborted).toBe(2);
});

test("PG statement deadline includes DB query queue independently of pool admission", () => {
  const f = fixture(4, 1); f.accept("first"); f.set("statementTimeout", 100); f.accept("queued"); f.clock.advanceTo(200);
  expect(f.db.evidence().reasons["statement-timeout"]).toBe(1); expect(f.db.evidence().queued).toBe(0);
  expect(f.db.evidence().sessions.idle).toBe(1);
});

test("pre-commit cancellation rolls back; cancellation in protected commit cannot undo writes", () => {
  const f = fixture(); const early = f.accept("early", "heavy"); expect(early.cancel()).toBe("cancelled");
  f.set("commitWait", 2000); f.config.plans.heavy!.durability = "authored-log-ack";
  const receipt = f.accept("late", "heavy"); f.clock.advanceTo(1000);
  expect(f.db.evidence().queries.committing).toBe(1); expect(receipt.cancel()).toBe("unsupported");
  f.db.closeSession("late"); f.clock.advanceTo(4000);
  expect(f.db.evidence().transactions).toMatchObject({ committed: 1, cancelled: 1, live: 0 });
  expect(f.db.evidence().rows[0]!.version).toBe(2); expect(f.db.evidence().sessions.total).toBe(1);
  expect(f.db.evidence().locks.held).toHaveLength(0);
});

test("transaction timeout during protected commit does not relabel a remote commit", () => {
  const f = fixture(); f.set("transactionTimeout", 1000); f.set("commitWait", 2000);
  f.config.plans.heavy!.durability = "authored-log-ack"; f.accept("a", "heavy"); f.clock.advanceTo(4000);
  expect(f.db.evidence().transactions.committed).toBe(1); expect(f.db.evidence().transactions.aborted).toBe(0);
});

test("equal transaction and statement timeouts select session termination", () => {
  const f = fixture(); f.set("transactionTimeout", 100); f.set("statementTimeout", 100);
  f.accept("a"); f.clock.advanceTo(200);
  expect(f.db.evidence().reasons["transaction-timeout"]).toBe(1); expect(f.db.evidence().sessions.total).toBe(0);
});

test("equal statement and lock deadlines select statement cancellation", () => {
  const f = fixture(); f.config.plans.heavy!.statements[0]!.blockingWait = f.q.q("hold", 2000, "us");
  f.accept("holder", "heavy");
  // The holder keeps its disabled statement deadline; the new command gets both.
  f.set("statementTimeout", 100); f.set("lockTimeout", 100); f.accept("blocked", "heavy");
  f.clock.advanceTo(200); expect(f.db.evidence().reasons["statement-timeout"]).toBe(1);
  expect(f.db.evidence().reasons["lock-timeout"]).toBeUndefined();
});

test("detached caller retains the busy PG lease until remote commit; next query waits in pool", () => {
  const f = fixture(); f.set("commitWait", 2000); f.config.plans.heavy!.durability = "authored-log-ack";
  const path = structuredClone(f.input.paths.find(p => p.target === "db")!);
  path.pool.maxConnections = f.q.q("one.connection", 1, "count"); path.pool.remoteCancellation = "detach";
  const links = new Map(f.input.links.map(l => [l.id, networkLink(l, f.clock)]));
  const transport = pathTransport(path, f.clock, links, (_target, work, done) => f.db.accept(work, done), () => true, () => {},
    id => f.db.closeSession(id), { holdLeaseUntilRemoteTerminal: true, open(id, done) { done(undefined, f.db.openSession(id) ? undefined : "backend-rejected"); return () => false; }, close: id => f.db.closeSession(id) });
  const first = transport.exchange(f.work("first", "heavy"), () => {}); f.clock.advanceTo(1000); expect(first.cancel()).toBe("cancelled");
  transport.exchange(f.work("second"), () => {}); f.clock.advanceTo(1100);
  expect(f.db.evidence().transactions.admitted).toBe(1); expect(transport.measure().pool.pendingUnassigned).toBe(1);
  f.clock.advanceTo(10000);
  expect(f.db.evidence().transactions.committed).toBe(2); expect(f.db.evidence().reasons["session-busy"]).toBeUndefined();
  expect(transport.measure().remoteOutcomesAfterStop).toBe(1); expect(f.db.evidence().rows[0]!.version).toBe(2);
});

test("a detached transaction deadline discards the dead session before the next pool lease", () => {
  const f = fixture(1); f.config.plans.heavy!.transactionTimeout = f.q.q("short.tx", 100, "us");
  const path = structuredClone(f.input.paths.find(p => p.target === "db")!);
  path.pool.maxConnections = f.q.q("one.connection", 1, "count"); path.pool.remoteCancellation = "detach";
  const links = new Map(f.input.links.map(l => [l.id, networkLink(l, f.clock)]));
  const transport = pathTransport(path, f.clock, links, (_target, work, done) => f.db.accept(work, done), () => true, () => {},
    id => f.db.closeSession(id), { holdLeaseUntilRemoteTerminal: true, open(id, done) { done(undefined, f.db.openSession(id) ? undefined : "backend-rejected"); return () => false; }, close: id => f.db.closeSession(id), returnTraffic: id => f.db.sessionAlive(id) });
  const first = transport.exchange(f.work("first", "heavy"), () => {}); f.clock.advanceTo(50); first.cancel();
  transport.exchange(f.work("second"), () => {}); f.clock.advanceTo(5000);
  expect(f.db.evidence().reasons["transaction-timeout"]).toBe(1); expect(f.db.evidence().reasons["session-not-established"]).toBeUndefined();
  expect(f.db.evidence().transactions.committed).toBe(1); expect(transport.measure().pool.created).toBe(2);
});

test("service loss rolls back unfinished statements while protected commit remains reconcilable", () => {
  const f = fixture(); f.set("commitWait", 2000); f.config.plans.heavy!.durability = "authored-log-ack";
  f.accept("committing", "heavy"); f.clock.advanceTo(1000); f.accept("unfinished"); f.db.pause(true); f.clock.advanceTo(4000);
  expect(f.db.evidence().transactions).toMatchObject({ committed: 1, aborted: 1, live: 0 });
  expect(f.db.evidence().sessions.total).toBe(0); expect(f.db.evidence().rows[0]!.version).toBe(2);
});

test("pool creation owns PG sessions; idle timeout closes them and pool queue is separate", () => {
  const f = fixture();
  f.input.paths.find(p => p.target === "db")!.pool.idleTimeout = f.q.q("pg.idle", 2000, "us");
  f.input.ledger.push(...f.q.ledger);
  // The existing cache-aside fixture exercises a real connection owner into DB.
  const runtime = createDataModel2(f.input); runtime.advanceTo(runtime.horizon);
  const e = runtime.evidence(), d = e.data.databases[0]!;
  expect(e.workloadVersion).toBe("m2e-pg/1"); expect(d.transactions.committed).toBeGreaterThan(0);
  expect(d.sessionEvents!.established).toBeGreaterThan(0); expect(d.sessions.total).toBe(0);
  expect(e.network.paths.find(p => p.target === "db")!.pool.closed).toBeGreaterThan(0);
});
