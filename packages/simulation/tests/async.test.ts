import { test, expect } from "bun:test";
import { createAsyncModel2 } from "../src/model2/async/run";
import { deliveryQueue } from "../src/model2/async/broker";
import { objectStore } from "../src/model2/async/objects";
import { EventKernel } from "../src/model2/time";
import { asyncFixture } from "./asyncFixture";
import { quantities } from "./workloadFixture";
import type { AsyncInput, BrokerConfig, ObjectConfig, WorkerConfig, QueueReply, QueueRequest, ObjectReply, ObjectRequest } from "../src/model2/async/contracts";
import type { Invocation } from "../src/model2/workload/contracts";
import { requireKnown } from "../src/reality/quantity";
import { keyedUniform } from "../src/model2/random";
import { resolveModel } from "../src/model2/registry";
import type { PublisherConfig } from "../src/model2/async/contracts";
export const asyncRun = (i: AsyncInput, batch?: number) => { const m = createAsyncModel2(i); if (batch) for (let at = batch; at < m.horizon; at += batch) m.advanceTo(at); m.advanceTo(m.horizon); return m.evidence(); };
const broker = (i: AsyncInput) => i.resources.find((r) => r.kind === "delivery-queue") as BrokerConfig;
const store = (i: AsyncInput) => i.resources.find((r) => r.kind === "object-store") as ObjectConfig;
const workers = (i: AsyncInput) => i.resources.filter((r) => r.kind === "async-worker") as WorkerConfig[];
const invocation = (id: string, request: unknown): Invocation => ({ rootId: JSON.stringify([id]), callId: JSON.stringify([id]), operation: "light", attempt: 0, offeredAt: 0, message: { request } });
export function asyncConservation(e: ReturnType<typeof asyncRun>) {
  const c = e.counts; if (c.offered !== c.completed + c.rejected + c.deadlineExceeded + c.abandoned + c.inFlight) throw Error("Caller partition");
  for (const r of e.resources) if (r.received !== r.admitted + r.rejected || r.admitted !== r.completed + r.failed + r.cancelled + r.queued + r.serving + r.waiting) throw Error(`Station partition ${r.id}`);
  for (const b of e.asynchronous.brokers) {
    if (b.accepted !== b.ready + b.scheduled + b.inFlight + b.acknowledged + b.deadLettered + b.expired + b.discarded || b.messages.length !== b.ready + b.scheduled + b.inFlight || b.liveBytes !== b.messages.reduce((n, m) => n + m.body.bytes, 0) || b.dlqBytes !== b.dlq.reduce((n, m) => n + m.message.body.bytes, 0) || b.deadLettered !== b.dlq.length) throw Error("Broker message ownership/bytes");
    if (b.deliveries < b.redelivered || b.consumers.reduce((n, c) => n + c.outstanding.length, 0) !== b.inFlight || b.consumers.some((c) => c.outstanding.length > c.credit)) throw Error("Delivery credit ownership");
  }
  for (const s of e.asynchronous.objects) if (s.storedBytes !== s.objects.reduce((n, o) => n + o.bytes, 0) || s.storedBytes < 0) throw Error("Object byte ownership");
  for (const w of e.asynchronous.workers) { const cfg = e.asyncConfiguration.find((r) => r.id === w.id) as WorkerConfig; if (w.active > requireKnown(cfg.concurrency, "count") || w.creditOwnedLocally > requireKnown(cfg.prefetch, "count") || w.cpu.appCoreUs > w.cpu.availableCoreUs + 1e-5) throw Error("Worker ownership/CPU"); }
}
test("async pipeline uploads, publishes, reads, computes, writes DB/result and acknowledges real ownership", () => {
  const e = asyncRun(asyncFixture({ database: true })); expect(e.counts.completed).toBe(12); expect(e.asynchronous.brokers[0]!.acknowledged).toBe(12); expect(e.asynchronous.objects[0]!.objects).toHaveLength(24); expect(e.data.databases[0]!.transactions.committed).toBe(12); expect(e.asynchronous.workers[0]!.cpu.appCoreUs).toBe(6000); asyncConservation(e);
});
test("real backlog ages under slow consumers and drains through recovery", () => {
  const i = asyncFixture({ count: 24, interval: 20, processing: 1000, horizon: 100000 }), q = quantities(); i.asyncInterventions = [{ id: "consumer-down", kind: "consumer-state", target: "worker-0", at: q.q("down.at", 1000, "us"), duration: q.q("down.duration", 15000, "us"), available: false }]; i.ledger.push(...q.ledger);
  const m = createAsyncModel2(i); m.advanceTo(12000); const e = m.evidence(); expect(e.asynchronous.brokers[0]!.ready).toBeGreaterThan(10); expect(e.asynchronous.brokers[0]!.oldestReadyAgeUs).toBeGreaterThan(1000); asyncConservation(e); m.advanceTo(m.horizon); const final = m.evidence(); expect(final.asynchronous.brokers[0]!.acknowledged).toBe(24); expect(final.asynchronous.brokers[0]!.redelivered).toBeGreaterThan(0); asyncConservation(final);
});
test("lost/late acknowledgements create actual duplicate side effects; conditional object writes prevent repeated mutation", () => {
  const options = { count: 1, ackDelay: 3000, lease: 2000, processing: 100, maxAttempts: 3, horizon: 30000 };
  const plain = asyncRun(asyncFixture(options)), idem = asyncRun(asyncFixture({ ...options, idempotent: true }));
  expect(plain.asynchronous.brokers[0]!.redelivered).toBeGreaterThan(0); expect(plain.asynchronous.workers[0]!.effects).toBeGreaterThan(1); expect(idem.asynchronous.workers[0]!.effects).toBe(1); expect(idem.asynchronous.workers[0]!.deduplicated).toBeGreaterThan(0); expect(plain.asynchronous.objects[0]!.replacedObjects).toBeGreaterThan(idem.asynchronous.objects[0]!.replacedObjects); asyncConservation(plain); asyncConservation(idem);
});
test("poison messages consume actual attempts then move into a bounded DLQ", () => {
  const i = asyncFixture({ count: 4, interval: 500 }); workers(i)[0]!.poisonKeys = [JSON.stringify(["root", "load", JSON.stringify(["load", 0])])]; const e = asyncRun(i), b = e.asynchronous.brokers[0]!;
  expect(b.deadLettered).toBe(1); expect(b.dlq[0]!.message.attempts).toBe(3); expect(b.acknowledged).toBe(3); expect(e.asynchronous.workers[0]!.failed).toBe(3); asyncConservation(e);
});
test("object commit is atomic; conditional races, deletes and capacity act on real identities", () => {
  const config = store(asyncFixture()), q = quantities(); config.demands.put!.wait = q.q("put.wait", 100, "us"); const k = new EventKernel(10000), s = objectStore(config, k); let seq = 0;
  const send = (r: ObjectRequest) => { const w = invocation(String(seq++), r); s.accept(w, () => {}); return w; };
  send({ kind: "put", namespace: "n", key: "x", bytes: 1024, content: "old" }); k.advanceTo(200);
  send({ kind: "put", namespace: "n", key: "x", bytes: 104857600, content: "new" }); const before = send({ kind: "get", namespace: "n", key: "x" }); k.advanceTo(250); expect((before.message!.response as ObjectReply).object!.content).toBe("old"); k.advanceTo(500);
  const after = send({ kind: "get", namespace: "n", key: "x" }); k.advanceTo(550); expect((after.message!.response as ObjectReply).object!.bytes).toBe(104857600); expect(after.message!.bodyBytes!.response).toBe(104857600);
  const a = send({ kind: "put", namespace: "n", key: "only", bytes: 5, content: "a", ifAbsent: true }), b = send({ kind: "put", namespace: "n", key: "only", bytes: 6, content: "b", ifAbsent: true }); k.advanceTo(1000); expect([a, b].filter((w) => (w.message!.response as ObjectReply).ok)).toHaveLength(1);
  s.capacity(0); const full = send({ kind: "put", namespace: "n", key: "blocked", bytes: 1, content: "x" }); k.advanceTo(1200); expect((full.message!.response as ObjectReply).reason).toBe("object-capacity"); send({ kind: "delete", namespace: "n", key: "x" }); k.advanceTo(1500); expect(s.evidence().storedBytes).toBe(5);
});
test("publish confirmation, deduplication, visibility, credit and stale receipts preserve distinct identities", () => {
  const config = broker(asyncFixture()), k = new EventKernel(10000), q = quantities(); config.lease = q.q("direct.lease", 100, "us"); config.deduplicatePublishes = true; const b = deliveryQueue(config, k); let seq = 0, at = 0;
  const send = (r: QueueRequest) => { const w = invocation(String(seq++), r); b.accept(w, () => {}); k.advanceTo(at += 20); return w.message!.response as QueueReply; };
  const body = { key: "k", namespace: "n", objectKey: "x", bytes: 100 }; const p = send({ kind: "publish", logicalId: "m", body, delayUs: 0 }), retry = send({ kind: "publish", logicalId: "m", body, delayUs: 0 }); expect(retry.acceptedId).toBe(p.acceptedId); expect(retry.deduplicated).toBe(true);
  const first = send({ kind: "receive", consumer: "worker-0" }).delivery!; k.advanceTo(at = 200); const second = send({ kind: "receive", consumer: "worker-0" }).delivery!; expect(second.id).toBe(first.id); expect(second.receipt).not.toBe(first.receipt); expect(send({ kind: "ack", consumer: "worker-0", receipt: first.receipt }).reason).toBe("stale-receipt"); expect(send({ kind: "ack", consumer: "worker-0", receipt: second.receipt }).ok).toBe(true);
  expect(b.evidence().accepted).toBe(1); expect(b.evidence().acknowledged).toBe(1);
});
test("large object bodies consume real network bytes without allocating payload buffers", () => {
  const small = asyncRun(asyncFixture({ count: 1, objectBytes: 1024, bandwidth: 1000000, lease: 1000000, horizon: 1000000 })), large = asyncRun(asyncFixture({ count: 1, objectBytes: 65536, bandwidth: 1000000, lease: 1000000, horizon: 1000000 }));
  const bytes = (e: typeof small) => e.network.links.reduce((n, l) => n + l.transmittedBytes, 0); expect(bytes(large) - bytes(small)).toBeGreaterThan(120000); expect(large.asynchronous.objects[0]!.storedBytes).toBeGreaterThan(small.asynchronous.objects[0]!.storedBytes); asyncConservation(large);
});

