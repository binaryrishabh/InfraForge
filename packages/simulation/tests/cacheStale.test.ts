import { test, expect } from "bun:test";
import { EventKernel } from "../src/model2/time";
import { dataFixture } from "./dataFixture";
import { quantities } from "./workloadFixture";
import type { CacheConfig, DataReply, DataRequest } from "../src/model2/data/contracts";
import { keyedCache } from "../src/model2/data/cache";
import type { Invocation } from "../src/model2/workload/contracts";

const work = (id: string): Invocation => ({ rootId: JSON.stringify(["root", "test", id]), callId: JSON.stringify([id]), operation: "light", attempt: 0, offeredAt: 0, sessionId: id, message: { request: { kind: "get", key: "k" } } });
function harness(staleUs?: number, capacity?: number) {
  const config = structuredClone(dataFixture({ ttl: 100 }).resources.find(r => r.kind === "cache") as CacheConfig);
  if (staleUs !== undefined) config.staleFor = quantities().q("test.stale", staleUs, "us");
  if (capacity !== undefined) config.capacity = quantities().q("test.capacity", capacity, "bytes");
  const k = new EventKernel(100000), c = keyedCache(config, k); let n = 0, time = 0;
  const command = (request: DataRequest) => { const w = work(String(n++)); w.message = { request }; c.accept(w, () => {}); k.advanceTo(time += 10); return w.message.response as DataReply; };
  return { c, k, command, at: (t: number) => { k.advanceTo(time = t); } };
}

test("without a stale bound an expired body is removed and never served, and no stale evidence appears", () => {
  const h = harness(); h.command({ kind: "set", key: "k", row: { version: 1, bytes: 64 } }); h.at(200);
  expect(h.command({ kind: "get-stale", key: "k" }).hit).toBe(false);
  expect(h.command({ kind: "get", key: "k" }).hit).toBe(false);
  expect("staleServed" in h.c.evidence()).toBe(false);
});

test("with a stale bound an expired body is never a fresh hit, answers get-stale only inside the bound and is counted", () => {
  const h = harness(500); h.command({ kind: "set", key: "k", row: { version: 7, bytes: 64 } });
  expect(h.command({ kind: "get-stale", key: "k" }).hit).toBe(false); // still fresh: not a stale answer
  h.at(150);
  expect(h.command({ kind: "get", key: "k" }).hit).toBe(false);
  const stale = h.command({ kind: "get-stale", key: "k" });
  expect([stale.ok, stale.hit, stale.stale, stale.version]).toEqual([true, true, true, 7]);
  expect(stale.ageUs).toBeGreaterThan(0);
  expect(h.c.evidence()).toMatchObject({ staleServed: 1, maxStaleAgeUs: stale.ageUs });
  h.at(700); expect(h.command({ kind: "get-stale", key: "k" }).hit).toBe(false); // beyond the bound
  expect(h.c.evidence().allocatedEntryBytes).toBe(0);
});

test("an invalidated entry is never served stale and retained bodies still own bytes", () => {
  const h = harness(500); h.command({ kind: "set", key: "k", row: { version: 1, bytes: 64 } }); h.at(150);
  expect(h.c.evidence().allocatedEntryBytes).toBeGreaterThan(0);
  h.command({ kind: "invalidate", key: "k" });
  expect(h.command({ kind: "get-stale", key: "k" }).hit).toBe(false);
  expect(h.c.evidence().allocatedEntryBytes).toBe(0);
});

test("no stale answer has been served yet: the oldest age is Unknown (null), never zero", () => {
  const h = harness(500); h.command({ kind: "set", key: "k", row: { version: 1, bytes: 64 } });
  expect(h.c.evidence()).toMatchObject({ staleServed: 0, maxStaleAgeUs: null });
});
