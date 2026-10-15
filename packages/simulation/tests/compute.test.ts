import { test, expect } from "bun:test";
import { createComputeModel2 } from "../src/model2/compute/run";
import { computeFixture } from "./computeFixture";
import { quantities } from "./workloadFixture";
import { keyedUniform } from "../src/model2/random";
import type { ComputeInput, ComputeResource } from "../src/model2/compute/contracts";
import { resolveModel } from "../src/model2/registry";

export function computeRun(input: ComputeInput, batch?: number) {
  const m = createComputeModel2(input); if (batch) for (let at = batch; at < m.horizon; at += batch) m.advanceTo(at);
  m.advanceTo(m.horizon); return m.evidence();
}
export function computeConservation(e: ReturnType<typeof computeRun>) {
  const c = e.counts;
  if (c.offered !== c.completed + c.rejected + c.deadlineExceeded + c.abandoned + c.inFlight) throw new Error("Caller conservation");
  for (const r of [...e.samples.flatMap((s) => s.resources), ...e.resources]) {
    if (r.received !== r.admitted + r.rejected || r.admitted !== r.completed + r.failed + r.cancelled + r.queued + r.serving + r.waiting) throw new Error("Invocation conservation");
    if (!r.compute) continue;
    const { cpu, workers, memory } = r.compute;
    if (cpu.appCoreUs + cpu.competitorCoreUs > cpu.availableCoreUs + 1e-6 || cpu.appCoreUs < 0 || cpu.allocations.some((j) => j.remainingCoreUs < 0)) throw new Error("CPU conservation");
    if (workers.configured !== workers.idle + workers.runnable + workers.blockedWait + workers.blockedDependency) throw new Error("Worker conservation");
    if (memory.totalResidentBytes.kind === "known" && memory.totalResidentBytes.value !== memory.knownSubtotalBytes) throw new Error("Memory conservation");
    if (memory.ownership.requests !== r.queued + r.serving + r.waiting || memory.ownership.active !== r.serving + r.waiting) throw new Error("Memory lifetime/ownership conservation");
  }
}