test("crash between effect and acknowledgement causes real redelivery and later backlog drain", () => {
  const i = asyncFixture({ count: 1, processing: 100, ackDelay: 5000, lease: 10000, horizon: 40000 }), q = quantities();
  i.asyncInterventions.push({ id: "failure-window", kind: "consumer-state", target: "worker-0", available: false, at: q.q("window.at", 2000, "us"), duration: q.q("window.duration", 10000, "us") }); i.ledger.push(...q.ledger);
  const e = asyncRun(i), w = e.asynchronous.workers[0]!; expect(w.events.some((x) => x.kind === "side-effect-completed" && x.at < 2000)).toBe(true); expect(w.lostOnCrash).toBe(1); expect(w.effects).toBe(2); expect(e.asynchronous.brokers[0]!.acknowledged).toBe(1); expect(e.asynchronous.brokers[0]!.redelivered).toBe(1); asyncConservation(e);
});

test("object outage retains committed state, drives nack/redelivery, then permits real recovery", () => {
  const i = asyncFixture({ count: 8, interval: 500, maxAttempts: 20, horizon: 50000 }), q = quantities();
  i.asyncInterventions.push({ id: "object-read-down", kind: "object-access", target: "objects", reads: false, writes: true, at: q.q("readDown.at", 1000, "us"), duration: q.q("readDown.duration", 5000, "us") }); i.ledger.push(...q.ledger);
  const e = asyncRun(i); expect(e.asynchronous.workers[0]!.failed).toBeGreaterThan(0); expect(e.asynchronous.brokers[0]!.redelivered).toBeGreaterThan(0); expect(e.asynchronous.brokers[0]!.acknowledged).toBe(8); expect(e.asynchronous.objects[0]!.objects).toHaveLength(16); asyncConservation(e);
});

