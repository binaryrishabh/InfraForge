import { expect, test } from "bun:test";
import { asyncSettingsError } from "@infraforge/domain/resource";
import { capacityDesign, capacitySetup } from "./queueCapacity.fixture";
import { requireKnown } from "../src/reality/quantity";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { design, prepare } from "./asyncCanvas.fixture";
import { deliveryQueue } from "../src/model2/async/broker";
import { EventKernel } from "../src/model2/time";
import type { QueueRequest, QueueReply } from "../src/model2/async/contracts";
import type { Invocation } from "../src/model2/workload/contracts";
import { ASYNC_LIMITS } from "../src/model2/async/policy";

test("learner can author queue message capacity within the existing engine budget", () => {
  const d = capacityDesign("normal", 3), queue = d.resources.find(r => r.id === "queue")!;
  expect(asyncSettingsError(queue.type, queue.asyncQueue)).toBeUndefined();
});

test("adapter binds authored queue capacity instead of freezing 1000 times modeled cores", () => {
  const f = capacitySetup("normal", 3), broker = f.compiled.input.resources.find(r => r.kind === "delivery-queue")!;
  if (broker.kind !== "delivery-queue") throw Error("Missing queue");
  expect(requireKnown(broker.capacityMessages, "count")).toBe(3);
});

test("capacity intent is optional, bounded, strictly owned and never changes byte capacity", () => {
  expect(ASYNC_LIMITS.messages).toBe(100000);
  for (const n of [1, 100000]) {
    const d = capacityDesign("normal", n), a = prepare(d), old = prepare(capacityDesign());
    const broker = a.compiled.input.resources.find(r => r.kind === "delivery-queue")!;
    const baseline = old.compiled.input.resources.find(r => r.kind === "delivery-queue")!;
    if (broker.kind !== "delivery-queue" || baseline.kind !== "delivery-queue") throw Error("Missing queue");
    expect(broker.capacityBytes).toEqual(baseline.capacityBytes);
    expect(a.compiled.semantic.numericOrigins.some(r => r.origin === "user-authored" && r.sources.includes("saved-design:queue.asyncQueue.capacityMessages"))).toBe(true);
  }
  for (const n of [0, -1, 100001, 1.5, NaN, Infinity, "2", null]) {
    const d = capacityDesign(); Object.assign(d.resources.find(r => r.id === "queue")!.asyncQueue!, { capacityMessages: n });
    expect(contractFromDesign(d)).toHaveProperty("refused");
  }
  const wrong = capacityDesign("normal", 3); wrong.resources.find(r => r.id === "queue")!.type = "Virtual Machine";
  expect(contractFromDesign(wrong)).toHaveProperty("refused");
});

test("captured capacity profile refuses missing, mismatched and duplicate selections", () => {
  const d = capacityDesign("normal", 3), profiles = currentAdapterProfiles(d.resources);
  expect(profiles).toEqual(["queue-capacity/1"]);
  for (const adapterProfiles of [[], ["vm-execution/1"], [...profiles, ...profiles]] as const) {
    expect(contractFromDesign(d, { adapterProfiles })).toHaveProperty("refused");
  }
  expect(contractFromDesign(capacityDesign(), { adapterProfiles: profiles })).toHaveProperty("refused");
  expect(currentAdapterProfiles(capacityDesign().resources)).toEqual([]);
});

test("disabled queues retain capacity intent for re-enable and keep their existing modeled limit", () => {
  const saved = design(false), old = prepare(saved);
  saved.resources.find(r => r.id === "queue")!.asyncQueue = { enabled: false, capacityMessages: 3 };
  const disabled = prepare(saved), broker = disabled.compiled.input.resources.find(r => r.kind === "delivery-queue")!;
  if (broker.kind !== "delivery-queue") throw Error("Missing queue");
  expect(broker).toEqual(old.compiled.input.resources.find(r => r.kind === "delivery-queue"));
  expect(saved.resources.find(r => r.id === "queue")!.asyncQueue!.capacityMessages).toBe(3);
});

test("compiler rejects capacity config and version tampering against saved intent", () => {
  const d = capacityDesign("normal", 3), a = prepare(d), broker = a.contract.nodes.queue!.resources[0]!.config;
  if (broker.kind !== "delivery-queue" || broker.capacityMessages.kind !== "known") throw Error("Missing queue");
  broker.capacityMessages.value = 4;
  const ledger = a.contract.ledger.find(e => e.id === "queue.asyncQueue.capacityMessages")!;
  if (ledger.quantity.kind !== "known") throw Error("Missing capacity origin");
  ledger.quantity.value = 4;
  expect(compileProduct(d, a.contract).ok).toBe(false);
  const valid = prepare(d).contract; valid.version = valid.version.replace("/queue-capacity/1", "");
  expect(compileProduct(d, valid).ok).toBe(false);
  expect(compileProduct(capacityDesign(), prepare(d).contract).ok).toBe(false);
});

