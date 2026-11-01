import { expect, test } from "bun:test";
import { asyncSettingsError } from "@infraforge/domain/resource";
import { capacityDesign } from "./queueCapacity.fixture";
import { prepare } from "./asyncCanvas.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { idempotencySetup } from "./queueIdempotency.fixture";
import { createProductModel2 } from "../src/model2/product/run";

test("learners can select idempotent result writes on a worker", () => {
  const saved = capacityDesign(), worker = saved.resources.find(r => r.id === "worker")!;
  Object.assign(worker.asyncWorker!, { idempotentResults: true });
  expect(asyncSettingsError(worker.type, undefined, worker.asyncWorker)).toBeUndefined();
});

test("absent and explicit Off preserve the entire legacy contract, input and evidence", () => {
  const old = idempotencySetup(), off = idempotencySetup(false);
  expect(old.contract).toEqual(off.contract); expect(old.compiled).toEqual(off.compiled);
  for (const f of [old, off]) f.runtime.advanceTo(70_000_000);
  expect(old.runtime.evidence()).toEqual(off.runtime.evidence());
  expect(currentAdapterProfiles(off.saved.resources)).toEqual([]);
});

test("explicit On requires its captured profile, matching worker config and Object Storage ownership", () => {
  const f = idempotencySetup(true), profiles = currentAdapterProfiles(f.saved.resources);
  expect(profiles).toEqual(["queue-idempotency/1"]);
  for (const adapterProfiles of [[], ["queue-capacity/1"], [...profiles, ...profiles]] as const) expect(contractFromDesign(f.saved, { adapterProfiles })).toHaveProperty("refused");
  expect(contractFromDesign(idempotencySetup().saved, { adapterProfiles: profiles })).toHaveProperty("refused");
  const version = structuredClone(f.contract); version.version = version.version.replace("/queue-idempotency/1", "");
  expect(compileProduct(f.saved, version).ok).toBe(false);
  for (const enabled of [undefined, false, true]) {
    const a = idempotencySetup(enabled), worker = a.contract.nodes.worker!.resources.find(r => r.config.kind === "async-worker")!.config;
    if (worker.kind !== "async-worker") throw Error("Missing worker");
    worker.idempotency = enabled ? "none" : "object-if-absent";
    expect(compileProduct(a.saved, a.contract).ok).toBe(false);
  }
  const db = structuredClone(f.contract), worker = db.nodes.worker!.resources[0]!.config;
  if (worker.kind !== "async-worker") throw Error("Missing worker");
  worker.database = "$database";
  expect(compileProduct(f.saved, db).ok).toBe(false);
});

test("real lease expiry redelivers with Off and On while only On deduplicates the result effect", () => {
  const off = idempotencySetup(false), on = idempotencySetup(true);
  for (const f of [off, on]) f.runtime.advanceTo(70_000_000);
  const a = off.runtime.evidence().asynchronous, b = on.runtime.evidence().asynchronous;
  for (const e of [a, b]) {
    expect(e.brokers[0]!).toMatchObject({ accepted: 1, deliveries: 3, redelivered: 2, leaseExpired: 3, staleReceipts: 3, acknowledged: 0, deadLettered: 1 });
    expect(e.workers[0]!).toMatchObject({ deliveries: 3, processed: 3, ackFailed: 3, acknowledged: 0 });
    const received = e.workers[0]!.events.filter(r => r.kind === "received");
    expect(new Set(received.map(r => r.message)).size).toBe(1);
    expect(new Set(received.map(r => r.receipt)).size).toBe(3);
    const deliveries = e.brokers[0]!.events.filter(r => r.kind === "delivery");
    const expiries = e.brokers[0]!.events.filter(r => r.reason === "lease-expired" || r.reason === "attempt-limit");
    expect(expiries.map((r, i) => r.at - deliveries[i]!.at)).toEqual([1_000_000, 1_000_000, 1_000_000]);
  }
  expect(a.workers[0]!).toMatchObject({ effects: 3, deduplicated: 0 });
  expect(b.workers[0]!).toMatchObject({ effects: 1, deduplicated: 2 });
  expect(a.objects[0]!).toMatchObject({ replacedObjects: 2, heads: 0, committedPuts: 4 });
  expect(b.objects[0]!).toMatchObject({ replacedObjects: 0, heads: 2, committedPuts: 2 });
  expect(b.objects[0]!.service.reasons["precondition-failed"]).toBe(2);
  expect(b.objects[0]!.objects.find(r => r.namespace === "results")).toMatchObject({ content: '["root","product-workload","arrival-0"]', bytes: 1024 });
  console.info("idempotent-result-proof", JSON.stringify({ deliveries: 3, redeliveries: 2, staleReceipts: 3, offEffects: a.workers[0]!.effects, onEffects: b.workers[0]!.effects, deduplicated: b.workers[0]!.deduplicated }));
});

test("visibility and maximum deliveries retain control over lease expiry and attempts", () => {
  for (const enabled of [false, true]) {
    for (const max of [1, 2, 3]) {
      const f = idempotencySetup(enabled, "visibility", undefined, true, max); f.runtime.advanceTo(70_000_000);
      const e = f.runtime.evidence().asynchronous;
      expect(e.brokers[0]!).toMatchObject({ deliveries: max, redelivered: max - 1, leaseExpired: max, deadLettered: 1 });
      expect(e.brokers[0]!.dlq[0]!.message.attempts).toBe(max);
      expect(e.workers[0]!.effects).toBe(enabled ? 1 : max);
    }
    const long = idempotencySetup(enabled, "visibility", undefined, true, 3, 30); long.runtime.advanceTo(70_000_000);
    expect(long.runtime.evidence().asynchronous.brokers[0]!).toMatchObject({ deliveries: 1, redelivered: 0, leaseExpired: 0, acknowledged: 1 });
  }
});

