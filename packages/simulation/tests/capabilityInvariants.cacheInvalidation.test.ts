import { expect, test } from "bun:test";
import { EventKernel } from "../src/model2/time";
import { keyedCache } from "../src/model2/data/cache";
import { cacheAside } from "../src/model2/data/aside";
import type { AsideConfig, CacheConfig, DataReply } from "../src/model2/data/contracts";
import type { Invocation, RemoteCompletion } from "../src/model2/workload/contracts";
import { dataFixture } from "./dataFixture";
import { quantities } from "./workloadFixture";

// Invariants of cache-invalidation/1 (saved cachePolicy.invalidateOnWrite): freshness evidence exists only when marked, an outdated hit needs a committed write
// that the cached body does not reflect, invalidation on write never serves an older body once the write's invalidation has run, and recorded counts are never erased.
const SECOND = 1_000_000;
type Versions = Map<string, number>;
function world(opts: { invalidate?: boolean; marked?: boolean; ttl?: number } = {}) {
  const fixture = dataFixture({ ttl: 100 }), config = structuredClone(fixture.resources.find(r => r.kind === "cache") as CacheConfig);
  const { q } = quantities();
  config.ttl = q("t.ttl", (opts.ttl ?? 30) * SECOND, "us");
  const kernel = new EventKernel(1_000_000), cache = keyedCache(config, kernel);
  const committed: Versions = new Map([["a", 1], ["b", 1]]);
  const send = (target: string, child: Invocation, done: RemoteCompletion) => {
    if (target === "cache") return cache.accept(child, done);
    const request = child.message!.request as { kind: string; key: string };
    if (child.operation === "write") committed.set(request.key, committed.get(request.key)! + 1);
    child.message!.response = { ok: true, rows: [{ key: request.key, version: committed.get(request.key)!, bytes: 64 }] } satisfies DataReply; done("completed");
    return { admitted: true, state: () => "finished" as const, cancel: () => "already-finished" as const };
  };
  const marked = opts.marked ?? true;
  const aside = cacheAside({ id: "aside", kind: "cache-aside", execution: config.execution, cache: "cache", database: "db", keys: ["a", "b"], access: "cycle", coalesce: false,
    onCacheFailure: "database", invalidateWrites: opts.invalidate ?? true, ...(marked ? { trackFreshness: true as const } : {}), operations: { read: "read", write: "write" } } as AsideConfig, kernel, send, "seed",
    marked ? (key: string) => committed.get(key) : undefined);
  let n = 0;
  const call = (operation: "read" | "write", key = "a") => {
    const id = String(n++), work: Invocation = { rootId: JSON.stringify(["root", "t", id]), callId: JSON.stringify([id]), operation, attempt: 0, offeredAt: kernel.now, message: { request: { kind: "get", key } } };
    aside.accept(work, () => {}); kernel.advanceTo(kernel.now + 5000);
    const reply = work.message!.response as DataReply;
    return { ...reply, version: reply.version ?? reply.rows?.[0]?.version };
  };
  const at = (us: number) => kernel.advanceTo(us);
  const freshness = () => (aside.evidence() as { freshness?: { hits: number; outdatedHits: number; maxVersionsBehind: number; unobserved: number } }).freshness;
  return { kernel, cache, aside, committed, call, at, freshness };
}

test("evidence exists only when marked: an unmarked aside records no freshness key and counts nothing", () => {
  const w = world({ marked: false, invalidate: false }); w.call("read"); w.call("write"); const hit = w.call("read");
  expect(hit.version).toBe(1);
  expect("freshness" in w.aside.evidence()).toBe(false);
});

test("with invalidation off a hit after a committed write is counted as outdated, and how far behind", () => {
  const w = world({ invalidate: false }); w.call("read");
  expect(w.freshness()).toEqual({ hits: 0, outdatedHits: 0, maxVersionsBehind: 0, unobserved: 0 });
  w.call("write"); w.call("write");
  const hit = w.call("read");
  expect(hit.version).toBe(1);
  expect(w.freshness()).toEqual({ hits: 1, outdatedHits: 1, maxVersionsBehind: 2, unobserved: 0 });
});