test("unused CPU is reusable but invocation parallelism caps it; workers are not cores", () => {
  const e = computeRun(computeFixture({ count: 1, cores: 4, slots: 8, cpu: 100 }));
  expect(e.results[0]!.responseUs).toBe(100); expect(e.resources[0]!.compute!.cpu.appCoreUs).toBe(100); computeConservation(e);
  const parallel = computeRun(computeFixture({ count: 1, cores: 4, slots: 8, parallelism: 2, cpu: 100 })); expect(parallel.results[0]!.responseUs).toBe(50);
});
test("default internal Model-2 dispatch selects compute while M2B replay stays explicit", () => {
  const entry = resolveModel("2", { internal: true });
  if (entry.version !== "2" || entry.workloadVersion !== "m2c/1") throw new Error("Wrong dispatch");
  expect(entry.create(computeFixture({ count: 1 })).evidence().workloadVersion).toBe("m2c/1");
  expect(() => resolveModel("2")).toThrow("internal");
});
test("runnable contention and worker concurrency emerge without throughput multipliers", () => {
  const one = computeRun(computeFixture({ count: 8, cores: 2, slots: 1, interval: 1, cpu: 100 })), many = computeRun(computeFixture({ count: 8, cores: 2, slots: 8, interval: 1, cpu: 100, sample: 50 }));
  expect(one.results.at(-1)!.at).toBe(800); expect(many.results.at(-1)!.at).toBeLessThan(410);
  expect(many.samples.some((s) => s.resources[0]!.compute!.cpu.contended)).toBe(true); computeConservation(many);
});
test("application wall blocking occupies workers, consumes no CPU, and pause freezes progress", () => {
  const input = computeFixture({ count: 2, cpu: 100, wait: 1000, slots: 2, sample: 100, horizon: 3000 });
  const q = quantities(); input.faults = [{ id: "pause", target: "app", kind: "pause-service", at: q.q("pause.at", 400, "us"), duration: q.q("pause.duration", 500, "us") }]; input.ledger.push(...q.ledger);
  const e = computeRun(input); expect(e.samples.find((s) => s.at === 500)!.resources[0]!.compute!.workers.blockedWait).toBe(2);
  expect(e.samples.find((s) => s.at === 600)!.resources[0]!.consumedCoreUs).toBe(200); expect(e.results.every((r) => r.at >= 1600)).toBe(true); computeConservation(e);
});
test("quota controls bandwidth separately from available capacity and exposes throttling", () => {
  const input = computeFixture({ count: 1, cpu: 150, cores: 1, slots: 1, horizon: 500, sample: 10 }); const q = quantities();
  (input.resources[0] as ComputeResource).quota = { budget: q.q("quota.budget", 25, "cpu-us"), period: q.q("quota.period", 100, "us") }; input.ledger.push(...q.ledger);
  const partial = createComputeModel2(input); partial.advanceTo(50); const snapshot = partial.evidence();
  expect(snapshot.resources[0]!.compute!.cpu.appCoreUs).toBe(25); expect(snapshot.resources[0]!.compute!.cpu.throttled).toBe(true);
  partial.advanceTo(500); expect(partial.evidence().counts.completed).toBe(0); expect(partial.evidence().resources[0]!.compute!.cpu.appCoreUs).toBe(125); computeConservation(partial.evidence());
});
test("capacity changes integrate available core-time and competitors consume scheduler capacity", () => {
  const input = computeFixture({ count: 1, cpu: 1000, cores: 1, horizon: 3000 }); const q = quantities();
  input.interventions = [{ id: "competitor", target: "app", kind: "competitor", at: q.q("comp.at", 0, "us"), duration: q.q("comp.duration", 1000, "us"), demand: q.q("comp.demand", 1000, "cpu-us"), parallelism: q.q("comp.cap", 1, "cores") }]; input.ledger.push(...q.ledger);
  const e = computeRun(input); expect(e.results[0]!.at).toBe(1500); expect(e.resources[0]!.compute!.cpu.competitorCoreUs).toBe(500); computeConservation(e);
  const changed = computeFixture({ count: 1, cpu: 1000, cores: 1, parallelism: 2, horizon: 2000 }); const v = quantities();
  changed.interventions = [{ id: "capacity", target: "app", kind: "capacity", at: v.q("capacity.at", 100, "us"), cores: v.q("capacity.cores", 2, "cores") }]; changed.ledger.push(...v.ledger);
  const b = computeRun(changed); expect(b.results[0]!.at).toBe(550); expect(b.resources[0]!.compute!.cpu.availableCoreUs).toBe(3900);
});
test("resident ownership survives caller detachment, releases on service end, and preserves Unknown", () => {
  const input = computeFixture({ count: 2, cpu: 1000, timeout: 10, horizon: 200, interval: 1, slots: 1, requestBytes: 30, activeBytes: 60 });
  const e = computeRun(input); expect(e.counts.inFlight).toBe(0); expect(e.resources[0]!.compute!.memory.knownSubtotalBytes).toBe(232); computeConservation(e);
  const unknown = computeFixture({ count: 1 }); const r = unknown.resources[0] as ComputeResource;
  const id = "unknown.native"; r.memory.retained = { kind: "unknown", unit: "bytes", provenance: [id], reason: "Native resident state unmeasured" }; unknown.ledger.push({ ...unknown.ledger[0]!, id, quantity: r.memory.retained });
  const u = computeRun(unknown); expect(u.resources[0]!.compute!.memory.totalResidentBytes.kind).toBe("unknown"); expect(u.resources[0]!.compute!.memory.knownSubtotalBytes).toBe(105);
  const drained = computeRun(computeFixture({ count: 2 })); expect(drained.resources[0]!.compute!.memory.knownSubtotalBytes).toBe(112);
});
test("explicit allocation rejection is distinct from OOM; observation-only limits do not kill work", () => {
  const input = computeFixture({ count: 3, cpu: 1000, interval: 1 }); const q = quantities(); const r = input.resources[0] as ComputeResource;
  r.memory.limit = q.q("resident.limit", 140, "bytes"); r.memory.policy = "reject-allocation"; input.ledger.push(...q.ledger);
  const e = computeRun(input); expect(e.counts.rejected).toBe(3); expect(e.resources[0]!.completed).toBe(0); computeConservation(e);
  r.memory.policy = "observe"; const observed = computeRun(input); expect(observed.counts.completed).toBe(3);
});
test("sampling, playback and resource ordering do not mutate compute physics", () => {
  const input = computeFixture({ cpu: 123, cores: 0.7, slots: 7, interval: 17, count: 30, sample: 111, horizon: 10000 });
  const e = computeRun(input), b = computeRun(input, 13); expect(b).toEqual(e);
  const changed = structuredClone(input), q = quantities(); changed.sampleInterval = q.q("other.sample", 137, "us"); changed.ledger.push(...q.ledger); changed.resources.reverse(); changed.profiles.reverse();
  const other = computeRun(changed); expect(other.results).toEqual(e.results); expect(other.resources).toEqual(e.resources); computeConservation(other);
});