test("small capacity refuses real publishes, large capacity accepts the same load and acks reopen slots", () => {
  const small = capacitySetup("normal", 3), large = capacitySetup("normal", 100);
  let acceptedAfterFull = false, maxOwned = 0;
  for (let second = 1; second <= 70; second++) {
    small.runtime.advanceTo(second * 1000000); large.runtime.advanceTo(second * 1000000);
    const q = small.runtime.evidence().asynchronous.brokers[0]!;
    maxOwned = Math.max(maxOwned, q.messages.length);
    expect(q.ready + q.inFlight + q.scheduled).toBe(q.messages.length);
    expect(q.messages.length).toBeLessThanOrEqual(3);
    expect(q.liveBytes).toBe(q.messages.reduce((n, m) => n + m.body.bytes, 0));
    if (q.rejectedPublishes > 0 && q.accepted > 3 && q.acknowledged > 0) acceptedAfterFull = true;
  }
  const a = small.runtime.evidence().asynchronous.brokers[0]!, b = large.runtime.evidence().asynchronous.brokers[0]!;
  expect(maxOwned).toBe(3); expect(acceptedAfterFull).toBe(true);
  expect(a.rejectedPublishes).toBeGreaterThan(0); expect(b.rejectedPublishes).toBe(0);
  expect(b.accepted).toBe(81); expect(b.accepted).toBeGreaterThan(a.accepted);
  expect(a.messages).toHaveLength(0); expect(a.acknowledged).toBe(a.accepted);
  console.info("queue-capacity-pressure", JSON.stringify({ small: { accepted: a.accepted, rejectedPublishes: a.rejectedPublishes, acknowledged: a.acknowledged, maxOwned }, large: { accepted: b.accepted, rejectedPublishes: b.rejectedPublishes } }));
});

test("outage fills a small queue and recovery drains with the existing visibility lease", () => {
  const small = capacitySetup("outage", 3), large = capacitySetup("outage", 100);
  for (const f of [small, large]) f.runtime.advanceTo(6_000_000);
  const a = small.runtime.evidence(), b = large.runtime.evidence();
  expect(a.asynchronous.workers[0]!.available).toBe(false);
  expect(a.asynchronous.brokers[0]!).toMatchObject({ ready: 2, inFlight: 1 });
  expect(a.asynchronous.brokers[0]!.rejectedPublishes).toBeGreaterThan(0);
  expect(b.asynchronous.brokers[0]!.rejectedPublishes).toBe(0);
  expect(b.asynchronous.brokers[0]!.ready).toBeGreaterThan(2);
  expect(a.asynchronous.brokers[0]!.oldestReadyAgeUs).toBeGreaterThan(0);
  for (const f of [small, large]) {
    f.runtime.advanceTo(70_000_000); const e = f.runtime.evidence(), q = e.asynchronous.brokers[0]!;
    expect(e.asynchronous.workers[0]!.available).toBe(true);
    expect(q.leaseExpired).toBe(1); expect(q.redelivered).toBe(1);
    expect(q.messages).toHaveLength(0); expect(q.acknowledged).toBe(q.accepted);
  }
});

for (const mode of ["normal", "poison", "outage", "visibility", "parallel"] as const) test(`capacity preserves ${mode} semantics and one-shot equals stepped`, () => {
  const stepped = capacitySetup(mode, 100), once = capacitySetup(mode, 100), old = capacitySetup(mode);
  for (let second = 1; second <= 70; second++) {
    stepped.runtime.advanceTo(second * 1000000);
    const e = stepped.runtime.evidence(), q = e.asynchronous.brokers[0]!, w = e.asynchronous.workers[0]!;
    expect(q.ready + q.inFlight + q.scheduled).toBeLessThanOrEqual(100);
    expect(w.active).toBeLessThanOrEqual(mode === "parallel" ? 2 : 1);
    expect(w.creditOwnedLocally).toBeLessThanOrEqual(mode === "parallel" ? 4 : 1);
  }
  once.runtime.advanceTo(70_000_000); old.runtime.advanceTo(70_000_000);
  expect(stepped.runtime.evidence()).toEqual(once.runtime.evidence());
  expect(once.runtime.evidence().asynchronous).toEqual(old.runtime.evidence().asynchronous);
  const e = once.runtime.evidence(), q = e.asynchronous.brokers[0]!;
  if (mode === "poison") {
    expect(q.deadLettered).toBe(2); expect(q.dlqOverflow).toBe(79);
    expect(q.dlq.every(d => d.reason === "attempt-limit" && d.message.attempts === 3)).toBe(true);
    expect(e.asynchronous.workers[0]!.effects).toBe(0);
  }
  if (mode === "visibility") expect(q.redelivered).toBeGreaterThan(0);
  if (mode === "parallel") expect(q.consumers[0]!.credit).toBe(4);
});

