import { expect, test } from "bun:test";
import { EventKernel } from "../src/model2/time";
import { relationalDatabase } from "../src/model2/data/database";
import { orderedRowPair } from "../src/model2/data/selectKey";
import type { DataReply, RelationalConfig } from "../src/model2/data/contracts";
import type { Invocation } from "../src/model2/workload/contracts";
import { dataFixture } from "./dataFixture";
import { quantities } from "./workloadFixture";

// Invariants of row-lock-order/1 (saved rowLocking on a Database): a write touches two rows in two statements and holds the first lock while it works on the second.
// With order "by-key" every transaction takes its two locks in the rows' fixed order, so a wait-for cycle cannot form; "as-requested" keeps the drawn order and can deadlock.
const SECOND = 1_000_000, KEYS = 6, SEED = "seed";
type Order = "as-requested" | "by-key";
function config(order: Order | undefined, keys = KEYS): RelationalConfig {
  const { q } = quantities(), d = structuredClone(dataFixture({ keys, activeTransactions: 200, sessions: 500 }).resources.find(r => r.kind === "relational") as RelationalConfig);
  const statement = d.plans.heavy!.statements[0]!;
  d.access = "keyed-uniform";
  d.plans.heavy = { ...d.plans.heavy!, lockTimeout: q("t.lock", 20 * SECOND, "us"), statementTimeout: q("t.statement", 20 * SECOND, "us"), transactionTimeout: q("t.transaction", 20 * SECOND, "us"),
    statements: [{ ...statement, keys: ["$key"], cpu: q("t.cpu1", 1000, "cpu-us") }, { ...statement, keys: ["$key2"], cpu: q("t.cpu2", 1000, "cpu-us") }] };
  d.plans.light = { ...d.plans.light!, lockTimeout: q("t.lock2", 20 * SECOND, "us"), statementTimeout: q("t.statement2", 20 * SECOND, "us"), transactionTimeout: q("t.transaction2", 20 * SECOND, "us") };
  d.execution.cores = q("t.cores", 64, "cores");
  if (order) d.rowLocking = { order };
  return d;
}
let n = 0;
const work = (root: string, operation = "heavy", key?: string): Invocation => ({ rootId: root, callId: JSON.stringify(["call", n++, root]), operation, attempt: 0, offeredAt: 0, sessionId: `s${n}`, message: key ? { request: { kind: "query", key } } : undefined });
function world(order: Order | undefined, keys = KEYS) {
  const d = config(order, keys), kernel = new EventKernel(5_000_000), db = relationalDatabase(d, kernel, undefined, undefined, undefined, SEED);
  return { d, kernel, db, replies: [] as Array<{ root: string; outcome: string }> };
}
const submit = (w: ReturnType<typeof world>, root: string, key?: string) => w.db.accept(work(root, "heavy", key), outcome => w.replies.push({ root, outcome }));
const pairOf = (root: string, key: string, order: Order) => orderedRowPair(Array.from({ length: KEYS }, (_, i) => `k${i}`), key, order, SEED, "db", root);
/** Find two roots whose requested pairs are the same two rows in opposite order. */
function oppositePair() {
  const keys = Array.from({ length: KEYS }, (_, i) => `k${i}`);
  const asked = new Map<string, string>();
  for (let i = 0; i < 4000; i++) for (const key of keys) {
    const root = `r${i}`, { first, second } = pairOf(root, key, "as-requested"), reverse = asked.get(`${second}>${first}`);
    if (reverse) { const [otherRoot, otherKey] = reverse.split("|") as [string, string]; return { a: { root: otherRoot, key: otherKey }, b: { root, key } }; }
    asked.set(`${first}>${second}`, `${root}|${key}`);
  }
  throw Error("no opposite pair found");
}

test("the second row is another key of the keyspace, chosen deterministically, and by-key always puts the lower row first", () => {
  const keys = Array.from({ length: KEYS }, (_, i) => `k${i}`);
  for (let i = 0; i < 300; i++) for (const key of keys) {
    const asked = pairOf(`r${i}`, key, "as-requested"), ordered = pairOf(`r${i}`, key, "by-key");
    expect(asked.first).toBe(key); expect(asked.second).not.toBe(key); expect(keys).toContain(asked.second);
    expect(pairOf(`r${i}`, key, "as-requested")).toEqual(asked);
    expect([ordered.first, ordered.second].sort()).toEqual([key, asked.second].sort());
    expect(keys.indexOf(ordered.first)).toBeLessThan(keys.indexOf(ordered.second));
  }
});

test("two writes that name the same two rows in opposite order deadlock once: one victim, counted once, one commit", () => {
  const { a, b } = oppositePair(), w = world("as-requested");
  submit(w, a.root, a.key); submit(w, b.root, b.key); w.kernel.advanceTo(5 * SECOND);
  const e = w.db.evidence();
  expect(e.locks.deadlocks).toBe(1); expect(e.reasons["deadlock-requester-victim"]).toBe(1);
  expect(e.transactions.committed).toBe(1); expect(e.transactions.aborted).toBe(1); expect(e.locks.held).toHaveLength(0);
  expect(w.replies.map(r => r.outcome).sort()).toEqual(["completed", "rejected"]);
});

test("the same two writes with order by-key take their locks in the same order: no deadlock, both commit, both rows written twice", () => {
  const { a, b } = oppositePair(), w = world("by-key");
  submit(w, a.root, a.key); submit(w, b.root, b.key); w.kernel.advanceTo(5 * SECOND);
  const e = w.db.evidence();
  expect(e.locks.deadlocks).toBe(0); expect(e.reasons["deadlock-requester-victim"] ?? 0).toBe(0);
  expect(e.transactions.committed).toBe(2); expect(e.locks.waits).toBeGreaterThan(0); expect(e.locks.held).toHaveLength(0);
  expect(e.rows.reduce((sum, r) => sum + r.version - 1, 0)).toBe(4);
});