test("broker pause preserves messages while refusing commands; scheduled retention, credit and DLQ overflow are explicit", () => {
  const config = broker(asyncFixture()), q = quantities(); config.consumers[0]!.credit = q.q("one.credit", 1, "count"); config.maxAttempts = q.q("one.attempt", 1, "count"); config.dlqMessages = q.q("no.dlq", 0, "count"); config.retention = q.q("short.retention", 500, "us");
  const k = new EventKernel(10000), b = deliveryQueue(config, k); let at = 0, seq = 0;
  const send = (r: QueueRequest) => { const w = invocation(String(seq++), r); b.accept(w, () => {}); k.advanceTo(at += 20); return w.message!.response as QueueReply; };
  send({ kind: "publish", logicalId: "delayed", body: { key: "k", namespace: "n", objectKey: "x", bytes: 5 }, delayUs: 200 }); expect(b.evidence().scheduled).toBe(1); b.pause(true); expect(send({ kind: "receive", consumer: "worker-0" }).ok).toBe(false); expect(b.evidence().accepted).toBe(1); b.pause(false); k.advanceTo(at = 250);
  const d = send({ kind: "receive", consumer: "worker-0" }).delivery!; expect(send({ kind: "receive", consumer: "worker-0" }).reason).toBe("consumer-credit"); expect(send({ kind: "nack", consumer: "worker-0", receipt: d.receipt }).reason).toBe("missing-nack-policy"); expect(b.evidence().inFlight).toBe(1); send({ kind: "nack", consumer: "worker-0", receipt: d.receipt, action: "requeue" }); expect(b.evidence().discarded).toBe(1); expect(b.evidence().dlqOverflow).toBe(1);
  send({ kind: "publish", logicalId: "expires", body: { key: "k", namespace: "n", objectKey: "x", bytes: 5 }, delayUs: 1000 }); k.advanceTo(1000); expect(b.evidence().expired).toBe(1);
});

