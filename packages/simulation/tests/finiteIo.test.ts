import { expect, test } from "bun:test";
import { ioBudget, type IoWork } from "../src/model2/composition/io-budget";
import { EventKernel } from "../src/model2/time";
import { finiteIoRuntime } from "../src/model2/data/io";
import { validateFiniteIo } from "../src/model2/data/io-contract";
import { relationalDatabase } from "../src/model2/data/database";
import { createStackComposition } from "../src/model2/composition/run";
import { finiteIoFixture, ioInvocation, iq, ioEvidence } from "./finiteIoFixture";

const device = (clock: EventKernel, queueOperations = 2, queueBytes = 100) => ioBudget({ id: "device", generation: 3, serviceConcurrency: 1, queueOperations, queueBytes, iops: 10000, bytesPerSecond: 1000000, flushServiceUs: 20, policy: "fifo-max-operation-byte-service/1" }, clock, 100);
const work = (role: string, bytes = 100, kind: IoWork["kind"] = "page-read"): IoWork => ({ role, request: role, transaction: role, operation: role, bytes, kind });

test("two roles and background share one FIFO operation/byte calendar", () => {
  const clock = new EventKernel(100), owner = device(clock, 3, 1000), done: number[] = [];
  owner.submit(work("a"), () => done.push(clock.now)); owner.submit(work("b", 300), () => done.push(clock.now)); owner.submit(work("background", 0, "flush"), () => done.push(clock.now));
  clock.advanceTo(520); expect(done).toEqual([100, 400, 520]);
  const e = owner.measure(); expect(e.accepted).toEqual({ operations: 3, bytes: 400 }); expect(e.completed).toEqual(e.accepted);
  expect(e.receipts.map(r => r.serviceUs)).toEqual([100, 300, 120]); expect(e.receipts.map(r => r.queueUs)).toEqual([0, 100, 400]);
});
test("queue operation and byte caps refuse independently and cannot-fit refuses immediately", () => {
  for (const [ops, bytes, size] of [[1, 1000, 100], [10, 100, 60]]) {
    const clock = new EventKernel(100), owner = device(clock, ops, bytes);
    expect(owner.submit(work("a", size), () => {}).admitted).toBe(true); expect(owner.submit(work("b", size), () => {}).admitted).toBe(true);
    expect(owner.submit(work("c", size), () => {}).admitted).toBe(false); expect(owner.submit(work("large", bytes + 1), () => {}).admitted).toBe(false);
  }
});
test("queued cancellation releases once; started cancellation conserves work and fences retirement", () => {
  const clock = new EventKernel(100), owner = device(clock), done: string[] = [];
  const a = owner.submit(work("a"), () => done.push("a")), b = owner.submit(work("b"), () => done.push("b"));
  expect(b.cancel()).toBe(true); expect(b.cancel()).toBe(false); expect(a.cancel()).toBe(true);
  expect(() => owner.retire()).toThrow("live"); clock.advanceTo(100); expect(done).toEqual([]);
  expect(owner.measure()).toMatchObject({ accepted: { operations: 2, bytes: 200 }, completed: { operations: 1, bytes: 100 }, cancelled: { operations: 1, bytes: 100 } });
  owner.retire(); expect(() => owner.submit(work("stale"), () => {})).toThrow("Retired");
});
test("deadline at completion time detaches started work before its priority-2 completion", () => {
  const clock = new EventKernel(100), owner = device(clock); let completed = false;
  const handle = owner.submit(work("a"), () => { completed = true; });
  clock.schedule(100, 1, "deadline", () => handle.cancel()); clock.advanceTo(100);
  expect(completed).toBe(false); expect(owner.measure().completed.operations).toBe(1); expect(owner.measure().receipts[0]!.detached).toBe(true);
});
test("clean-page LRU hits avoid IO, misses install only after service and evict finitely", () => {
  const { profile } = finiteIoFixture(), clock = new EventKernel(100), io = finiteIoRuntime(profile, clock), role = io.forRole("db"); let done = 0;
  role.statement(ioInvocation("a"), 0, () => done++); expect(io.evidence().buffers[0]!.pages).toEqual([]);
  clock.advanceTo(100); role.statement(ioInvocation("b"), 0, () => done++);
  expect(done).toBe(2); expect(io.evidence().devices[0]!.accepted.operations).toBe(1);
  role.statement(ioInvocation("c", "light", "k1"), 0, () => done++); clock.advanceTo(200);
  expect(io.evidence().buffers[0]).toMatchObject({ pages: ["page-k1"], hits: 1, misses: 2, evictions: 1 });
});
test("coalesced page waiters cancel independently, including last-waiter cancellation and rejoin", () => {
  const { profile } = finiteIoFixture(), clock = new EventKernel(100), io = finiteIoRuntime(profile, clock), role = io.forRole("db"), done: string[] = [];
  const a = role.statement(ioInvocation("a"), 0, () => done.push("a")), b = role.statement(ioInvocation("b"), 0, () => done.push("b"));
  a(); b(); expect(io.evidence().waiters).toBe(0);
  role.statement(ioInvocation("c"), 0, () => done.push("c")); clock.advanceTo(100);
  expect(done).toEqual(["c"]); expect(io.evidence().devices[0]!.completed.operations).toBe(1); expect(io.evidence().buffers[0]!.pages).toEqual(["page-k0"]);
});
test("last coalesced queued waiter cancels the single receipt and releases bytes exactly once", () => {
  const { profile } = finiteIoFixture(); profile.background = { policy: "explicit-bounded-schedule", schedule: [{ id: "bg", device: "disk", atUs: iq(0, "us"), bytes: iq(64, "bytes"), evidence: ioEvidence }] };
  const clock = new EventKernel(100), io = finiteIoRuntime(profile, clock), role = io.forRole("db"); clock.advanceTo(0);
  const a = role.statement(ioInvocation("a"), 0, () => {}), b = role.statement(ioInvocation("b"), 0, () => {}); a(); b(); b(); clock.advanceTo(100);
  expect(io.evidence().devices[0]).toMatchObject({ cancelled: { operations: 1, bytes: 64 }, completed: { operations: 1, bytes: 64 } }); expect(io.evidence().buffers[0]!.pages).toEqual([]);
});
test("hot row locks remain independent of shared device service; protected WAL survives cancellation", () => {
  const { config, profile } = finiteIoFixture(), clock = new EventKernel(1000), io = finiteIoRuntime(profile, clock), db = relationalDatabase(config, clock, undefined, undefined, io.forRole("db"));
  db.openSession("a"); db.openSession("b");
  const a = db.accept(ioInvocation("a", "heavy"), () => {}); db.accept(ioInvocation("b", "heavy"), () => {});
  clock.advanceTo(101); expect(db.evidence().queries.lockWaiting).toBe(1); expect(db.evidence().queries.committing).toBe(1);
  expect(a.cancel()).toBe("unsupported"); db.closeSession("a"); clock.advanceTo(1000);
  expect(db.evidence().transactions.committed).toBe(2); expect(db.evidence().rows[0]!.version).toBe(3);
  const e = io.evidence().devices[0]!; expect(e.completed).toEqual({ operations: 5, bytes: 192 }); expect(e.receipts.map(r => r.kind)).toEqual(["page-read", "wal-write", "flush", "wal-write", "flush"]);
});
test("cancel during a page read rolls back while issued device work still completes", () => {
  const { config, profile } = finiteIoFixture(), clock = new EventKernel(1000), io = finiteIoRuntime(profile, clock), db = relationalDatabase(config, clock, undefined, undefined, io.forRole("db"));
  db.openSession("a"); const handle = db.accept(ioInvocation("a", "heavy"), () => {}); clock.advanceTo(1); handle.cancel(); clock.advanceTo(1000);
  expect(db.evidence().transactions.cancelled).toBe(1); expect(db.evidence().rows[0]!.version).toBe(1); expect(io.evidence().devices[0]!.completed.bytes).toBe(64);
  expect(io.evidence().waiters).toBe(0);
});
test("explicit background competes; missing background and physical totals remain Unknown", () => {
  const { profile } = finiteIoFixture(); profile.background = { policy: "explicit-bounded-schedule", schedule: [{ id: "bg", device: "disk", atUs: iq(0, "us"), bytes: iq(64, "bytes"), evidence: ioEvidence }] };
  const clock = new EventKernel(100), io = finiteIoRuntime(profile, clock); clock.advanceTo(0); let finished = 0;
  io.forRole("db").statement(ioInvocation("a"), 0, () => { finished = clock.now; }); clock.advanceTo(200);
  expect(finished).toBe(200); expect(io.evidence().totalDemand).toBeNull(); expect(io.evidence().physicalHitRate).toBeNull();
});
test("admission refuses unknowns, units, concurrency, placement, omissions and safety ceiling violations", () => {
  const f = finiteIoFixture(); expect(() => validateFiniteIo(f.profile, f.input, f.composition)).not.toThrow();
  const mutations = [
    (p: typeof f.profile) => { p.devices[0]!.iops = { value: null, unit: "operations/s", reason: "unobserved" }; },
    (p: typeof f.profile) => { p.devices[0]!.serviceConcurrency = iq(2, "count"); },
    (p: typeof f.profile) => { p.buffers[0]!.capacityBytes = iq(8192, "bytes"); },
    (p: typeof f.profile) => { p.buffers[0]!.initialPages = ["x", "x"]; },
    (p: typeof f.profile) => { p.bindings.pop(); },
    (p: typeof f.profile) => { p.bindings[0]!.walBytes = iq(1, "bytes"); },
    (p: typeof f.profile) => { p.background.policy = "implicit" as never; },
    (p: typeof f.profile) => { p.limits.maxPages = 1; },
    (p: typeof f.profile) => { p.bindings[0]!.buffer = "missing"; },
    (p: typeof f.profile) => { p.devices[0]!.iops.unit = "bytes/s" as never; },
  ];
  for (const mutate of mutations) { const p = structuredClone(f.profile); mutate(p); expect(() => validateFiniteIo(p, f.input, f.composition)).toThrow(); }
});
test("composition reserves the buffer once and pins immutable evidence with observer equality", () => {
  const f = finiteIoFixture(), observed: unknown[] = [];
  // This fixture routes through the existing aside owner, retaining exact keys.
  const a = createStackComposition(f.input, { ...f.composition, storage: f.profile }), b = createStackComposition(f.input, { ...f.composition, storage: f.profile, causal: e => observed.push(e) });
  f.profile.devices[0]!.iops = iq(1, "operations/s"); a.advanceTo(a.horizon); b.advanceTo(b.horizon);
  expect(a.evidence()).toEqual(b.evidence()); expect(observed.length).toBeGreaterThan(0);
  expect(a.evidence().composition.memory[0]!.reservedBytes).toBe(832); expect(a.evidence().composition.storage!.devices[0]!.iops).toBe(10000);
  const exposed = a.evidence().composition.storage!; exposed.profile.bindings[0]!.statementPages[0]!.push("forged-page");
  expect(a.evidence().composition.storage!.profile.bindings[0]!.statementPages[0]).not.toContain("forged-page");
});

