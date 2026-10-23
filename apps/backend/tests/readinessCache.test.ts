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