test("dependency-blocked workers hold application slots and memory without local CPU", () => {
  const input = computeFixture({ count: 2, cpu: 100, slots: 2, interval: 1, sample: 100, horizon: 5000 }), q = quantities();
  (input.resources[0] as ComputeResource).downstream = "db";
  for (const op of input.operations) {
    const base = input.profiles.find((p) => p.operation === op.id)!;
    input.profiles.push({ ...base, schema: "infraforge-demand/1", id: `db.${op.id}`, stage: "database", cpu: q.q(`db.${op.id}.cpu`, 1, "cpu-us"), io: q.q(`db.${op.id}.blocking`, 1000, "us") });
  }
  input.resources.push({ id: "db", kind: "database", cores: q.q("db.cores", 1, "cores"), concurrency: q.q("db.slots", 1, "count"), queueCapacity: q.q("db.queue", 100, "count"), profiles: { light: "db.light", heavy: "db.heavy" }, context: { labels: { software: "synthetic", environment: "verification-only" }, quantities: {} }, cancellation: "unsupported" });
  input.ledger.push(...q.ledger); const e = computeRun(input), resource = e.samples.find((s) => s.at === 500)!.resources.find((r) => r.id === "app")!;
  expect(resource.compute!.workers.blockedDependency).toBe(2); expect(resource.compute!.cpu.appCoreUs).toBe(200); expect(resource.compute!.cpu.runnable).toBe(0); computeConservation(e);
});

test("quota depletion, pause completion ties and zero-capacity intervals preserve exact state", () => {
  const input = computeFixture({ count: 1, cpu: 100, horizon: 500, sample: 50 }), q = quantities();
  input.faults = [{ id: "tie", target: "app", kind: "pause-service", at: q.q("tie.at", 100, "us"), duration: q.q("tie.duration", 100, "us") }]; input.ledger.push(...q.ledger);
  const e = computeRun(input); expect(e.results[0]!.at).toBe(200); expect(e.resources[0]!.compute!.cpu.appCoreUs).toBe(100);
  const zero = computeFixture({ count: 1, horizon: 500, sample: 50 }), z = quantities();
  zero.interventions = [{ id: "zero", kind: "capacity", target: "app", at: z.q("zero.at", 0, "us"), cores: z.q("zero.cores", 0, "cores") }]; zero.ledger.push(...z.ledger);
  const noCpu = computeRun(zero); expect(noCpu.counts.completed).toBe(0); expect(noCpu.intervals.every((i) => i.utilization.kind === "unknown")).toBe(true); computeConservation(noCpu);
});

test("multiple compute resources, router backends and profile order canonicalize full evidence", () => {
  const input = computeFixture({ count: 50, cpu: 100, interval: 1, slots: 4 });
  input.resources.push({ ...structuredClone(input.resources[0] as ComputeResource), id: "other" }, { id: "edge", kind: "router", backends: ["other", "app"] });
  input.operations.forEach((o) => o.entry = "edge");
  const e = computeRun(input), shuffled = structuredClone(input);
  shuffled.resources.reverse(); shuffled.profiles.reverse(); shuffled.operations.reverse(); shuffled.interventions.reverse();
  for (const r of shuffled.resources) if (r.kind === "router") r.backends.reverse();
  expect(computeRun(shuffled)).toEqual(e);
  const model = createComputeModel2(input); (input.resources.find((r) => r.kind === "compute") as ComputeResource).workers = { kind: "known", value: 999, unit: "count", provenance: ["mutated"] };
  model.advanceTo(model.horizon); expect(model.evidence()).toEqual(e);
});

test("application-specific resident components and partial coverage need no invented baseline", () => {
  const input = computeFixture({ count: 1, cpu: 1000, horizon: 100 }), q = quantities();
  const r = input.resources[0] as ComputeResource;
  r.memory = { coverage: "complete-model", components: [{ id: "custom-runtime", owner: "process", bytes: q.q("custom.runtime", 500, "bytes") }], policy: "observe" };
  for (const p of input.profiles) if (p.schema === "infraforge-compute-demand/1") { delete p.requestResidentBytes; delete p.activeResidentBytes; p.residentComponents = [{ id: "request-buffer", owner: "admitted", bytes: q.q(`custom.${p.operation}.buffer`, 40, "bytes") }]; }
  input.ledger.push(...q.ledger); const e = computeRun(input); expect(e.resources[0]!.compute!.memory.knownSubtotalBytes).toBe(540); computeConservation(e);
  r.memory.coverage = "partial"; const partial = computeRun(input); expect(partial.resources[0]!.compute!.memory.totalResidentBytes.kind).toBe("unknown");
});

