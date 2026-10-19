import { expect, test } from "bun:test";
import { EventKernel } from "../src/model2/time";
import { Lifecycle } from "../src/model2/composition/lifecycle";
import { hostCpuPool, memoryBudget } from "../src/model2/composition/budgets";
import { ModuleRegistry, manifest } from "../src/model2/composition/registry";
import { createStackComposition, type StackComposition } from "../src/model2/composition/run";
import { dataFixture } from "./dataFixture";
import { quantities } from "./workloadFixture";

function stack() {
  const q = quantities("Authored shared-host conservation proof; no physical calibration"), input = dataFixture();
  const composition: StackComposition = {
    hosts: [{ id: "host", cores: q.q("host.cores", 1, "cores"), memory: q.q("host.memory", 1024, "bytes") }],
    bindings: ["app", "db", "cache"].map(resource => ({ resource, host: "host", reservedMemory: q.q(`${resource}.reservation`, 256, "bytes") })),
  };
  return { input, composition };
}

test("registry rejects duplicate owners, incompatible APIs and unsupported kinds before factory effects", () => {
  type Config = { id: string; kind: "a" } | { id: string; kind: "b" };
  const registry = new ModuleRegistry<Config, undefined, string>(); let effects = 0;
  const module = { manifest: manifest("a", "1"), validate() { throw Error("Invalid config"); }, instantiate: () => { effects++; return "a"; } };
  registry.register("a", module);
  expect(() => registry.register("a", module)).toThrow("Duplicate");
  expect(() => registry.create({ id: "missing", kind: "b" }, undefined)).toThrow("Unsupported");
  expect(() => registry.create({ id: "invalid", kind: "a" }, undefined)).toThrow("Invalid config");
  expect(effects).toBe(0);
  expect(() => registry.register("b", { ...module, manifest: { ...manifest("b", "1"), hostApi: "unknown" as never } })).toThrow("Unsupported module contract");
});

test("lifecycle enforces ordering, cancels owned callbacks, and fences stale generations", () => {
  const lifecycle = new Lifecycle(1), clock = new EventKernel(100), events: string[] = [], first = lifecycle.create("app");
  expect(() => lifecycle.ready(first)).toThrow("Invalid lifecycle");
  lifecycle.register(first); lifecycle.ready(first); lifecycle.drain(first);
  lifecycle.clock(first, clock).schedule(10, 2, "old", () => events.push("old"));
  lifecycle.retire(first); expect(clock.pending).toBe(0);
  const next = lifecycle.create("app"); expect(next.generation).toBe(2);
  expect(() => lifecycle.ready(first)).toThrow("Stale");
  expect(() => lifecycle.create("other")).toThrow("budget");
  lifecycle.register(next); lifecycle.ready(next);
  const owned = lifecycle.clock(next, clock);
  owned.schedule(10, 3, "later", () => events.push("later"));
  owned.schedule(10, 2, "b", () => events.push("b"));
  owned.schedule(10, 2, "a", () => events.push("a"));
  const cancel = owned.schedule(5, 1, "cancelled", () => events.push("cancelled"));
  expect(cancel()).toBe(true); expect(cancel()).toBe(false);
  clock.advanceTo(10); expect(events).toEqual(["a", "b", "later"]);
});

test("memory admission shares one known owner, preserves Unknown and releases exactly once", () => {
  const q = quantities(), lifecycle = new Lifecycle(2), a = lifecycle.create("a"), b = lifecycle.create("b"), memory = memoryBudget("host", q.q("memory", 100, "bytes"));
  const lease = memory.reserve(a, q.q("a", 60, "bytes"))!;
  expect(memory.reserve(b, q.q("b", 50, "bytes"))).toBeUndefined();
  expect(() => memory.reserve(b, { kind: "unknown", unit: "bytes", reason: "Unmeasured", provenance: ["missing"] })).toThrow();
  expect(() => memory.reserve(a, q.q("duplicate", 1, "bytes"))).toThrow("duplicate");
  expect(lease.release()).toBe(true); expect(lease.release()).toBe(false);
  const second = memory.reserve(b, q.q("second", 100, "bytes"))!;
  expect(memory.measure()).toEqual({ id: "host", capacityBytes: 100, reservedBytes: 100, availableBytes: 0, leases: 1 });
  second.release(); expect(memory.measure().reservedBytes).toBe(0);
});