test("two relational roles share one device and conserve distinct page and WAL receipts", () => {
  const f = finiteIoFixture(), second = structuredClone(f.config); second.id = "db2"; second.execution.id = "db2";
  f.input.resources.push(second); f.input.endpoints.db2 = { alive: true, ready: true };
  f.composition.bindings.push({ ...f.composition.bindings[1]!, resource: "db2" });
  f.profile.bindings.push(...f.profile.bindings.map(b => ({ ...structuredClone(b), role: "db2" })));
  validateFiniteIo(f.profile, f.input, f.composition);
  const clock = new EventKernel(1000), io = finiteIoRuntime(f.profile, clock), a = relationalDatabase(f.config, clock, undefined, undefined, io.forRole("db")), b = relationalDatabase(second, clock, undefined, undefined, io.forRole("db2"));
  a.openSession("a"); b.openSession("b");
  a.accept(ioInvocation("a", "heavy", "k0"), () => {}); b.accept(ioInvocation("b", "heavy", "k1"), () => {}); clock.advanceTo(1000);
  const e = io.evidence().devices[0]!;
  expect(e.accepted).toEqual(e.completed); expect(e.completed).toEqual({ operations: 6, bytes: 256 });
  expect(e.receipts.filter(r => r.role === "db").length).toBe(3); expect(e.receipts.filter(r => r.role === "db2").length).toBe(3);
  for (let i = 1; i < e.receipts.length; i++) expect(e.receipts[i]!.startedAtUs!).toBeGreaterThanOrEqual(e.receipts[i - 1]!.completedAtUs!);
  expect(a.evidence().transactions.committed + b.evidence().transactions.committed).toBe(2);
});