test("evidence cannot mutate live configuration and paused quota epochs remain observable", () => {
  const input = computeFixture({ count: 2, interval: 200, cpu: 100, horizon: 600, sample: 50 }), q = quantities();
  (input.resources[0] as ComputeResource).quota = { budget: q.q("epoch.budget", 25, "cpu-us"), period: q.q("epoch.period", 100, "us") };
  input.faults = [{ id: "pause", kind: "pause-service", target: "app", at: q.q("epoch.pause", 50, "us"), duration: q.q("epoch.duration", 200, "us") }]; input.ledger.push(...q.ledger);
  const model = createComputeModel2(input); model.advanceTo(150);
  const observed = model.evidence(); expect(observed.resources[0]!.compute!.cpu.quotaRemainingCoreUs).toBe(25);
  observed.computeConfiguration[0]!.memory = { coverage: "complete-model", policy: "observe" };
  observed.computeProfiles[0]!.cpu = { kind: "known", value: 0, unit: "cpu-us", provenance: ["mutated"] };
  observed.computePolicyLedger[0]!.concept = "mutated";
  model.advanceTo(model.horizon); expect(model.evidence()).toEqual(computeRun(input));
});

test("3000 generated compute cases conserve CPU, workers, caller outcomes and resident ownership", () => {
  for (let i = 0; i < 3000; i++) {
    const n = (key: string, max: number) => 1 + Math.floor(keyedUniform("m2c-sweep", "case", String(i), key) * max);
    const input = computeFixture({ count: 25, cores: n("cores", 8) / 2, slots: n("workers", 16), cpu: n("cpu", 1000), heavy: n("heavyCpu", 4000), interval: n("arrival", 200), timeout: n("deadline", 5000), horizon: n("horizon", 15000), wait: n("wait", 400) - 1, parallelism: n("parallelism", 4), queue: n("queue", 30) - 1, requestBytes: n("requestBytes", 1000), activeBytes: n("activeBytes", 1000), sample: 1000, raw: 5 });
    if (i % 4 === 0) input.arrivals = [{ id: "mix", kind: "trace", trace: { schema: "infraforge-arrivals/1", unit: "us", durationUs: 24 * n("arrival", 200), provenance: "Authored generated synthetic operation mix", rows: Array.from({ length: 25 }, (_, j) => ({ id: String(j).padStart(3, "0"), atUs: j * n("arrival", 200), operation: j % n("mix", 7) ? "light" : "heavy" })) } }];
    input.operations.forEach((o) => o.onCallerStop = i % 2 ? "detach" : "request-cancellation"); (input.resources[0] as ComputeResource).cancellation = "cooperative";
    const q = quantities();
    if (i % 2) input.faults = [{ id: "pause", target: "app", kind: "pause-service", at: q.q("sweep.pause.at", n("pauseAt", 4000), "us"), duration: q.q("sweep.pause.duration", n("pauseDuration", 3000), "us") }];
    if (i % 3 === 0) input.interventions = [{ id: "competitor", target: "app", kind: "competitor", at: q.q("sweep.comp.at", 500, "us"), duration: q.q("sweep.comp.duration", 1000, "us"), demand: q.q("sweep.comp.cpu", n("competitorDemand", 4000), "cpu-us"), parallelism: q.q("sweep.comp.parallelism", 2, "cores") }];
    if (i % 5 === 0) (input.resources[0] as ComputeResource).quota = { budget: q.q("sweep.quota.budget", n("budget", 500), "cpu-us"), period: q.q("sweep.quota.period", 1000, "us") };
    if (i % 7 === 0) input.interventions.push({ id: "capacity", kind: "capacity", target: "app", at: q.q("sweep.capacity.at", 1500, "us"), cores: q.q("sweep.capacity.cores", n("changedCores", 8) / 2, "cores") });
    if (i % 11 === 0) { const r = input.resources[0] as ComputeResource; r.memory.policy = "reject-allocation"; r.memory.limit = q.q("sweep.memory.limit", 512 + n("memoryLimit", 20000), "bytes"); }
    input.ledger.push(...q.ledger); const e = computeRun(input); computeConservation(e);
    if (i % 100 === 0) expect(computeRun(input, 31)).toEqual(e);
  }
}, 60000);