test("two CPU consumers share core-time, namespace identical calls, and cancel without stealing peer service", () => {
  const q = quantities(), clock = new EventKernel(100), lifecycle = new Lifecycle(2), a = lifecycle.create("a"), b = lifecycle.create("b"), pool = hostCpuPool("host", q.q("cores", 1, "cores"), clock), first = pool.lease(a), second = pool.lease(b), completed: string[] = [];
  first.scheduler.add({ id: "same-call", demand: 100, cap: 1, done: () => completed.push("a") });
  second.scheduler.add({ id: "same-call", demand: 100, cap: 1, done: () => completed.push("b") });
  clock.advanceTo(50);
  expect(pool.measure().appCoreUs).toBe(50);
  expect(first.scheduler.measure().appCoreUs).toBe(25);
  first.scheduler.remove("same-call");
  clock.advanceTo(125);
  expect(completed).toEqual(["b"]);
  expect(pool.measure().appCoreUs).toBe(125);
  expect(first.scheduler.measure().appCoreUs + second.scheduler.measure().appCoreUs).toBe(125);
  expect(pool.measure().appCoreUs).toBeLessThanOrEqual(pool.measure().availableCoreUs);
  first.release(); second.release(); expect(clock.pending).toBe(0);
  expect(() => first.scheduler.add({ id: "stale", demand: 1, cap: 1, done() {} })).toThrow("Retired");
});

test("pausing one CPU member leaves its peer running and resumes only remaining demand", () => {
  const q = quantities(), clock = new EventKernel(100), lifecycle = new Lifecycle(2), pool = hostCpuPool("host", q.q("cores", 1, "cores"), clock), a = pool.lease(lifecycle.create("a")), b = pool.lease(lifecycle.create("b")), done: string[] = [];
  a.scheduler.add({ id: "a", demand: 100, cap: 1, done: () => done.push("a") }); b.scheduler.add({ id: "b", demand: 100, cap: 1, done: () => done.push("b") });
  clock.advanceTo(50); a.scheduler.pause(true); clock.advanceTo(125); expect(done).toEqual(["b"]);
  a.scheduler.pause(false); clock.advanceTo(200); expect(done).toEqual(["b", "a"]);
  expect(a.scheduler.measure().appCoreUs).toBe(100); expect(pool.measure().appCoreUs).toBe(200);
});

test("first-stack composition conserves a colocated app/database/cache host and observer on/off is identical", () => {
  const f = stack(), observed: unknown[] = [];
  const a = createStackComposition(f.input, f.composition), b = createStackComposition(f.input, { ...f.composition, causal: event => observed.push(event) });
  a.advanceTo(a.horizon); b.advanceTo(b.horizon);
  expect(a.evidence()).toEqual(b.evidence()); expect(observed.length).toBeGreaterThan(0);
  const e = a.evidence(); expect(e.counts.completed).toBeGreaterThan(0);
  expect(e.composition.cpu).toHaveLength(1); expect(e.composition.cpu[0]!.appCoreUs).toBeLessThanOrEqual(e.composition.cpu[0]!.availableCoreUs);
  const resourceCpu = e.samples.at(-1)!.resources.filter(r => ["app", "db", "cache"].includes(r.id)).reduce((sum, r) => sum + r.consumedCoreUs, 0);
  expect(resourceCpu).toBeCloseTo(e.composition.cpu[0]!.appCoreUs, 8);
  expect(e.composition.memory[0]!.reservedBytes).toBe(768);
  for (const id of ["lb", "app", "db", "cache", "aside"]) { a.drain(id); a.retire(id); }
  expect(a.evidence().composition.memory[0]!.reservedBytes).toBe(0);
  expect(a.evidence().composition.cpu[0]!.members).toBe(0);
});

