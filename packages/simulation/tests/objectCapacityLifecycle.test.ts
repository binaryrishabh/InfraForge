import { expect, test } from "bun:test";
import { objectDesign, objectSetup } from "./objectCapacity.fixture";
import { prepare } from "./asyncCanvas.fixture";
import { quantities } from "./workloadFixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import type { ProductContract } from "../src/model2/product/contracts";
import type { ObjectReply } from "../src/model2/async/contracts";
import { withTimeline } from "../src/model2/product/timeline";
import { withRunLength } from "../src/model2/product/runContract";

function compile(f: ReturnType<typeof objectSetup>, contract = f.contract) {
  const c = compileProduct(f.saved, contract); if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  return createProductModel2(c.value);
}
function command(contract: ProductContract, id: string, at: number, request: unknown, target = "$store") {
  const q = quantities();
  const upload = request as { kind: string; bytes?: number };
  contract.commands.push({ id, source: "$app", target, at: q.q(`${id}.at`, at, "us"), operation: "read", request, bodyBytes: q.q(`${id}.body`, upload.kind === "upload" ? upload.bytes! : 0, "bytes"), provenance: "Controlled object ownership proof" });
  contract.ledger.push(...q.ledger);
}
test("compiled saved capacity accounts for replacements, failed writes, generations, conditions and delete reuse", () => {
  const f = objectSetup("plain", 1); f.contract.commands = [];
  const requests = [
    { kind: "put", namespace: "n", key: "x", bytes: 600000, content: "old" },
    { kind: "put", namespace: "n", key: "x", bytes: 700000, content: "replacement", ifGeneration: 2 },
    { kind: "put", namespace: "n", key: "x", bytes: 1048576, content: "refused" },
    { kind: "get", namespace: "n", key: "x" },
    { kind: "put", namespace: "n", key: "x", bytes: 1, content: "conditional", ifAbsent: true },
    { kind: "put", namespace: "n", key: "x", bytes: 1, content: "stale", ifGeneration: 2 },
    { kind: "delete", namespace: "n", key: "x", ifGeneration: 3 },
    { kind: "put", namespace: "n", key: "y", bytes: 1047552, content: "full", ifAbsent: true },
    { kind: "put", namespace: "n", key: "z", bytes: 1, content: "overflow" },
  ];
  requests.forEach((request, i) => command(f.contract, `step-${i}`, i * 1000000, request));
  const runtime = compile(f), store = () => runtime.evidence().asynchronous.objects[0]!;
  runtime.advanceTo(500000); expect(store()).toMatchObject({ storedBytes: 601024, committedPuts: 1, generation: 2 });
  runtime.advanceTo(1500000); expect(store()).toMatchObject({ storedBytes: 701024, committedPuts: 2, replacedObjects: 1, generation: 3 });
  const before = structuredClone(store().objects);
  runtime.advanceTo(2500000); expect(store().objects).toEqual(before); expect(store()).toMatchObject({ storedBytes: 701024, committedPuts: 2, generation: 3 });
  expect(store().service.reasons["object-capacity"]).toBe(1);
  runtime.advanceTo(5500000); expect(store().objects).toEqual(before); expect(store().service.reasons["precondition-failed"]).toBe(2);
  const get = runtime.evidence().systems.commands.results.find(r => r.id === "step-3")!.reply as ObjectReply;
  expect(get.object).toMatchObject({ bytes: 700000, content: "replacement", generation: 3 });
  runtime.advanceTo(6500000); expect(store()).toMatchObject({ storedBytes: 1024, removedObjects: 1, generation: 3 });
  runtime.advanceTo(8500000); expect(store()).toMatchObject({ storedBytes: 1048576, capacityBytes: 1048576, committedPuts: 3, replacedObjects: 1, removedObjects: 1, generation: 4 });
  expect(store().service.reasons["object-capacity"]).toBe(2);
  expect(store().storedBytes).toBe(store().objects.reduce((n, o) => n + o.bytes, 0));
  const once = compile(f); once.advanceTo(8500000); expect(once.evidence()).toEqual(runtime.evidence());
  console.info("object-byte-lifecycle", JSON.stringify({ storedBytes: store().storedBytes, committedPuts: store().committedPuts, replacedObjects: store().replacedObjects, removedObjects: store().removedObjects, generation: store().generation, reasons: store().service.reasons }));
});

