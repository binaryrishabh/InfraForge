import { expect, test } from "bun:test";
import { deliveryQueue } from "../src/model2/async/broker";
import { createAsyncModel2 } from "../src/model2/async/run";
import type { BrokerConfig, QueueReply, QueueRequest } from "../src/model2/async/contracts";
import type { Invocation } from "../src/model2/workload/contracts";
import { EventKernel } from "../src/model2/time";
import { asyncFixture } from "./asyncFixture";
import { quantities } from "./workloadFixture";

function queue() {
  const config = asyncFixture().resources.find(r => r.kind === "delivery-queue") as BrokerConfig;
  const kernel = new EventKernel(10000), broker = deliveryQueue(config, kernel); let sequence = 0;
  const begin = (request: QueueRequest) => {
    const id = `command-${sequence++}`, work: Invocation = { rootId: id, callId: id, operation: "light", offeredAt: kernel.now, attempt: 0, message: { request } };
    broker.accept(work, () => {}); return () => work.message!.response as QueueReply;
  };
  const send = (request: QueueRequest) => { const reply = begin(request); kernel.advanceTo(kernel.now + 20); return reply(); };
  send({ kind: "publish", logicalId: "original", delayUs: 0, body: { key: "original", namespace: "uploads", objectKey: "original", bytes: 32 } });
  const first = send({ kind: "receive", consumer: "worker-0" }).delivery!;
  return { broker, kernel, begin, first };
}

test("regression: an acknowledgement applied exactly at lease expiry is stale; one microsecond earlier succeeds", () => {
  for (const early of [false, true]) {
    const f = queue(); f.kernel.advanceTo(f.first.leaseUntil - 10 - Number(early));
    const reply = f.begin({ kind: "ack", consumer: "worker-0", receipt: f.first.receipt });
    f.kernel.advanceTo(f.first.leaseUntil);
    expect(reply()).toEqual(early ? { ok: true } : { ok: false, reason: "stale-receipt" });
    expect(f.broker.evidence()).toMatchObject({ accepted: 1, acknowledged: Number(early), leaseExpired: Number(!early), ready: Number(!early), staleReceipts: Number(!early) });
  }
});

test("regression: receive at lease expiry redelivers the same original with a new receipt", () => {
  const f = queue(); f.kernel.advanceTo(f.first.leaseUntil - 10);
  const reply = f.begin({ kind: "receive", consumer: "worker-0" }); f.kernel.advanceTo(f.first.leaseUntil);
  expect(reply().delivery).toMatchObject({ id: f.first.id, logicalId: f.first.logicalId, publishAttempt: f.first.publishAttempt, deliveredAt: f.first.leaseUntil, attempt: 2 });
  expect(reply().delivery!.receipt).not.toBe(f.first.receipt);
  expect(f.broker.evidence()).toMatchObject({ accepted: 1, deliveries: 2, redelivered: 1, leaseExpired: 1, acknowledged: 0 });
});

test("regression: a failed consumer loses only its local delivery while another consumer continues", () => {
  const base = asyncFixture({ count: 2, interval: 500, workers: 2, prefetch: 1, processing: 100, ackDelay: 5000, lease: 10000, horizon: 40000 });
  const failed = structuredClone(base), q = quantities();
  failed.asyncInterventions.push({ id: "one-worker", kind: "consumer-state", target: "worker-0", available: false, at: q.q("crash.at", 2000, "us"), duration: q.q("crash.duration", 10000, "us") });
  failed.ledger.push(...q.ledger);
  const healthy = createAsyncModel2(base), crash = createAsyncModel2(failed);
  crash.advanceTo(8000); const during = crash.evidence().asynchronous;
  expect(during.workers.find(w => w.id === "worker-0")!).toMatchObject({ available: false, lostOnCrash: 1, effects: 1, acknowledged: 0 });
  expect(during.workers.find(w => w.id === "worker-1")!).toMatchObject({ available: true, effects: 1, acknowledged: 1 });
  for (const f of [healthy, crash]) f.advanceTo(f.horizon);
  const e = crash.evidence().asynchronous;
  expect(e.brokers[0]!).toMatchObject({ accepted: 2, deliveries: 3, redelivered: 1, acknowledged: 2 });
  expect(e.workers.every(w => w.available)).toBe(true);
  expect(e.workers.reduce((n, w) => n + w.effects, 0)).toBe(3);
  expect(healthy.evidence().asynchronous.workers.reduce((n, w) => n + w.effects, 0)).toBe(2);
});