test("composition refuses unknown/oversubscribed memory, quota/capacity mismatch and duplicate placement", () => {
  const f = stack();
  const unknown = structuredClone(f.composition); unknown.hosts[0]!.memory = { kind: "unknown", unit: "bytes", reason: "Missing", provenance: ["missing"] };
  expect(() => createStackComposition(f.input, unknown)).toThrow();
  const exhausted = structuredClone(f.composition); exhausted.bindings.push({ ...exhausted.bindings[0]!, resource: "aside" });
  expect(() => createStackComposition(f.input, exhausted)).toThrow("Unsupported host binding");
  const duplicate = structuredClone(f.composition); duplicate.bindings.push(duplicate.bindings[0]!);
  expect(() => createStackComposition(f.input, duplicate)).toThrow("Duplicate");
  const tooSmall = structuredClone(f.composition); tooSmall.hosts[0]!.memory = { ...tooSmall.hosts[0]!.memory, kind: "known", value: 1 };
  expect(() => createStackComposition(f.input, tooSmall)).toThrow("exhausted");
  const mismatch = structuredClone(f.composition); mismatch.hosts[0]!.cores = { ...mismatch.hosts[0]!.cores, kind: "known", value: 2 };
  expect(() => createStackComposition(f.input, mismatch)).toThrow("mismatch");
});

test("retirement refuses live work and drain gates further admission", () => {
  const f = stack(), runtime = createStackComposition(f.input, f.composition);
  runtime.advanceTo(100); runtime.drain("app");
  expect(() => runtime.retire("app")).toThrow("live work");
  runtime.advanceTo(runtime.horizon); runtime.retire("app");
  expect(runtime.evidence().composition.lifecycle.find(r => r.id === "app")!.state).toBe("retired");
  expect(runtime.evidence().counts.rejected).toBeGreaterThan(0);
});

test("resource and placement authoring order cannot change the new composition", () => {
  const f = stack(), reversed = structuredClone(f);
  reversed.input.resources.reverse(); reversed.composition.bindings.reverse();
  const a = createStackComposition(f.input, f.composition), b = createStackComposition(reversed.input, reversed.composition);
  a.advanceTo(a.horizon); b.advanceTo(b.horizon); expect(a.evidence()).toEqual(b.evidence());
});

test("retiring an idle LB cancels its owned recurring probes before execution", () => {
  const f = stack(), runtime = createStackComposition(f.input, f.composition);
  runtime.drain("lb"); runtime.retire("lb"); runtime.advanceTo(runtime.horizon);
  expect(runtime.evidence().network.loadBalancers[0]!.backends.every(b => b.probes === 0)).toBe(true);
  expect(runtime.evidence().counts.completed).toBe(0);
  expect(runtime.evidence().composition.lifecycle.find(r => r.id === "lb")!.state).toBe("retired");
});

test("retirement removes future resource faults and data controls along with owned service timers", () => {
  const f = stack(), q = quantities();
  f.input.faults.push({ id: "future-pause", kind: "pause-service", target: "app", at: q.q("pause.at", 10000, "us"), duration: q.q("pause.duration", 1000, "us") });
  f.input.dataInterventions.push({ id: "future-flush", kind: "flush", target: "cache", at: q.q("flush.at", 12000, "us") });
  f.input.ledger.push(...q.ledger);
  const runtime = createStackComposition(f.input, f.composition);
  for (const id of ["lb", "app", "cache", "db", "aside"]) { runtime.drain(id); runtime.retire(id); }
  runtime.advanceTo(runtime.horizon);
  expect(runtime.evidence().capture.failure).toBeNull(); expect(runtime.evidence().faults).toEqual([]);
  expect(runtime.evidence().composition.cpu[0]!.appCoreUs).toBe(0);
});