test("with invalidation on a write removes the body, the next read refills the committed version and nothing is outdated", () => {
  const w = world({ invalidate: true }); w.call("read"); w.call("write");
  expect(w.call("read").version).toBe(2); expect(w.call("read").version).toBe(2);
  expect(w.freshness()).toEqual({ hits: 1, outdatedHits: 0, maxVersionsBehind: 0, unobserved: 0 });
});

test("an outdated hit needs a committed write to that key: reads, expiry and writes to another key never count", () => {
  const w = world({ invalidate: false }); w.call("read", "a"); w.call("read", "b");
  for (let i = 0; i < 5; i++) { w.call("read", "a"); w.call("read", "b"); }
  w.at(45 * SECOND); for (let i = 0; i < 3; i++) { w.call("read", "a"); w.call("read", "b"); }
  expect(w.freshness()).toMatchObject({ outdatedHits: 0, maxVersionsBehind: 0, unobserved: 0 });
  w.call("write", "b"); w.call("read", "a");
  expect(w.freshness()).toMatchObject({ outdatedHits: 0 });
  w.call("read", "b"); expect(w.freshness()).toMatchObject({ outdatedHits: 1 });
});

test("a body refilled after the write is current again: the TTL ends the outdated run", () => {
  const w = world({ invalidate: false, ttl: 5 }); w.call("read"); w.call("write"); w.call("read"); w.call("read");
  expect(w.freshness()).toMatchObject({ outdatedHits: 2 });
  w.at(10 * SECOND); expect(w.call("read").version).toBe(2); w.call("read");
  expect(w.freshness()).toMatchObject({ outdatedHits: 2, hits: 3 });
});

test("a commit that is not yet invalidated is outdated for the readers who hit in that gap", () => {
  const w = world({ invalidate: true }); w.call("read"); w.committed.set("a", 2); // committed, invalidation not yet issued
  w.call("read"); expect(w.freshness()).toMatchObject({ outdatedHits: 1, maxVersionsBehind: 1 });
});

test("swept schedule: counts equal an independent recount, and invalidation on never serves an older body than the committed one", () => {
  for (const invalidate of [true, false]) for (const seed of [1, 2, 3]) {
    const w = world({ invalidate, ttl: 4 }); let state = seed, recount = 0, hits = 0, behind = 0;
    for (let step = 0; step < 300; step++) {
      state = (state * 1103515245 + 12345) % 2147483648; const key = state % 2 ? "a" : "b", kind = (state >> 3) % 10 < 3 ? "write" : "read";
      if (step % 17 === 0) w.at(w.kernel.now + 3 * SECOND);
      const before = w.committed.get(key)!, reply = w.call(kind, key);
      if (kind === "read" && w.cache && reply.ok) { const wasHit = w.freshness()!.hits > hits; if (wasHit) { hits++; if (reply.version! < before) { recount++; behind = Math.max(behind, before - reply.version!); } } }
      if (invalidate && kind === "read") expect(reply.version!).toBeGreaterThanOrEqual(before);
    }
    expect(w.freshness()).toEqual({ hits, outdatedHits: recount, maxVersionsBehind: behind, unobserved: 0 });
    if (invalidate) expect(recount).toBe(0); else expect(recount).toBeGreaterThan(0);
  }
});

test("a flush empties the cache but never erases recorded outdated hits", () => {
  const w = world({ invalidate: false }); w.call("read"); w.call("write"); w.call("read");
  w.cache.flush(); w.call("read"); w.call("read");
  expect(w.freshness()).toMatchObject({ outdatedHits: 1, maxVersionsBehind: 1 });
});

test("the same history replays to identical evidence and reading evidence changes nothing", () => {
  const history = (watch: boolean) => { const w = world({ invalidate: false, ttl: 6 }); for (let i = 0; i < 40; i++) { if (watch) { w.aside.evidence(); w.cache.evidence(); } w.call(i % 4 === 3 ? "write" : "read", i % 2 ? "a" : "b"); if (i % 9 === 8) w.at(w.kernel.now + 4 * SECOND); } return JSON.stringify([w.cache.evidence(), w.aside.evidence()]); };
  expect(history(true)).toBe(history(false));
  expect(history(false)).toBe(history(false));
});
