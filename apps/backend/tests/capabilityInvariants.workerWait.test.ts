import { expect, test } from "bun:test";
import { starter } from "../challenges/starter";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";

// Invariants of worker-wait/1 (saved asyncWorker.externalWaitMs): a waiting job keeps its slot, credit and lease, spends no CPU, and releases once.
const workload = { targetThroughput: 240, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light" as const };
const find = (o: any, k: string, acc: any[] = []) => { if (o && typeof o === "object") { if (k in o) acc.push(o); for (const v of Object.values(o)) find(v, k, acc); } return acc; };
interface Knobs { wait?: number; concurrency?: number; size?: "small" | "medium" | "large"; cpuMs?: number; visibility?: number; ackDelayMs?: number }
function run(k: Knobs, seconds: number) {
  const asyncWorker = { enabled: true, concurrency: k.concurrency ?? 1, prefetch: 8, cpuMsPerJob: k.cpuMs ?? 50, ...(k.wait !== undefined ? { externalWaitMs: k.wait } : {}), ...(k.ackDelayMs ? { acknowledgementDelayMs: k.ackDelayMs } : {}) };
  const design = starter([["app", "Virtual Machine", 0, 0], ["queue", "Message Queue", 1, 0, { asyncQueue: { enabled: true, visibilityTimeoutSeconds: k.visibility ?? 120, maxReceives: 3, retentionSeconds: 300, capacityMessages: 1000 } }],
    ["worker", "Virtual Machine", 2, 0, { size: k.size ?? "medium", asyncWorker }], ["store", "Object Storage", 1, 2]], [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]);
  const engine = createModel2Engine(captureRunInputs({ ...design, layoutVersion: 3 }, workload, "wait-invariants"), seconds);
  const maxActive: number[] = [], maxLocal: number[] = [];
  for (let s = 1; s <= seconds; s++) { engine.advance(); const w = find(engine.evidence(), "creditOwnedLocally")[0]; maxActive.push(w.active); maxLocal.push(w.creditOwnedLocally); }
  const ev = engine.evidence(), queue = find(ev, "dlqBytes").find(x => Array.isArray(x.events)), worker = find(ev, "creditOwnedLocally")[0];
  return { queue, worker, maxActive: Math.max(...maxActive), maxLocal: Math.max(...maxLocal), digest: JSON.stringify([queue, worker]) };
}

test("a job holds one slot for its CPU plus its wait: completions are bounded by slots over that time, and the slot limit is never exceeded", () => {
  const one = run({ wait: 450, concurrency: 1 }, 40), four = run({ wait: 450, concurrency: 4 }, 40);
  expect(one.maxActive).toBeLessThanOrEqual(1); expect(four.maxActive).toBeLessThanOrEqual(4);
  expect(one.worker.acknowledged).toBeLessThanOrEqual(Math.floor(40 / 0.5)); // one slot, 500 ms per job
  expect(one.worker.acknowledged).toBeGreaterThan(60);
  expect(four.worker.acknowledged).toBeGreaterThan(one.worker.acknowledged + 50);
  expect(one.queue.accepted).toBeGreaterThan(one.worker.acknowledged + 40); // a backlog, not lost work
});

test("waiting spends no CPU: CPU per finished job is the same with and without the wait", () => {
  const without = run({ wait: 0, concurrency: 4 }, 30), withWait = run({ wait: 900, concurrency: 4 }, 30);
  const perJob = (r: ReturnType<typeof run>) => r.worker.cpu.appCoreUs / (r.worker.processed + r.worker.active);
  expect(withWait.worker.processed).toBeGreaterThan(0);
  expect(Math.abs(perJob(withWait) - perJob(without)) / perJob(without)).toBeLessThan(0.15);
});

test("a waiting job keeps its prefetch credit and lease until it acknowledges", () => {
  const r = run({ wait: 20000, concurrency: 2, visibility: 300 }, 10);
  expect(r.worker.processed).toBe(0); expect(r.worker.active).toBe(2);
  expect(r.queue.consumers[0].outstanding.length).toBe(r.worker.creditOwnedLocally);
  expect(r.queue.consumers[0].outstanding.length).toBe(8); // the whole prefetch credit is held by waiting and buffered jobs
});

test("a larger machine adds cores, never slots", () => {
  const medium = run({ wait: 450, concurrency: 1, size: "medium" }, 30), big = run({ wait: 450, concurrency: 1, size: "large" }, 30);
  expect(Math.abs(medium.worker.acknowledged - big.worker.acknowledged)).toBeLessThanOrEqual(2);
});

test("a saved 0 ms wait behaves exactly like no saved wait", () => {
  const unset = run({ concurrency: 2 }, 20), zero = run({ wait: 0, concurrency: 2 }, 20);
  expect(zero.digest).toBe(unset.digest);
});

test("the largest saved wait runs without error and releases nothing early", () => {
  const r = run({ wait: 60000, concurrency: 2, visibility: 3600 }, 15);
  expect(r.worker.processed).toBe(0); expect(r.queue.acknowledged).toBe(0); expect(r.worker.active).toBe(2);
});

test("a wait longer than the visibility timeout is delivered again, never acknowledged twice for one delivery", () => {
  const r = run({ wait: 3000, concurrency: 4, visibility: 1 }, 20);
  expect(r.queue.leaseExpired).toBeGreaterThan(0);
  expect(r.worker.acknowledged).toBeLessThanOrEqual(r.queue.accepted);
  expect(r.queue.acknowledged).toBeLessThanOrEqual(r.queue.accepted);
  expect(r.maxActive).toBeLessThanOrEqual(4);
});
