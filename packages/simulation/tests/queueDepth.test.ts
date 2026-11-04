import { expect, test } from "bun:test";
import { depthSetup } from "./queueDepth.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { design, prepare } from "./asyncCanvas.fixture";

test("saved acknowledgement delay drives real lease expiry, duplicate objects and dead letters", () => {
  const immediate = depthSetup(0), delayed = depthSetup(2000);
  for (const f of [immediate, delayed]) f.runtime.advanceTo(15_000_000);
  const a = immediate.runtime.evidence().asynchronous, b = delayed.runtime.evidence().asynchronous;
  expect(a.brokers[0]!).toMatchObject({ accepted: 1, deliveries: 1, acknowledged: 1, deadLettered: 0 });
  expect(b.brokers[0]!).toMatchObject({ accepted: 1, deliveries: 3, redelivered: 2, leaseExpired: 3, acknowledged: 0, deadLettered: 1, staleReceipts: 3 });
  expect(a.workers[0]!).toMatchObject({ effects: 1, processed: 1, acknowledged: 1 });
  expect(b.workers[0]!).toMatchObject({ effects: 3, processed: 3, acknowledged: 0, ackFailed: 3 });
  expect(a.objects[0]!.replacedObjects).toBe(0); expect(b.objects[0]!.replacedObjects).toBe(2);
  expect(b.brokers[0]!.dlq[0]!).toMatchObject({ reason: "attempt-limit", message: { attempts: 3 } });
  console.info("queue-depth-delay", JSON.stringify([a, b].map(e => ({ originals: e.brokers[0]!.accepted, attempts: e.brokers[0]!.deliveries, effects: e.workers[0]!.effects, duplicateEffects: e.objects[0]!.replacedObjects, deadLetters: e.brokers[0]!.deadLettered, acknowledged: e.brokers[0]!.acknowledged }))));
});

test("longer visibility lets the same delayed acknowledgement complete", () => {
  const short = depthSetup(2000, 1), long = depthSetup(2000, 5);
  for (const f of [short, long]) f.runtime.advanceTo(15_000_000);
  expect(short.runtime.evidence().asynchronous.brokers[0]!.deliveries).toBe(3);
  expect(long.runtime.evidence().asynchronous.brokers[0]!).toMatchObject({ accepted: 1, deliveries: 1, acknowledged: 1, leaseExpired: 0, deadLettered: 0 });
});

test("worker acceptance and a committed result do not acknowledge the message", () => {
  const f = depthSetup(2000, 5); f.runtime.advanceTo(500_000);
  expect(f.runtime.evidence().asynchronous.brokers[0]!).toMatchObject({ accepted: 1, inFlight: 1, acknowledged: 0 });
  expect(f.runtime.evidence().asynchronous.workers[0]!).toMatchObject({ effects: 1, processed: 1, acknowledged: 0, creditOwnedLocally: 1 });
});

test("crash after the result retains broker ownership and waits for lease expiry after recovery", () => {
  const healthy = depthSetup(2000, 5), crash = depthSetup(2000, 5, true);
  crash.runtime.advanceTo(3_000_000);
  let e = crash.runtime.evidence().asynchronous;
  expect(e.workers[0]!).toMatchObject({ available: true, lostOnCrash: 1, effects: 1, acknowledged: 0 });
  expect(e.brokers[0]!).toMatchObject({ accepted: 1, inFlight: 1, deliveries: 1, acknowledged: 0 });
  for (const f of [healthy, crash]) f.runtime.advanceTo(15_000_000);
  e = crash.runtime.evidence().asynchronous;
  expect(e.brokers[0]!).toMatchObject({ accepted: 1, deliveries: 2, redelivered: 1, leaseExpired: 1, acknowledged: 1, deadLettered: 0 });
  expect(e.workers[0]!).toMatchObject({ effects: 2, processed: 2, acknowledged: 1, lostOnCrash: 1 });
  expect(e.objects[0]!.replacedObjects).toBe(1);
  expect(healthy.runtime.evidence().asynchronous.workers[0]!.effects).toBe(1);
  const received = e.brokers[0]!.events.filter(r => r.kind === "delivery");
  expect(received[1]!.at - received[0]!.at).toBeGreaterThanOrEqual(5_000_000);
});

test("delay intent requires its captured profile and compiler binding, including explicit zero", () => {
  for (const delay of [0, 2000]) {
    const f = depthSetup(delay), profiles = currentAdapterProfiles(f.saved.resources);
    expect(profiles).toContain("queue-ack-delay/1");
    for (const adapterProfiles of [[], ["queue-capacity/1"], [...profiles, ...profiles]] as const) expect(contractFromDesign(f.saved, { adapterProfiles })).toHaveProperty("refused");
    const altered = structuredClone(f.contract), worker = altered.nodes.worker!.resources[0]!.config;
    if (worker.kind !== "async-worker" || worker.ackDelay.kind !== "known") throw Error("Missing worker delay");
    worker.ackDelay.value++;
    expect(compileProduct(f.saved, altered).ok).toBe(false);
    const version = structuredClone(f.contract); version.version = version.version.replace("/queue-ack-delay/1", "");
    expect(compileProduct(f.saved, version).ok).toBe(false);
  }
  const old = depthSetup(); expect(currentAdapterProfiles(old.saved.resources)).not.toContain("queue-ack-delay/1");
  const worker = old.contract.nodes.worker!.resources[0]!.config;
  if (worker.kind !== "async-worker" || worker.ackDelay.kind !== "known") throw Error("Missing delay");
  worker.ackDelay.value = 1000; expect(compileProduct(old.saved, old.contract).ok).toBe(false);
});

test("disabled worker delay is saved for re-enable without producing a consumer", () => {
  const saved = design(false);
  saved.resources.find(r => r.id === "app")!.asyncWorker = { enabled: false, acknowledgementDelayMs: 2000 };
  const f = prepare(saved);
  expect(currentAdapterProfiles(saved.resources)).toEqual(["queue-ack-delay/1"]);
  expect(f.compiled.input.resources.some(r => r.kind === "async-worker")).toBe(false);
  expect(saved.resources.find(r => r.id === "app")!.asyncWorker!.acknowledgementDelayMs).toBe(2000);
});

test("delay runs are deterministic across stepping and bounded local credit", () => {
  const stepped = depthSetup(2000), once = depthSetup(2000);
  for (let second = 1; second <= 15; second++) {
    stepped.runtime.advanceTo(second * 1_000_000);
    const e = stepped.runtime.evidence().asynchronous;
    expect(e.workers[0]!.creditOwnedLocally).toBeLessThanOrEqual(1);
    expect(e.brokers[0]!.messages.length).toBeLessThanOrEqual(3);
    expect(e.brokers[0]!.events.length).toBeLessThanOrEqual(1000);
  }
  once.runtime.advanceTo(15_000_000); expect(stepped.runtime.evidence()).toEqual(once.runtime.evidence());
});
