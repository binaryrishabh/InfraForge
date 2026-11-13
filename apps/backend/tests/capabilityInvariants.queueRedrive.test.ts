import { expect, test } from "bun:test";
import { starter } from "../challenges/starter";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";

// Invariants of queue-redrive/1 (saved asyncQueue.redriveAtSecond and asyncWorker.repairAtSecond), read from real engine evidence.
const workload = { targetThroughput: 60, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light" as const };
interface Knobs { visibility?: number; maxReceives?: number; redriveAt?: number; repairAt?: number; bad?: number; wait?: number; concurrency?: number; dlq?: number; capacity?: number }
function run(k: Knobs, seconds: number) {
  const queue = { enabled: true, visibilityTimeoutSeconds: k.visibility ?? 5, maxReceives: k.maxReceives ?? 3, retentionSeconds: 300, ...(k.redriveAt ? { redriveAtSecond: k.redriveAt } : {}), ...(k.dlq !== undefined ? { deadLetterCapacity: k.dlq } : {}), ...(k.capacity ? { capacityMessages: k.capacity } : {}) };
  const asyncWorker = { enabled: true, concurrency: k.concurrency ?? 4, prefetch: 8, cpuMsPerJob: 10, ...(k.bad ? { badJobPercent: k.bad } : {}), ...(k.repairAt ? { repairAtSecond: k.repairAt } : {}), ...(k.wait !== undefined ? { externalWaitMs: k.wait } : {}) };
  const design = starter([["app", "Virtual Machine", 0, 0], ["queue", "Message Queue", 1, 0, { asyncQueue: queue }], ["worker", "Virtual Machine", 2, 0, { asyncWorker }], ["store", "Object Storage", 1, 2]],
    [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]);
  const engine = createModel2Engine(captureRunInputs({ ...design, layoutVersion: 3 }, workload, "capability-invariants"), seconds);
  const at: Record<number, any> = {};
  for (let s = 1; s <= seconds; s++) { engine.advance(); at[s] = pick(engine.evidence()); }
  return { at, last: at[seconds], engine };
}
const find = (o: any, k: string, acc: any[] = []) => { if (o && typeof o === "object") { if (k in o) acc.push(o); for (const v of Object.values(o)) find(v, k, acc); } return acc; };
function pick(evidence: unknown) {
  const queue = find(evidence, "dlqBytes").find(x => Array.isArray(x.events)), worker = find(evidence, "creditOwnedLocally")[0];
  const deliveries = queue.events.filter((e: any) => e.kind === "delivery");
  const perMessage = new Map<string, number>(); for (const d of deliveries) perMessage.set(d.message, (perMessage.get(d.message) ?? 0) + 1);
  return { queue, worker, receipts: deliveries.map((e: any) => e.delivery as string), perMessage, omitted: queue.omitted as number };
}

test("a redriven message never reuses a delivery receipt, even while its first delivery is still being worked", () => {
  // Visibility 1 s, two receives, a nine-second wait: the first deliveries outlive their leases and the redrive returns the same messages.
  const { last } = run({ visibility: 1, maxReceives: 2, redriveAt: 3, concurrency: 4, wait: 9000 }, 24);
  expect(last.omitted).toBe(0);
  expect(last.queue.redriven).toBeGreaterThan(0);
  expect(new Set(last.receipts).size).toBe(last.receipts.length);
});

test("redrive happens once: returned messages get at most their own delivery limit again, and nothing is created or lost", () => {
  const { last } = run({ bad: 100, repairAt: 12, redriveAt: 20, maxReceives: 3, visibility: 5 }, 60);
  const q = last.queue;
  expect(last.omitted).toBe(0);
  expect(q.redriven).toBeGreaterThan(0);
  expect(q.redriven).toBeLessThanOrEqual(q.deadLettered);
  // One redrive of the dead-letter list: no message is delivered more than twice its limit.
  for (const n of last.perMessage.values()) expect(n).toBeLessThanOrEqual(2 * 3);
  // Conservation of original messages: acknowledged + still owned + dead-lettered (net of redrives) + discarded + expired = accepted.
  expect(q.acknowledged + q.ready + q.inFlight + q.scheduled + (q.deadLettered - q.redriven) + q.discarded + q.expired).toBe(q.accepted);
  expect(q.dlq.length).toBe(q.deadLettered - q.redriven);
}, 60000);

test("redrive before the repair re-dead-letters the same messages; redrive after the repair drains them", () => {
  const early = run({ bad: 100, repairAt: 30, redriveAt: 15, maxReceives: 3, visibility: 5 }, 60).last.queue;
  const late = run({ bad: 100, repairAt: 15, redriveAt: 30, maxReceives: 3, visibility: 5 }, 60).last.queue;
  expect(early.redriven).toBeGreaterThan(0);
  expect(early.deadLettered).toBeGreaterThan(early.redriven); // returned messages failed again
  expect(late.redriven).toBeGreaterThan(0);
  expect(late.dlq.length).toBe(0);
  expect(late.acknowledged).toBeGreaterThan(early.acknowledged);
}, 60000);

test("the redrive never overfills the queue's own message capacity and leaves the rest in the dead-letter list", () => {
  const { at } = run({ bad: 100, redriveAt: 20, maxReceives: 1, visibility: 5, capacity: 3, wait: 0 }, 40);
  for (const s of Object.values(at)) expect(s.queue.messages.length).toBeLessThanOrEqual(3);
}, 60000);

test("unmarked queues and workers show no redrive evidence and keep poison failing for the whole run", () => {
  const { last } = run({ bad: 100, maxReceives: 3, visibility: 5 }, 40);
  expect("redriven" in last.queue).toBe(false);
  expect(last.queue.acknowledged).toBe(0);
  expect(last.queue.deadLettered).toBeGreaterThan(0);
}, 60000);

test("the same saved design replays to byte-identical queue and worker evidence whether or not it is read in between", () => {
  const a = run({ bad: 100, repairAt: 15, redriveAt: 20, maxReceives: 3, visibility: 5 }, 40);
  const b = createModel2Engine(captureRunInputs((() => { const d = starter([["app", "Virtual Machine", 0, 0], ["queue", "Message Queue", 1, 0, { asyncQueue: { enabled: true, visibilityTimeoutSeconds: 5, maxReceives: 3, retentionSeconds: 300, redriveAtSecond: 20 } }], ["worker", "Virtual Machine", 2, 0, { asyncWorker: { enabled: true, concurrency: 4, prefetch: 8, cpuMsPerJob: 10, badJobPercent: 100, repairAtSecond: 15 } }], ["store", "Object Storage", 1, 2]], [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]); return { ...d, layoutVersion: 3 }; })(), workload, "capability-invariants"), 40);
  for (let s = 1; s <= 40; s++) b.advance();
  const x = pick(b.evidence());
  expect(JSON.stringify([x.queue, x.worker])).toBe(JSON.stringify([a.last.queue, a.last.worker]));
}, 60000);