test("conditional consumer effects verify existing content before treating a collision as processed", () => {
  const i = asyncFixture({ count: 1, idempotent: true }); store(i).initial.push({ namespace: "results", key: JSON.stringify(["root", "load", JSON.stringify(["load", 0])]), generation: 1, bytes: (i.resources.find((r) => r.kind === "async-publisher") as PublisherConfig).messageBytes, content: "unrelated-object" });
  const e = asyncRun(i); expect(e.asynchronous.workers[0]!.deduplicated).toBe(0); expect(e.asynchronous.brokers[0]!.deadLettered).toBe(1); expect(e.asynchronous.objects[0]!.objects.find((o) => o.namespace === "results")!.content).toBe("unrelated-object"); asyncConservation(e);
});

test("lost publisher confirmation can create duplicate messages; opt-in publish dedup retains one", () => {
  const make = (dedup: boolean) => { const i = asyncFixture({ count: 1 }), q = quantities(); broker(i).deduplicatePublishes = dedup; (i.resources.find((r) => r.kind === "async-publisher") as PublisherConfig).publishAttempts = q.q("retry.attempts", 2, "count");
    const p = i.paths.find((p) => p.source === "publisher" && p.target === "broker")!; p.pool.responseTimeout = q.q("retry.response", 500, "us"); i.links.find((l) => l.id === p.response[0])!.propagation = q.q("confirm.propagation", 1000, "us"); i.ledger.push(...q.ledger); return i; };
  const plain = asyncRun(make(false)), dedup = asyncRun(make(true)); expect(plain.asynchronous.brokers[0]!.accepted).toBe(2); expect(dedup.asynchronous.brokers[0]!.accepted).toBe(1); expect(dedup.asynchronous.brokers[0]!.duplicatePublishes).toBe(1); expect(plain.counts.rejected).toBe(1); expect(plain.asynchronous.brokers[0]!.acknowledged).toBe(2); asyncConservation(plain); asyncConservation(dedup);
});