test("logical acknowledgement retains queued WAL after success and required receipt caps fail explicitly", () => {
  const { profile } = finiteIoFixture(); for (const b of profile.bindings) if (b.operation === "heavy") b.commitAck = "logical-only";
  const clock = new EventKernel(100), io = finiteIoRuntime(profile, clock); let acknowledged = false;
  io.forRole("db").commit(ioInvocation("a", "heavy"), () => { acknowledged = true; });
  expect(acknowledged).toBe(true); expect(io.liveFor("db")).toBe(true); clock.advanceTo(100);
  expect(io.evidence().devices[0]!.completed.bytes).toBe(64);
  profile.limits.maxReceipts = 1;
  const bounded = finiteIoRuntime(profile, clock); bounded.forRole("db").commit(ioInvocation("b", "heavy"), () => {});
  expect(() => bounded.forRole("db").commit(ioInvocation("c", "heavy"), () => {})).toThrow("budget exhausted");
});

test("same-time statement deadline rolls back before page completion; lock release lets peer proceed", () => {
  const { config, profile, q } = finiteIoFixture(); config.plans.heavy!.statementTimeout = q.q("deadline", 101, "us");
  const clock = new EventKernel(1000), io = finiteIoRuntime(profile, clock), db = relationalDatabase(config, clock, undefined, undefined, io.forRole("db"));
  db.openSession("a"); db.openSession("b"); db.accept(ioInvocation("a", "heavy"), () => {});
  clock.advanceTo(1); config.plans.heavy!.statementTimeout = q.q("disabled", 0, "us"); db.accept(ioInvocation("b", "heavy"), () => {});
  // Plans are held by transactions; keep the first timeout captured at admission.
  clock.advanceTo(1000);
  expect(db.evidence().reasons["statement-timeout"]).toBe(1); expect(db.evidence().transactions.committed).toBe(1);
  expect(db.evidence().rows[0]!.version).toBe(2); expect(io.evidence().waiters).toBe(0);
});