for (const mode of ["normal", "poison", "outage", "visibility", "parallel"] as const) test(`idempotent writes compose with ${mode}, capacity and stepped execution`, () => {
  const stepped = idempotencySetup(true, mode, 3, false), once = idempotencySetup(true, mode, 3, false), off = idempotencySetup(false, mode, 3, false);
  let peakActive = 0;
  for (let second = 1; second <= 70; second++) {
    stepped.runtime.advanceTo(second * 1_000_000);
    const e = stepped.runtime.evidence().asynchronous;
    peakActive = Math.max(peakActive, e.workers[0]!.active);
    expect(e.brokers[0]!.messages.length).toBeLessThanOrEqual(3);
    expect(e.workers[0]!.active).toBeLessThanOrEqual(mode === "parallel" ? 2 : 1);
    expect(e.workers[0]!.creditOwnedLocally).toBeLessThanOrEqual(mode === "parallel" ? 4 : 1);
    if (mode === "outage" && second === 6) expect(e.workers[0]!.available).toBe(false);
  }
  once.runtime.advanceTo(70_000_000); off.runtime.advanceTo(70_000_000);
  expect(once.runtime.evidence()).toEqual(stepped.runtime.evidence());
  const a = once.runtime.evidence().asynchronous, b = off.runtime.evidence().asynchronous;
  if (mode === "parallel") expect(a.brokers[0]!.rejectedPublishes).toBe(0);
  else expect(a.brokers[0]!.rejectedPublishes).toBeGreaterThan(0);
  for (const key of ["accepted", "deliveries", "redelivered", "leaseExpired", "acknowledged", "deadLettered", "dlqOverflow", "staleReceipts", "nacked"] as const) expect(a.brokers[0]![key]).toBe(b.brokers[0]![key]);
  if (mode === "poison") {
    expect(a.workers[0]!).toMatchObject({ effects: 0, deduplicated: 0, processed: 0 });
    expect(a.workers[0]!.failed).toBe(a.brokers[0]!.accepted * 3);
    expect(a.brokers[0]!.dlq.every(r => r.message.attempts === 3 && r.reason === "attempt-limit")).toBe(true);
    expect(a.brokers[0]!.leaseExpired).toBe(0);
  }
  if (mode === "outage") {
    expect(a.workers[0]!.available).toBe(true);
    expect(a.brokers[0]!).toMatchObject({ leaseExpired: 1, redelivered: 1 });
    expect(a.brokers[0]!.acknowledged).toBe(a.brokers[0]!.accepted);
  }
  if (mode === "parallel") { expect(a.brokers[0]!.consumers[0]!.credit).toBe(4); expect(peakActive).toBe(2); }
});

for (const conflict of ["none", "content", "size"] as const) test(`existing result ${conflict} is checked by the real conditional-write path`, () => {
  const f = idempotencySetup(true, "normal"), store = f.contract.nodes.store!.resources[0]!.config, worker = f.contract.nodes.worker!.resources[0]!.config;
  const publisher = f.contract.nodes.app!.resources.find(r => r.config.kind === "async-publisher")!.config;
  if (store.kind !== "object-store" || worker.kind !== "async-worker" || publisher.kind !== "async-publisher") throw Error("Missing result pipeline");
  const key = '["root","product-workload","arrival-0"]';
  store.initial.push({ namespace: "results", key, content: conflict === "content" ? "unrelated-result" : key, generation: 2, bytes: conflict === "size" ? publisher.messageBytes : worker.resultBytes });
  const compiled = compileProduct(f.saved, f.contract); if (!compiled.ok) throw Error(JSON.stringify(compiled));
  const runtime = createProductModel2(compiled.value); runtime.advanceTo(70_000_000);
  const e = runtime.evidence().asynchronous;
  expect(e.workers[0]!.effects).toBe(0);
  expect(e.objects[0]!.service.reasons["precondition-failed"]).toBe(conflict === "none" ? 1 : 3);
  expect(e.objects[0]!.objects.find(r => r.namespace === "results")!.generation).toBe(2);
  if (conflict === "none") {
    expect(e.workers[0]!).toMatchObject({ deduplicated: 1, processed: 1, failed: 0 });
    expect(e.brokers[0]!.acknowledged).toBe(1);
  } else {
    expect(e.workers[0]!).toMatchObject({ deduplicated: 0, processed: 0, failed: 3 });
    expect(e.brokers[0]!).toMatchObject({ acknowledged: 0, deadLettered: 1 });
  }
});

test("adapter binds explicit idempotent result intent to the existing conditional write policy", () => {
  const saved = capacityDesign();
  Object.assign(saved.resources.find(r => r.id === "worker")!.asyncWorker!, { idempotentResults: true });
  expect(contractFromDesign(saved)).not.toHaveProperty("refused");
  const worker = prepare(saved).compiled.input.resources.find(r => r.kind === "async-worker")!;
  expect(worker).toHaveProperty("idempotency", "object-if-absent");
});