test("observations, sample timing and resource order do not alter async ownership or identities; Unknown fails closed", () => {
  const i = asyncFixture({ count: 8, workers: 2 }), baseline = asyncRun(i), q = quantities(); i.sampleInterval = q.q("other.samples", 137, "us"); i.ledger.push(...q.ledger); i.resources.reverse(); const m = createAsyncModel2(i); m.advanceTo(1234); const observed = m.evidence(); observed.asynchronous.objects[0]!.objects.length = 0; observed.asyncConfiguration.length = 0; m.advanceTo(m.horizon); expect(m.evidence().asynchronous).toEqual(baseline.asynchronous); expect(m.evidence().results).toEqual(baseline.results);
  const bad = asyncFixture(); workers(bad)[0]!.cpu = { kind: "unknown", unit: "cpu-us", reason: "unmeasured", provenance: ["unknown"] }; expect(() => createAsyncModel2(bad)).toThrow(); expect(resolveModel("2", { internal: true, workloadVersion: "m2f/1" }).workloadVersion).toBe("m2f/1"); expect(() => resolveModel("2")).toThrow("internal");
});

test("reasserting consumer availability does not invalidate live processing or change delivery identities", () => {
  const input = asyncFixture({ count: 8, processing: 1000 }), expected = asyncRun(input), q = quantities(); input.asyncInterventions.push({ id: "still-available", kind: "consumer-state", target: "worker-0", available: true, at: q.q("still.at", 1000, "us"), duration: q.q("still.duration", 2000, "us") }); input.ledger.push(...q.ledger);
  const actual = asyncRun(input); expect(actual.asynchronous).toEqual(expected.asynchronous); expect(actual.asynchronous.brokers[0]!.acknowledged).toBe(8); asyncConservation(actual);
});

test("3000 generated async cases conserve messages, deliveries, objects, CPU and callers", () => {
  for (let id = 0; id < 3000; id++) {
    const n = (purpose: string, max: number) => 1 + Math.floor(keyedUniform("m2f-sweep", "case", String(id), purpose) * max);
    const i = asyncFixture({ count: n("messages", 10), interval: n("publishGap", 300), workers: n("workers", 3), concurrency: n("concurrency", 3), prefetch: n("prefetch", 6), lease: n("lease", 5000), processing: n("cpu", 600), ackDelay: n("ackDelay", 2000), objectBytes: n("objectBytes", 4096), messageBytes: n("messageBytes", 512), resultBytes: n("resultBytes", 1024), maxAttempts: n("attempts", 5), idempotent: id % 2 === 0, horizon: 12000, timeout: n("deadline", 10000), raw: 20 }), q = quantities();
    const b = broker(i); b.capacityMessages = q.q("sweep.messageCapacity", n("messageCapacity", 8), "count"); b.capacityBytes = q.q("sweep.byteCapacity", n("byteCapacity", 3000), "bytes"); b.retention = q.q("sweep.retention", n("retention", 20000), "us"); b.deduplicatePublishes = id % 3 === 0; b.dlqMessages = q.q("sweep.dlqCapacity", n("dlqCapacity", 5) - 1, "count");
    store(i).capacity = q.q("sweep.objectCapacity", n("objectCapacity", 40000), "bytes");
    if (id % 7 === 0) workers(i)[0]!.poisonKeys = [JSON.stringify(["root", "load", JSON.stringify(["load", 0])])];
    if (id % 5 === 0) i.asyncInterventions.push({ id: "consumer", kind: "consumer-state", target: "worker-0", available: false, at: q.q("sweep.consumer.at", n("consumerAt", 2000), "us"), duration: q.q("sweep.consumer.duration", n("consumerDuration", 5000), "us") });
    if (id % 11 === 0) i.asyncInterventions.push({ id: "object", kind: "object-access", target: "objects", reads: false, writes: id % 2 === 0, at: q.q("sweep.object.at", 1500, "us"), duration: q.q("sweep.object.duration", n("objectDuration", 4000), "us") });
    if (id % 13 === 0) i.networkInterventions.push({ id: "broker-down", kind: "service-state", target: "broker", alive: false, ready: false, at: q.q("sweep.broker.at", 2000, "us"), duration: q.q("sweep.broker.duration", 2000, "us") });
    if (id % 17 === 0) for (const p of i.paths) p.pool.responseTimeout = q.q(`sweep.${p.id}.timeout`, n(`timeout.${p.id}`, 5000), "us");
    i.ledger.push(...q.ledger); const m = createAsyncModel2(i); m.advanceTo(2300); asyncConservation(m.evidence()); m.advanceTo(m.horizon); const e = m.evidence(); asyncConservation(e); if (id % 100 === 0) expect(asyncRun(i, 113)).toEqual(e);
  }
}, 180000);