function directQueue(capacityMessages = 3, retentionSeconds = 300, deadLetterCapacity = 1) {
  const d = capacityDesign("normal", capacityMessages), settings = d.resources.find(r => r.id === "queue")!.asyncQueue!;
  Object.assign(settings, { retentionSeconds, deadLetterCapacity });
  const broker = prepare(d).compiled.input.resources.find(r => r.kind === "delivery-queue")!;
  if (broker.kind !== "delivery-queue") throw Error("Missing queue");
  const kernel = new EventKernel(400_000_000), queue = deliveryQueue(broker, kernel);
  let sequence = 0;
  const send = (request: QueueRequest) => {
    const callId = `command-${sequence++}`;
    const work: Invocation = { rootId: callId, callId, operation: "light", attempt: 0, offeredAt: kernel.now, message: { request } };
    queue.accept(work, () => {}); kernel.advanceTo(kernel.now + 1000);
    return work.message!.response as QueueReply;
  };
  const publish = (logicalId: string, delayUs = 0) => send({ kind: "publish", logicalId, delayUs, body: { key: logicalId, namespace: "uploads", objectKey: logicalId, bytes: 100 } });
  return { queue, kernel, send, publish };
}

test("ready, scheduled and in-flight ownership share capacity; ack frees it for a later publish", () => {
  const f = directQueue();
  expect(f.publish("ready").ok).toBe(true); expect(f.publish("leased").ok).toBe(true); expect(f.publish("scheduled", 10_000_000).ok).toBe(true);
  const delivery = f.send({ kind: "receive", consumer: "worker" }).delivery!;
  expect(f.queue.evidence()).toMatchObject({ ready: 1, inFlight: 1, scheduled: 1, liveBytes: 300 });
  expect(f.publish("full")).toEqual({ ok: false, reason: "broker-capacity" });
  expect(f.send({ kind: "ack", consumer: "worker", receipt: delivery.receipt }).ok).toBe(true);
  expect(f.publish("later").ok).toBe(true);
  expect(f.queue.evidence()).toMatchObject({ accepted: 4, rejectedPublishes: 1, acknowledged: 1, liveBytes: 300 });
});

test("retention releases scheduled live ownership and permits a new publish", () => {
  const f = directQueue(1, 1);
  expect(f.publish("expiring", 2_000_000).ok).toBe(true);
  expect(f.publish("full").reason).toBe("broker-capacity");
  f.kernel.advanceTo(1_100_000);
  expect(f.queue.evidence()).toMatchObject({ expired: 1, ready: 0, inFlight: 0, scheduled: 0, liveBytes: 0 });
  expect(f.publish("after-expiry").ok).toBe(true);
});

test("dead letters and DLQ overflow each release live capacity into separate existing accounting", () => {
  const f = directQueue(1);
  for (const id of ["dead-letter", "overflow"]) {
    expect(f.publish(id).ok).toBe(true);
    expect(f.publish(`${id}-full`).reason).toBe("broker-capacity");
    const delivery = f.send({ kind: "receive", consumer: "worker" }).delivery!;
    expect(f.send({ kind: "nack", consumer: "worker", receipt: delivery.receipt, action: "dead-letter" }).ok).toBe(true);
    expect(f.queue.evidence().liveBytes).toBe(0);
  }
  expect(f.queue.evidence()).toMatchObject({ deadLettered: 1, dlqOverflow: 1, discarded: 1, dlqBytes: 100, ready: 0, inFlight: 0, scheduled: 0 });
  expect(f.publish("after-overflow").ok).toBe(true);
  expect(f.queue.evidence().dlq).toHaveLength(1);
  expect(f.queue.evidence().messages).toHaveLength(1);
});
