import { expect, test } from "bun:test";
import { EventKernel } from "../src/model2/time";
import { keyedCache } from "../src/model2/data/cache";
import { cacheAside } from "../src/model2/data/aside";
import type { AsideConfig, CacheConfig, DataReply } from "../src/model2/data/contracts";
import type { Invocation, RemoteCompletion } from "../src/model2/workload/contracts";
import { dataFixture } from "./dataFixture";
import { quantities } from "./workloadFixture";

// Invariants of cache-stale/1 (saved cachePolicy.staleSeconds): a retained expired body answers only a failed refill, only inside the bound,
// is always counted as stale, and is never served once the key was invalidated or refilled.
const SECOND = 1_000_000, TTL = 1 * SECOND;
function world(opts: { staleSeconds?: number; coalesce?: boolean } = {}) {
  const fixture = dataFixture({ ttl: 100 }), config = structuredClone(fixture.resources.find(r => r.kind === "cache") as CacheConfig);
  const { q } = quantities();
  config.ttl = q("t.ttl", TTL, "us");
  if (opts.staleSeconds !== undefined) config.staleFor = q("t.stale", opts.staleSeconds * SECOND, "us");
  const kernel = new EventKernel(1_000_000), cache = keyedCache(config, kernel);
  const db = { up: true, version: 1, rows: new Set(["k"]) };
  const send = (target: string, child: Invocation, done: RemoteCompletion) => {
    if (target === "cache") return cache.accept(child, done);
    const request = child.message!.request as { kind: string; key: string };
    if (db.up && db.rows.has(request.key)) { child.message!.response = { ok: true, rows: [{ key: request.key, version: db.version, bytes: 64 }] } satisfies DataReply; done("completed"); }
    else { child.message!.response = { ok: false, reason: "database-down" } satisfies DataReply; done("rejected"); }
    return { admitted: true, state: () => "finished" as const, cancel: () => "already-finished" as const };
  };
  const aside = cacheAside({ id: "aside", kind: "cache-aside", execution: config.execution, cache: "cache", database: "db", keys: ["k"], access: "cycle", coalesce: opts.coalesce ?? false,
    onCacheFailure: "database", ...(opts.staleSeconds !== undefined ? { staleOnError: true as const } : {}), invalidateWrites: true, operations: { read: "read", write: "write" } } as AsideConfig, kernel, send, "seed");
  let n = 0;
  const call = (operation: "read" | "write") => {
    const id = String(n++), work: Invocation = { rootId: JSON.stringify(["root", "t", id]), callId: JSON.stringify([id]), operation, attempt: 0, offeredAt: kernel.now, message: { request: { kind: "get", key: "k" } } };
    let outcome = ""; aside.accept(work, o => { outcome = o; });
    return { work, outcome: () => outcome, reply: () => work.message!.response as DataReply | undefined };
  };
  const at = (us: number) => kernel.advanceTo(us);
  const settle = (calls: Array<ReturnType<typeof call>>) => { at(kernel.now + 5000); return calls; };
  const read = () => { const c = call("read"); settle([c]); return c; };
  return { kernel, cache, aside, db, call, at, read, settle };
}

test("without a saved bound a failed refill fails the caller and no stale evidence exists", () => {
  const w = world(); w.read(); w.at(2 * SECOND); w.db.up = false;
  const c = w.read();
  expect(c.outcome()).toBe("rejected"); expect(c.reply()?.stale).toBeUndefined();
  expect("staleServed" in w.cache.evidence()).toBe(false);
});

test("with a saved bound a failed refill is answered from the expired body and counted as stale, never as fresh", () => {
  const w = world({ staleSeconds: 60 }); w.read(); w.at(3 * SECOND); w.db.up = false;
  const c = w.read();
  expect(c.outcome()).toBe("completed"); expect(c.reply()).toMatchObject({ ok: true, stale: true, version: 1 });
  expect(w.cache.evidence()).toMatchObject({ staleServed: 1 });
  expect((w.cache.evidence() as { maxStaleAgeUs: number }).maxStaleAgeUs).toBeGreaterThan(0);
  // A healthy refill is an ordinary fresh answer, not stale, and replaces the retained body.
  w.db.up = true; w.db.version = 2; const fresh = w.read();
  expect(fresh.reply()?.stale).toBeUndefined(); expect(fresh.reply()?.rows?.[0]?.version).toBe(2);
  expect(w.cache.evidence()).toMatchObject({ staleServed: 1 });
});

test("a stale answer never appears after a committed write invalidated the key", () => {
  const control = world({ staleSeconds: 60 }); control.read(); control.at(3 * SECOND); control.db.up = false;
  expect(control.read().reply()?.stale).toBe(true); // same history without the write: stale is served
  const w = world({ staleSeconds: 60 }); w.read(); w.at(3 * SECOND);
  const write = w.call("write"); w.settle([write]); expect(write.outcome()).toBe("completed");
  w.db.up = false;
  const c = w.read();
  expect(c.outcome()).toBe("rejected"); expect(c.reply()?.stale).toBeUndefined();
  expect(w.cache.evidence()).toMatchObject({ staleServed: 0, maxStaleAgeUs: null });
});

test("a stale answer needs a retained body: a key that was never filled is never invented", () => {
  const w = world({ staleSeconds: 60 }); w.db.up = false;
  const c = w.read();
  expect(c.outcome()).toBe("rejected"); expect(w.cache.evidence()).toMatchObject({ staleServed: 0, maxStaleAgeUs: null });
});

test("the bound is measured from expiry and excludes its exact end", () => {
  const w = world({ staleSeconds: 10 }); w.read(); // filled at ~100 us, expires at TTL + fill time
  const expiresAt = (w.cache.evidence().entries as Array<{ expires: number }>)[0]!.expires;
  const probe = (age: number) => { const x = world({ staleSeconds: 10 }); x.read(); x.at(expiresAt + age); x.db.up = false; return x.read(); };
  expect(probe(0).reply()?.stale).toBe(true);
  expect(probe(10 * SECOND - 6000).reply()?.stale).toBe(true);
  expect(probe(10 * SECOND + 1).outcome()).toBe("rejected");
});

test("every waiter of a failed shared fill is counted once, and each counts as stale", () => {
  const w = world({ staleSeconds: 60, coalesce: true }); w.read(); w.at(3 * SECOND); w.db.up = false;
  const calls = [w.call("read"), w.call("read"), w.call("read")]; w.settle(calls);
  expect(calls.map(c => c.reply()?.stale)).toEqual([true, true, true]);
  expect(w.cache.evidence()).toMatchObject({ staleServed: 3 });
});

test("the same history replays to identical evidence", () => {
  const history = () => { const w = world({ staleSeconds: 60 }); w.read(); w.at(3 * SECOND); w.db.up = false; w.read(); w.read(); w.db.up = true; w.read(); return JSON.stringify([w.cache.evidence(), w.aside.evidence()]); };
  expect(history()).toBe(history());
});

test("reading evidence between commands never expires, refreshes or counts anything", () => {
  const history = (watch: boolean) => {
    const w = world({ staleSeconds: 60 }); w.read(); w.at(3 * SECOND); w.db.up = false;
    const look = () => { if (watch) { w.cache.evidence(); w.aside.evidence(); } };
    look(); w.read(); look(); w.at(30 * SECOND); look(); w.read(); look();
    return JSON.stringify([w.cache.evidence(), w.aside.evidence()]);
  };
  expect(history(true)).toBe(history(false));
});
