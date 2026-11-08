import { expect, test } from "bun:test";
import { objectSetup } from "./objectCapacity.fixture";
import { objectStore } from "../src/model2/async/objects";
import { EventKernel } from "../src/model2/time";
import { observabilityLive } from "../src/model2/product/observabilityLive";
import type { ObjectRequest } from "../src/model2/async/contracts";
import type { Invocation } from "../src/model2/workload/contracts";

function fixture() {
  const f = objectSetup("plain", 1), config = f.compiled.input.resources.find(r => r.kind === "object-store")!;
  if (config.kind !== "object-store") throw Error("Expected object store");
  const kernel = new EventKernel(100000), store = objectStore(config, kernel);
  const source = { inspectObject: () => store.evidence(), inspectMonitor: () => undefined };
  let sequence = 0;
  const send = (request: ObjectRequest) => {
    const id = `command-${sequence++}`;
    const work: Invocation = { rootId: id, callId: id, operation: "light", attempt: 0, offeredAt: kernel.now, message: { request } };
    return store.accept(work, () => {});
  };
  const settle = () => kernel.advanceTo(kernel.now + 500000);
  const metrics = () => observabilityLive(config, source, kernel.now).objectStorage!;
  return { kernel, store, send, settle, metrics };
}

test("real object projection separates capacity-check puts, conditional refusals and cancellation before application", () => {
  const { store, send, settle, metrics } = fixture();
  const put = (key: string, bytes: number, condition: Partial<ObjectRequest> = {}) => send({kind: "put", namespace: "n", key, bytes, content: "body", ...condition});
  put("x", 600000); settle();
  const first = metrics();
  expect(first).toMatchObject({ puts: 1, committedPuts: 1, replacedObjects: 0, generation: 2, storedBytes: 601024 });
  const committed = put("x", 700000, {ifGeneration: 2}); settle();
  expect(committed.cancel()).toBe("already-finished");
  const replaced = metrics();
  expect(replaced).toMatchObject({ puts: 2, committedPuts: 2, replacedObjects: 1, generation: 3, storedBytes: 701024 });
  put("x", 1048576); settle();
  expect(metrics()).toMatchObject({ puts: 3, committedPuts: 2, generation: 3, storedBytes: 701024, "object-capacity": 1 });
  put("x", 1, {ifAbsent: true}); settle();
  put("x", 1, {ifGeneration: 2}); settle();
  const cancelled = put("x", 1);
  expect(cancelled.cancel()).toBe("cancelled"); settle();
  put("x", -1); settle();
  store.access(true, false); put("x", 1); settle(); store.access(true, true);
  expect(metrics()).toMatchObject({puts: 3, committedPuts: 2, generation: 3, storedBytes: 701024,
    commandReasons: {"object-capacity": 1, "precondition-failed": 2, cancelled: 1, "invalid-put": 1, "writes-unavailable": 1}});
  expect(metrics().objects).toEqual(replaced.objects);
  send({kind: "delete", namespace: "n", key: "x", ifGeneration: 3}); settle();
  send({kind: "delete", namespace: "n", key: "absent"}); settle();
  put("y", 1047552); settle(); put("z", 1); settle();
  const saved = JSON.parse(JSON.stringify(metrics()));
  expect(saved).toMatchObject({puts: 5, committedPuts: 3, replacedObjects: 1, deletes: 2, removedObjects: 1, generation: 4,
    storedBytes: 1048576, capacityBytes: 1048576, objectCount: 2, omittedObjects: 0});
  expect(saved.puts).toBe(saved.committedPuts + saved.commandReasons["object-capacity"]);
  expect(saved.storedBytes).toBe(store.evidence().objects.reduce((sum, o) => sum + o.bytes, 0));
  expect(first.objects!.find(o => o.key === "x")!.bytes).toBe(600000); // Retained samples do not mutate later.
  expect(saved.objects.every((o: object) => !Object.hasOwn(o, "content"))).toBe(true);
  console.info("object-ledger-lifecycle", JSON.stringify(saved));
});

test("bounded current inventory preserves exact totals and explicit omission; shrinking capacity does not erase objects", () => {
  const { store, send, settle, metrics } = fixture();
  for (let i = 0; i < 110; i++) { send({kind: "put", namespace: "n", key: `key-${i}`, bytes: 1, content: "body"}); settle(); }
  const m = metrics();
  expect(m.objects).toHaveLength(100);
  expect(m).toMatchObject({objectCount: 111, omittedObjects: 11, generation: 111, puts: 110, committedPuts: 110, storedBytes: 1134});
  expect(m.objects).toEqual(store.evidence().objects.slice(0, 100).map(({namespace, key, bytes, generation}) => ({namespace, key, bytes, generation})));
  store.capacity(1);
  expect(metrics()).toMatchObject({storedBytes: 1134, capacityBytes: 1, overCapacity: true, generation: 111});
});

test("missing source counters and inventory remain Unknown without constructing empty or zero populations", () => {
  const f = objectSetup("plain", 1), resource = f.compiled.input.resources.find(r => r.kind === "object-store")!;
  const row = f.runtime.inspectObject("store")!;
  for (const key of ["objects", "service", "puts", "generation", "overCapacity"]) Reflect.deleteProperty(row, key);
  const m = observabilityLive(resource, {inspectObject: () => row, inspectMonitor: () => undefined}).objectStorage!;
  expect(m).toMatchObject({objects: null, objectCount: null, omittedObjects: null, commandReasons: null, puts: null, generation: null, overCapacity: null, "object-capacity": null});
});
