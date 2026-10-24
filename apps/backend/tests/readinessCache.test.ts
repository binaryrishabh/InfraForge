import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { createReadinessCache } from "../health/readinessCache";

test("HTTP readiness bursts only read startup and scheduled deep snapshots", async () => {
  let now = 0, calls = 0, scheduled: (() => void) | undefined;
  let complete: ((value: { success: boolean; release: { sha: string; authContract: number } }) => void) | undefined;
  const snapshot = { success: true, release: { sha: "a".repeat(40), authContract: 1 } };
  const cache = createReadinessCache(async () => { calls++; return new Promise<typeof snapshot>(resolve => { complete = resolve; }); }, {
    now: () => now, schedule: run => { scheduled = run; return () => { scheduled = undefined; }; },
  });
  const server = createServer((_req, res) => { const result = cache.check(); res.writeHead(result.success ? 200 : 503); res.end(JSON.stringify(result)); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("Test listener unavailable");
  const burst = () => Promise.all(Array.from({ length: 50 }, async () => {
    const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
    return { status: response.status, body: await response.json() };
  }));
  try {
    expect((await burst()).every(r => r.status === 503)).toBe(true); expect(calls).toBe(1);
    complete!(snapshot); await cache.started;
    expect((await burst()).every(r => r.status === 200 && JSON.stringify(r.body) === JSON.stringify(snapshot))).toBe(true);
    expect(calls).toBe(1);
    now = 10000; scheduled!(); scheduled = undefined;
    expect(calls).toBe(2); expect((await burst()).every(r => r.status === 200)).toBe(true);
    // A slow refresh keeps serving the last success within the bound.
    now = 25000; expect((await burst()).every(r => r.status === 200)).toBe(true); expect(calls).toBe(2);
    // A hung refresh cannot make the old success live indefinitely or spawn a new probe.
    now = 40000; expect((await burst()).every(r => r.status === 503)).toBe(true); expect(calls).toBe(2);
    complete!(snapshot); await Bun.sleep(0);
    expect(cache.check()).toEqual(snapshot); expect(scheduled).toBeDefined();
  } finally { await cache.close(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  expect(scheduled).toBeUndefined(); expect(cache.check()).toEqual({ success: false });
});

test("failed background verification replaces success and the scheduler recovers", async () => {
  let calls = 0, scheduled: (() => void) | undefined;
  const cache = createReadinessCache(async () => { if (++calls === 2) throw Error("schema drift"); return { success: true }; }, {
    schedule: run => { scheduled = run; return () => {}; },
  });
  await cache.started; expect(cache.check().success).toBe(true);
  scheduled!(); await Promise.resolve(); await Promise.resolve();
  expect(cache.check()).toEqual({ success: false }); expect(calls).toBe(2);
  scheduled!(); await Promise.resolve(); await Promise.resolve();
  expect(cache.check().success).toBe(true); expect(calls).toBe(3);
  await cache.close(); scheduled!(); expect(calls).toBe(3);
});

test("readiness rejects invalid timing", () => {
  for (const options of [{ intervalMs: 0 }, { intervalMs: 40000 }, { maxAgeMs: NaN }]) {
    expect(() => createReadinessCache(async () => ({ success: true }), options)).toThrow("timing");
  }
});

test("a dependency loss is unready at once, and a probe begun before it cannot restore success", async () => {
  let calls = 0, complete: ((value: { success: boolean }) => void) | undefined, scheduled: (() => void) | undefined;
  const cache = createReadinessCache(() => { calls++; return calls === 1 ? Promise.resolve({ success: true })
    : new Promise<{ success: boolean }>((resolve) => { complete = resolve; }); },
  { now: () => 0, schedule: (run) => { scheduled = run; return () => { scheduled = undefined; }; } });
  await cache.started;
  expect(cache.check()).toEqual({ success: true });
  scheduled!(); expect(calls).toBe(2);
  cache.invalidate();
  expect(cache.check()).toEqual({ success: false });
  // Invalidation itself never starts another deep probe.
  expect(calls).toBe(2);
  complete!({ success: true }); await Bun.sleep(0);
  expect(cache.check()).toEqual({ success: false });
  scheduled!(); complete!({ success: true }); await Bun.sleep(0);
  expect(calls).toBe(3); expect(cache.check()).toEqual({ success: true });
  await cache.close();
});

test("deep schema verification runs once, then again only after a failure or a lost session", async () => {
  const { deepOnce } = await import("../health/readiness");
  let light = 0, deep = 0, lightFails = false;
  const probe = deepOnce({
    light: async () => { light++; if (lightFails) throw Error("database unavailable"); },
    deep: async () => { deep++; },
    extra: async () => {},
    release: async () => "release",
  });
  for (let i = 0; i < 5; i++) expect(await probe()).toEqual({ success: true, release: "release" });
  // Scheduled probes stay light: one deep check, five light checks.
  expect([light, deep]).toEqual([5, 1]);
  lightFails = true;
  expect(await probe()).toEqual({ success: false });
  lightFails = false;
  expect(await probe()).toEqual({ success: true, release: "release" });
  expect(deep).toBe(2);
  probe.reverify();
  await probe();
  expect(deep).toBe(3);
});

test("a failed deep check never reports ready and is retried on the next probe", async () => {
  const { deepOnce } = await import("../health/readiness");
  let deep = 0, broken = true;
  const probe = deepOnce({ light: async () => {}, deep: async () => { deep++; if (broken) throw Error("drift"); },
    extra: async () => {}, release: async () => "release" });
  expect(await probe()).toEqual({ success: false });
  expect(await probe()).toEqual({ success: false });
  broken = false;
  expect((await probe()).success).toBe(true);
  expect(deep).toBe(3);
});