test("swept schedule: by-key never deadlocks and every write commits; as-requested victims equal deadlocks equal aborted, exactly once each", () => {
  for (const keys of [2, 3, 6]) for (const spacing of [0, 300, 900]) {
    const sweep = (order: Order) => {
      const w = world(order, keys);
      for (let i = 0; i < 80; i++) { const at = i * spacing; w.kernel.schedule(at, 1, `submit-${i}`, () => submit(w, `sweep-${keys}-${i}`)); }
      w.kernel.advanceTo(5 * SECOND);
      return { e: w.db.evidence(), replies: w.replies };
    };
    const ordered = sweep("by-key"), asked = sweep("as-requested");
    expect(ordered.e.locks.deadlocks).toBe(0); expect(ordered.e.transactions.committed).toBe(80); expect(ordered.e.locks.held).toHaveLength(0);
    const victims = asked.e.reasons["deadlock-requester-victim"] ?? 0;
    expect(asked.e.locks.deadlocks).toBe(victims); expect(asked.e.transactions.aborted).toBe(victims);
    expect(asked.e.transactions.committed + victims).toBe(80); expect(asked.replies).toHaveLength(80);
    expect(asked.replies.filter(r => r.outcome === "rejected")).toHaveLength(victims);
    expect(asked.e.rows.reduce((sum, r) => sum + r.version - 1, 0)).toBe(2 * asked.e.transactions.committed);
  }
});

test("as-requested does deadlock under a dense schedule, so the sweep above is not vacuous", () => {
  const w = world("as-requested", 2);
  for (let i = 0; i < 80; i++) w.kernel.schedule(0, 1, `submit-${i}`, () => submit(w, `dense-${i}`));
  w.kernel.advanceTo(5 * SECOND);
  expect(w.db.evidence().locks.deadlocks).toBeGreaterThan(0);
});

test("replay is identical, and reading the evidence while running changes nothing", () => {
  const run = (read: boolean) => {
    const w = world("as-requested", 3);
    for (let i = 0; i < 60; i++) w.kernel.schedule(i * 200, 1, `submit-${i}`, () => submit(w, `replay-${i}`));
    for (let t = 100_000; t <= 5 * SECOND; t += 100_000) { w.kernel.advanceTo(t); if (read) { w.db.evidence(); w.db.measure(); } }
    return JSON.stringify([w.db.evidence(), w.replies]);
  };
  expect(run(false)).toBe(run(false)); expect(run(true)).toBe(run(false));
});

test("an unmarked database keeps single-statement plans and writes one row; the statement shape is the only difference", () => {
  const d = config(undefined), kernel = new EventKernel(100_000), db = relationalDatabase({ ...d, plans: { ...d.plans, heavy: { ...d.plans.heavy!, statements: [d.plans.heavy!.statements[0]!] } } }, kernel, undefined, undefined, undefined, SEED);
  const replies: string[] = [];
  db.accept(work("plain", "heavy", "k1"), outcome => replies.push(outcome)); kernel.advanceTo(SECOND);
  expect(replies).toEqual(["completed"]); expect("rowLocking" in db.evidence()).toBe(false);
  expect(db.evidence().rows.filter(r => r.version > 1).map(r => r.key)).toEqual(["k1"]);
});

test("a statement that names the second row without a saved order is refused by the key check, never guessed", () => {
  const w = world(undefined);
  let reply: DataReply | undefined; const request = work("bare", "heavy", "k1");
  w.db.accept(request, () => {}); w.kernel.advanceTo(SECOND); reply = request.message!.response as DataReply;
  expect(reply.ok).toBe(false); expect(reply.reason).toBe("key-outside-dataset");
});

// Engine validation refuses shapes the saved order cannot honestly describe.
import { createDataModel2 } from "../src/model2/data/run";
import type { DataInput } from "../src/model2/data/contracts";
const validated = (fn: (db: RelationalConfig) => void) => {
  const input = dataFixture({ keys: 6 }), db = input.resources.find(r => r.kind === "relational") as RelationalConfig, heavy = db.plans.heavy!;
  Object.assign(db, { access: "keyed-uniform", rowLocking: { order: "by-key" }, plans: { ...db.plans, heavy: { ...heavy, statements: [{ ...heavy.statements[0]!, keys: ["$key"] }, { ...heavy.statements[0]!, keys: ["$key2"] }] } } });
  const aside = input.resources.find(r => r.kind === "cache-aside"); if (aside?.kind === "cache-aside") aside.access = "keyed-uniform";
  fn(db); return () => createDataModel2(input as DataInput);
};
test("the engine refuses a second row without a saved order, a malformed write shape, an invalid order, and a cache in front of a marked database", () => {
  expect(validated(() => {})).toThrow("behind a cache"); // the fixture's cache-aside reads this database
  expect(validated(db => { delete db.rowLocking; })).toThrow("outside logical dataset");
  expect(validated(db => { db.rowLocking = { order: "by-key" }; db.plans.heavy!.statements = [db.plans.heavy!.statements[0]!]; })).toThrow("two row updates");
  expect(validated(db => { db.rowLocking = { order: "sideways" as never }; })).toThrow("Invalid row lock order");
  expect(validated(db => { db.rowLocking = { order: "by-key" }; db.access = undefined; })).toThrow("Invalid row lock order");
});