test("same upload workload fills a small store while larger capacity accepts the writes", () => {
  const outcomes = [1, 2].map(capacityMiB => {
    const saved = objectDesign(); saved.workload.targetThroughput = 2400;
    saved.resources.find(r => r.id === "store")!.objectStoragePolicy = { version: 1, capacityMiB };
    const f = prepare(saved), runtime = createProductModel2(f.compiled);
    runtime.advanceTo(runtime.horizon); const e = runtime.evidence(), store = e.asynchronous.objects[0]!;
    const stepped = createProductModel2(f.compiled);
    for (let second = 1; second <= 30; second++) stepped.advanceTo(second * 1000000);
    expect(stepped.evidence()).toEqual(e);
    expect(store.storedBytes).toBe(1024 + store.committedPuts * 1024);
    expect(store.objects.reduce((n, o) => n + o.bytes, 0)).toBe(store.storedBytes);
    expect(store.replacedObjects).toBe(0); expect(store.storedBytes).toBeLessThanOrEqual(capacityMiB * 1048576);
    expect(store.objects.some(o => o.namespace === "uploads")).toBe(true);
    expect(store.objects.some(o => o.namespace === "results")).toBe(true);
    expect(e.asynchronous.workers[0]!.effects).toBeGreaterThan(0);
    return { capacityBytes: store.capacityBytes, storedBytes: store.storedBytes, committedPuts: store.committedPuts, refused: store.service.reasons["object-capacity"] ?? 0 };
  });
  expect(outcomes[0]!.refused).toBeGreaterThan(0); expect(outcomes[1]!.refused).toBe(0);
  expect(outcomes[1]!.committedPuts).toBeGreaterThan(outcomes[0]!.committedPuts);
  console.info("object-upload-capacity", JSON.stringify(outcomes));
});

test("saved capacity composes with real lease redelivery and Queue Depth 2 result idempotency", () => {
  const outcomes = [false, true].map(idempotentResults => {
    const saved = objectDesign("idempotent");
    saved.resources.find(r => r.id === "store")!.objectStoragePolicy = { version: 1, capacityMiB: 1 };
    saved.resources.find(r => r.id === "queue")!.asyncQueue!.capacityMessages = 3;
    saved.resources.find(r => r.id === "worker")!.asyncWorker!.idempotentResults = idempotentResults;
    const f = prepare(saved), contract = withTimeline(withRunLength(f.contract, 70, "object-idempotency-proof"), [{ id: "stop", kind: "load", atUs: 1, fraction: 0 }]);
    const c = compileProduct(saved, contract); if (!c.ok) throw Error(JSON.stringify(c));
    const once = createProductModel2(c.value), stepped = createProductModel2(c.value);
    once.advanceTo(70000000); for (let second = 1; second <= 70; second++) stepped.advanceTo(second * 1000000);
    expect(stepped.evidence()).toEqual(once.evidence());
    const e = once.evidence().asynchronous, store = e.objects[0]!;
    expect(e.brokers[0]!).toMatchObject({ accepted: 1, deliveries: 3, redelivered: 2, leaseExpired: 3, deadLettered: 1 });
    expect(store.storedBytes).toBe(3072); expect(store.capacityBytes).toBe(1048576);
    expect(store.objects.filter(o => o.namespace === "results")).toHaveLength(1);
    expect(store.objects.find(o => o.namespace === "results")!.generation).toBe(idempotentResults ? 3 : 5);
    expect(store.service.reasons["object-capacity"]).toBeUndefined();
    return { effects: e.workers[0]!.effects, deduplicated: e.workers[0]!.deduplicated, committedPuts: store.committedPuts, replacedObjects: store.replacedObjects };
  });
  expect(outcomes).toEqual([{ effects: 3, deduplicated: 0, committedPuts: 4, replacedObjects: 2 }, { effects: 1, deduplicated: 2, committedPuts: 2, replacedObjects: 0 }]);
  console.info("object-queue-depth2", JSON.stringify(outcomes));
});