test("same-time queued cancellation precedes service start and receipt accounting remains exact", () => {
  const clock = new EventKernel(100), owner = device(clock), done: string[] = [];
  owner.submit(work("a"), () => done.push("a")); const b = owner.submit(work("b"), () => done.push("b"));
  clock.schedule(100, 1, "cancel-b", () => b.cancel()); clock.advanceTo(200);
  expect(done).toEqual(["a"]); expect(owner.measure().receipts[1]).toMatchObject({ state: "cancelled", startedAtUs: null, completedAtUs: 100, queueUs: 100, serviceUs: 0 });
});

test("storage memory lives through relational retirement and releases once after all work settles", () => {
  const f = finiteIoFixture(), runtime = createStackComposition(f.input, { ...f.composition, storage: f.profile });
  expect(() => runtime.retireStorage()).toThrow("relational"); runtime.advanceTo(runtime.horizon);
  runtime.drain("db"); runtime.retire("db"); expect(runtime.evidence().composition.memory[0]!.reservedBytes).toBe(576);
  runtime.retireStorage(); runtime.retireStorage(); expect(runtime.evidence().composition.memory[0]!.reservedBytes).toBe(512);
  expect(runtime.evidence().composition.storage!.retired).toBe(true);
});

test("generation retirement refuses a future background schedule even with no current service", () => {
  const { profile } = finiteIoFixture(); profile.background = { policy: "explicit-bounded-schedule", schedule: [{ id: "later", device: "disk", atUs: iq(100, "us"), bytes: iq(1, "bytes"), evidence: ioEvidence }] };
  const clock = new EventKernel(100), io = finiteIoRuntime(profile, clock);
  expect(() => io.retire()).toThrow("live work"); clock.advanceTo(200); io.retire();
  expect(() => io.forRole("db").statement(ioInvocation("stale"), 0, () => {})).toThrow("Retired");
});