test("CDN origin reads retain content, generation and byte inventory under saved capacity", () => {
  const old = objectSetup("cdn"), saved = objectSetup("cdn", 1);
  for (const f of [old, saved]) f.runtime.advanceTo(f.runtime.horizon);
  const a = old.runtime.evidence(), b = saved.runtime.evidence();
  expect(b.systems.cdns).toEqual(a.systems.cdns);
  expect(b.asynchronous.objects[0]!.objects).toEqual(a.asynchronous.objects[0]!.objects);
  expect(b.asynchronous.objects[0]!).toMatchObject({ storedBytes: 1024, committedPuts: 0, replacedObjects: 0, removedObjects: 0 });
  expect(b.systems.cdns[0]!.entries[0]).toMatchObject({ content: "assumed-asset", generation: 1, bytes: 1024 });
  expect(b.asynchronous.objects[0]!.gets).toBeGreaterThan(0);
});

for (const existing of [false, true]) test(`full saved capacity keeps conditional worker result ownership correct, existing=${existing}`, () => {
  const saved = objectDesign("idempotent"); saved.resources.find(r => r.id === "store")!.objectStoragePolicy = { version: 1, capacityMiB: 1 };
  saved.resources.find(r => r.id === "queue")!.asyncQueue!.capacityMessages = 3;
  const f = prepare(saved), contract = withTimeline(withRunLength(f.contract, 70, "object-full-worker"), [{ id: "stop", kind: "load", atUs: 1, fraction: 0 }]);
  const store = contract.nodes.store!.resources[0]!.config, q = quantities(), key = '["root","product-workload","arrival-0"]';
  if (store.kind !== "object-store") throw Error("Expected store");
  if (existing) store.initial.push({ namespace: "results", key, content: key, generation: 2, bytes: q.q("existing.bytes", 1024, "bytes") });
  store.initial.push({ namespace: "n", key: "ballast", content: "ballast", generation: 3, bytes: q.q("ballast.bytes", existing ? 1045504 : 1046528, "bytes") });
  contract.ledger.push(...q.ledger);
  const c = compileProduct(saved, contract); if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const runtime = createProductModel2(c.value); runtime.advanceTo(70000000);
  const e = runtime.evidence().asynchronous, s = e.objects[0]!;
  expect(s).toMatchObject({ storedBytes: 1048576, capacityBytes: 1048576, committedPuts: 1, replacedObjects: 0, removedObjects: 0, generation: 4 });
  expect(e.brokers[0]!).toMatchObject({ deliveries: 3, redelivered: 2, deadLettered: 1 });
  expect(e.workers[0]!).toMatchObject({ effects: 0, deduplicated: existing ? 3 : 0, failed: existing ? 0 : 3 });
  expect(s.service.reasons[existing ? "precondition-failed" : "object-capacity"]).toBe(3);
  if (existing) expect(s.objects.find(o => o.namespace === "results")).toMatchObject({ content: key, bytes: 1024, generation: 2 });
  else expect(s.objects.some(o => o.namespace === "results")).toBe(false);
});

test("Registry owns real object writes and capacity failures never register uncommitted blobs", () => {
  const outcomes = [1, 2].map(capacityMiB => {
    const f = objectSetup("registry", capacityMiB); f.contract.commands = [];
    const digest = `sha256:${"c".repeat(64)}`;
    command(f.contract, "blob", 0, { kind: "upload", digest, bytes: 1048576 }, "$registry");
    command(f.contract, "retry-blob", 1000000, { kind: "upload", digest, bytes: 1048576 }, "$registry");
    const runtime = compile(f); runtime.advanceTo(2000000);
    const e = runtime.evidence(), store = e.asynchronous.objects[0]!, registry = e.systems.registries[0]!;
    expect(store.objects.some(o => o.namespace === "registry")).toBe(capacityMiB === 2);
    expect(registry.blobs).toHaveLength(capacityMiB === 2 ? 1 : 0);
    expect(store).toMatchObject({ storedBytes: capacityMiB === 2 ? 1049600 : 1024, committedPuts: capacityMiB === 2 ? 1 : 0, replacedObjects: 0 });
    expect(registry.deduplicated).toBe(capacityMiB === 2 ? 1 : 0);
    return { storedBytes: store.storedBytes, committedPuts: store.committedPuts, reasons: store.service.reasons };
  });
  expect(outcomes[0]!.reasons["object-capacity"]).toBe(2);
  expect(outcomes[1]!.reasons["precondition-failed"]).toBe(1);
  console.info("object-registry-capacity", JSON.stringify(outcomes));
});
