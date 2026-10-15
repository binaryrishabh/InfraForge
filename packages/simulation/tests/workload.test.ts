import { expect, test } from "bun:test";
import { createWorkloadModel2 } from "../src/model2/workload/run";
import { ingestTrace } from "../src/model2/workload/arrivals";
import { resolveDemand } from "../src/model2/workload/profiles";
import { EventKernel } from "../src/model2/time";
import { keyedUniform } from "../src/model2/random";
import { ResultBook } from "../src/model2/workload/evidence";
import { workloadFixture, quantities } from "./workloadFixture";
import type { WorkloadInput } from "../src/model2/workload/contracts";

export function execute(input: WorkloadInput, batch?: number) {
  const m = createWorkloadModel2(input);
  if (batch) for (let at = batch; at < m.horizon; at += batch) m.advanceTo(at);
  m.advanceTo(m.horizon); return m.evidence();
}
function physics(e: ReturnType<typeof execute>) {
  return { counts: e.counts, resources: e.resources, results: e.results, distributions: e.distributions, inFlight: e.inFlight, byOperation: e.byOperation, sources: e.sources, faults: e.faults };
}
export function conserved(e: ReturnType<typeof execute>) {
  const c = e.counts;
  if (c.offered !== c.completed + c.rejected + c.deadlineExceeded + c.abandoned + c.inFlight) throw new Error("Caller conservation");
  if (e.resultRetention.terminal !== c.offered - c.inFlight || e.resultRetention.retained + e.resultRetention.omitted !== e.resultRetention.terminal) throw new Error("Evidence conservation");
  for (const s of [...e.samples.flatMap((v) => v.resources), ...e.resources]) {
    if (s.received !== s.admitted + s.rejected || s.admitted !== s.completed + s.failed + s.cancelled + s.queued + s.serving + s.waiting) throw new Error("Station conservation");
  }
}
test("analytical service, queue overflow, two classes, and exact deadline ties", () => {
  const normal = execute(workloadFixture()); expect(normal.counts.completed).toBe(10); expect(normal.results.every((r) => r.responseUs === 100)).toBe(true);
  expect(normal.resources[0]!.consumedCoreUs).toBe(1000); conserved(normal);
  const overflow = execute(workloadFixture({ cpu: 10, count: 5, interval: 1, queue: 1 }));
  expect(overflow.counts.admitted).toBe(2); expect(overflow.counts.rejected).toBe(3);
  expect(overflow.results.filter((r) => r.outcome === "completed").map((r) => r.responseUs)).toEqual([10, 19]); conserved(overflow);
  const tie = execute(workloadFixture({ count: 1, timeout: 100 }));
  expect(tie.counts.deadlineExceeded).toBe(1); expect(tie.resources[0]!.completed).toBe(1); expect(tie.counts.completed).toBe(0);
  const input = workloadFixture({ count: 2, interval: 1000 });
  input.arrivals = [{ id: "trace", kind: "trace", trace: { schema: "infraforge-arrivals/1", unit: "us", durationUs: 1000, provenance: "synthetic", rows: [{ id: "a", atUs: 0, operation: "light" }, { id: "b", atUs: 1000, operation: "heavy" }] } }];
  expect(execute(input).results.map((r) => r.responseUs)).toEqual([100, 800]);
});

test("caller deadlines detach; cooperative cancellation must be requested and supported", () => {
  const detached = execute(workloadFixture({ cpu: 1000, count: 1, timeout: 50, horizon: 100 }));
  expect(detached.counts.deadlineExceeded).toBe(1); expect(detached.counts.inFlight).toBe(0); expect(detached.resources[0]!.serving).toBe(1); expect(detached.resources[0]!.consumedCoreUs).toBe(100); conserved(detached);
  const input = workloadFixture({ cpu: 1000, count: 1, timeout: 50, cancellation: "cooperative" });
  input.operations.forEach((o) => o.onCallerStop = "request-cancellation");
  const cancelled = execute(input); expect(cancelled.resources[0]!.cancelled).toBe(1); expect(cancelled.resources[0]!.consumedCoreUs).toBe(50); expect(cancelled.counts.cancellationConfirmedAtEntry).toBe(1); conserved(cancelled);
  const unsupported = workloadFixture({ cpu: 1000, count: 1, timeout: 50 }); unsupported.operations.forEach((o) => o.onCallerStop = "request-cancellation");
  const continuing = execute(unsupported); expect(continuing.resources[0]!.completed).toBe(1); expect(continuing.resources[0]!.consumedCoreUs).toBe(1000); expect(continuing.counts.cancellationConfirmedAtEntry).toBe(0); conserved(continuing);
});

test("cancelling the caller's service cannot invent cancellation of a noncooperative child", () => {
  const input = workloadFixture({ cpu: 10, count: 1, timeout: 50, horizon: 100, cancellation: "cooperative" });
  const app = input.resources[0]!; if (app.kind === "router") throw new Error();
  app.downstream = "db"; input.operations.forEach((o) => o.onCallerStop = "request-cancellation");
  const profiles = input.profiles.map((p) => ({ ...p, id: `db.${p.id}`, stage: "database" as const, cpu: { ...p.cpu, kind: "known" as const, value: 1000 } }));
  for (const p of profiles) { const id = `${p.id}.cpu`; p.cpu.provenance = [id]; const entry = { ...input.ledger[0]!, id, quantity: p.cpu }; input.ledger.push(entry); }
  input.profiles.push(...profiles);
  input.resources.push({ ...app, id: "db", kind: "database", downstream: undefined, cancellation: "unsupported", profiles: { light: "db.synthetic.light", heavy: "db.synthetic.heavy" } });
  const e = execute(input); expect(e.resources.find((s) => s.id === "app")!.cancelled).toBe(1);
  expect(e.resources.find((s) => s.id === "db")!.serving).toBe(1); expect(e.resources.find((s) => s.id === "db")!.consumedCoreUs).toBe(90); conserved(e);
  // A mismatched ledger is intentionally rejected before any execution.
  expect(() => createWorkloadModel2({ ...input, horizon: { ...input.horizon, kind: "known", value: 10000 } })).toThrow("provenance");
});

test("open arrivals persist under overload; closed users wait for caller outcomes and think time", () => {
  const open = workloadFixture({ cpu: 1000, count: 100, interval: 100, horizon: 10000, timeout: 100000 });
  const closed = structuredClone(open), t = quantities();
  closed.arrivals = [{ id: "load", kind: "closed", operation: "light", start: t.q("closed.start", 0, "us"), users: t.q("closed.users", 1, "count"), perUser: t.q("closed.perUser", 100, "count"), think: t.q("closed.think", 100, "us") }]; closed.ledger.push(...t.ledger);
  const a = execute(open), b = execute(closed); expect(a.counts.offered).toBe(100); expect(b.counts.offered).toBe(10); expect(a.resources[0]!.queued).toBeGreaterThan(0); expect(b.resources[0]!.queued).toBe(0); conserved(a); conserved(b);
});

test("caller abandonment has one outcome; horizon populations are explicit and right-censored", () => {
  const input = workloadFixture({ cpu: 1000, count: 3, interval: 100, horizon: 300 });
  const t = quantities(); input.operations[0]!.abandonAfter = t.q("abandon", 150, "us"); input.ledger.push(...t.ledger);
  const e = execute(input); expect(e.counts.offered).toBe(3); expect(e.counts.abandoned).toBe(2); expect(e.counts.inFlight).toBe(1); expect(e.distributions.censored).toBe(1); expect(e.inFlight[0]!.state).toBe("queued"); conserved(e);
});

test("trace ingestion validates schema, units, order, operations, identities and bounded infinite input", () => {
  const header = { schema: "infraforge-arrivals/1" as const, unit: "us" as const, durationUs: 10, provenance: "synthetic" }, row = { id: "a", atUs: 1, operation: "light" };
  const ingest = (rows = [row]) => ingestTrace(header, rows, 2, new Set(["light"]));
  expect(ingest().rows).toEqual([row]);
  for (const rows of [[row, row], [{ ...row, atUs: 2 }, { ...row, id: "b", atUs: 1 }], [{ ...row, atUs: 11 }], [{ ...row, operation: "missing" }], [{ ...row, atUs: 0.1 }], [{ ...row, payloadBytes: -1 }], [{ ...row, extra: true }]]) expect(() => ingest(rows)).toThrow();
  let read = 0; function* infinite() { while (true) yield { ...row, id: String(read++) }; }
  expect(() => ingestTrace(header, infinite(), 2, new Set(["light"]))).toThrow("budget"); expect(read).toBe(3);
  expect(() => ingestTrace({ ...header, unit: "ms" } as never, [row], 2, new Set(["light"]))).toThrow("schema");
});

test("profiles fail closed outside scope or with bounded/unknown demand; trace payload is checked", () => {
  const p = workloadFixture().profiles[0]!, context = { labels: { software: "other", environment: "verification-only" }, quantities: {} };
  expect(resolveDemand(p, "light", "compute", context).kind).toBe("unknown");
  expect(resolveDemand({ ...p, cpu: { kind: "range", min: 1, max: 100, unit: "cpu-us", provenance: ["bound"] } }, "light", "compute", { ...context, labels: p.validity.exact }).kind).toBe("unknown");
  const input = workloadFixture(); input.resources[0]!.kind !== "router" && (input.resources[0]!.context.labels.software = "other"); expect(() => createWorkloadModel2(input)).toThrow("Unknown demand");
  const trace = workloadFixture(); trace.arrivals = [{ id: "t", kind: "trace", trace: { schema: "infraforge-arrivals/1", unit: "us", durationUs: 0, provenance: "test", rows: [{ id: "r", atUs: 0, operation: "light", payloadBytes: 2 }] } }]; expect(() => createWorkloadModel2(trace)).toThrow("payload");
});

test("seeded Poisson arrivals, immutable snapshots, ordering and playback/observation independence", () => {
  const input = workloadFixture({ count: 100, cores: 0.7, slots: 3, interval: 23, horizon: 20000 });
  const a = input.arrivals[0]!; if (a.kind !== "periodic") throw new Error(); input.arrivals = [{ ...a, kind: "poisson", meanInterval: a.interval }];
  const expected = execute(input); expect(physics(execute(input, 17))).toEqual(physics(expected)); expect(execute(input)).toEqual(expected);
  const shuffled = structuredClone(input); shuffled.operations.reverse(); shuffled.profiles.reverse(); shuffled.ledger.reverse();
  expect(execute(shuffled)).toEqual(expected);
  const observation = structuredClone(input), q = quantities(); observation.sampleInterval = q.q("different.sample", 77, "us"); observation.ledger.push(...q.ledger);
  expect(physics(execute(observation))).toEqual(physics(expected));
  const m = createWorkloadModel2(input); input.profiles[0]!.cpu = { kind: "known", value: 999999, unit: "cpu-us", provenance: ["mutated"] }; m.advanceTo(m.horizon); expect(m.evidence()).toEqual(expected);
});

test("bounded raw retention preserves all histogram counts and does not invent unsupported tail precision", () => {
  const input = workloadFixture({ count: 500, interval: 200, horizon: 110000, raw: 5 }); const e = execute(input); conserved(e);
  expect(e.results.length).toBe(5); expect(e.resultRetention.omitted).toBe(495);
  const g = e.distributions.groups[0]!; expect(g.histogram.counts.reduce((a, b) => a + b, 0)).toBe(500);
  expect(g.percentiles.find((p) => p.p === 0.99)!.kind).toBe("bounded"); expect(g.percentiles.find((p) => p.p === 0.999)!.kind).toBe("unknown");
  const book = new ResultBook(2); for (let i = 0; i < 2; i++) book.record({ rootId: String(i), callId: String(i), attempt: 0, operation: "o", offeredAt: 0, at: i, responseUs: i, outcome: "completed" });
  expect(book.summary()[0]!.percentiles[0]).toMatchObject({ kind: "exact", valueUs: 0 });
  book.record({ rootId: "large", callId: "large", attempt: 0, operation: "large", offeredAt: 0, at: Number.MAX_SAFE_INTEGER, responseUs: Number.MAX_SAFE_INTEGER, outcome: "completed" });
  expect(book.summary().find((g) => g.operation === "large")!.histogram.counts[53]).toBe(1);
});

test("actual topology ordering and unrelated station insertion do not alter workload physics", () => {
  const input = workloadFixture({ cpu: 113, count: 100, interval: 51 });
  const app = input.resources[0]!; input.resources.push({ ...structuredClone(app), id: "other" });
  input.resources.push({ id: "edge", kind: "router", backends: ["other", "app"] }); input.operations.forEach((o) => o.entry = "edge");
  const e = execute(input), reordered = structuredClone(input); reordered.resources.reverse();
  for (const r of reordered.resources) if (r.kind === "router") r.backends.reverse();
  expect(execute(reordered)).toEqual(e);
  input.resources.push({ ...structuredClone(app), id: "unused" }); const unrelated = execute(input);
  expect(unrelated.results).toEqual(e.results); expect(unrelated.resources.filter((r) => r.id !== "unused")).toEqual(e.resources);
});

test("deep dependency identities grow as a flat path rather than recursively escaped strings", () => {
  const input = workloadFixture({ count: 1 }); const app = input.resources[0]!; if (app.kind === "router") throw new Error();
  input.resources = Array.from({ length: 64 }, (_, i) => ({ ...structuredClone(app), id: i ? `stage${i}` : "app", downstream: i < 63 ? `stage${i + 1}` : undefined }));
  const e = execute(input); expect(e.counts.completed).toBe(1); expect(e.results[0]!.responseUs).toBe(6400);
  expect(e.resources.every((s) => s.completed === 1 && s.consumedCoreUs === 100)).toBe(true); conserved(e);
});

test("invalid provenance, cycles, budgets and cancellation semantics fail before execution; failures cannot resume", () => {
  const bad = workloadFixture(); bad.ledger.pop(); expect(() => createWorkloadModel2(bad)).toThrow("provenance");
  const cycle = workloadFixture(); const app = cycle.resources[0]!; if (app.kind !== "router") app.downstream = "app"; expect(() => createWorkloadModel2(cycle)).toThrow("Cyclic");
  const unknown = workloadFixture(); unknown.profiles[0]!.cpu = { kind: "unknown", unit: "cpu-us", provenance: ["unknown"], reason: "No benchmark" }; expect(() => createWorkloadModel2(unknown)).toThrow("Unknown demand");
  const invalid = workloadFixture(); invalid.limits.maxRequests = 1; expect(() => createWorkloadModel2(invalid)).toThrow("budget");
  const limited = workloadFixture(); limited.limits.maxEvents = 10; const m = createWorkloadModel2(limited); expect(() => m.advanceTo(m.horizon)).toThrow("budget");
  expect(m.evidence().capture.failure).toContain("budget"); expect(m.evidence().capture.reachedHorizon).toBe(false); expect(() => m.advanceTo(m.horizon)).toThrow("resume");
  const tie = workloadFixture({ count: 1, timeout: 100 }); tie.operations[0]!.abandonAfter = tie.operations[0]!.callerTimeout;
  expect(execute(tie).counts.deadlineExceeded).toBe(1);
});

test("pause retains remote work after caller deadlines while open load continues, then drains", () => {
  const input = workloadFixture({ cpu: 100, count: 100, interval: 100, timeout: 500, horizon: 30000 }); const t = quantities();
  input.faults = [{ id: "pause", target: "app", kind: "pause-service", at: t.q("fault.at", 1000, "us"), duration: t.q("fault.duration", 5000, "us") }]; input.ledger.push(...t.ledger);
  const e = execute(input); conserved(e); const during = e.samples.find((s) => s.at === 4000)!;
  expect(during.counts.offered).toBe(41); expect(during.resources[0]!.paused).toBe(true); expect(during.resources[0]!.queued).toBeGreaterThan(0); expect(during.counts.deadlineExceeded).toBeGreaterThan(0);
  expect(e.resources[0]!.completed).toBe(100); expect(e.resources[0]!.consumedCoreUs).toBe(10000); expect(e.counts.offered).toBe(100); expect(e.resources[0]!.queued + e.resources[0]!.serving).toBe(0);
});

test("indexed cancellation removes arbitrary heap positions without changing deterministic ties", () => {
  const kernel = new EventKernel(30000), expected: Array<{ at: number; key: string; priority: number }> = [], actual: string[] = [];
  for (let i = 0; i < 10000; i++) {
    const at = Math.floor(keyedUniform("heap", "r", String(i), "at") * 1000), key = String(i), priority = i % 4;
    const cancel = kernel.schedule(at, priority, key, () => actual.push(key));
    if (i % 3 === 0) { expect(cancel()).toBe(true); expect(cancel()).toBe(false); } else expected.push({ at, key, priority });
  }
  kernel.advanceTo(1000); expected.sort((a, b) => a.at - b.at || a.priority - b.priority || (a.key < b.key ? -1 : 1));
  expect(actual).toEqual(expected.map((e) => e.key)); expect(kernel.pending).toBe(0);
});

test("generated workloads conserve work under capacity, faults, deadlines, cancellation and horizon cuts", () => {
  for (let i = 0; i < 1200; i++) {
    const n = (purpose: string, max: number) => 1 + Math.floor(keyedUniform("m2b-properties", "case", String(i), purpose) * max);
    const input = workloadFixture({ cpu: n("cpu", 1000), heavy: n("heavy", 1000), count: 30, interval: n("gap", 500), timeout: n("deadline", 10000), horizon: n("horizon", 20000), queue: n("queue", 20) - 1, slots: n("slots", 4), cores: n("cores", 3) / 2, cancellation: i % 2 ? "cooperative" : "unsupported", sample: 1000, raw: i % 5 });
    input.operations.forEach((o) => o.onCallerStop = i % 3 ? "request-cancellation" : "detach");
    if (i % 2) { const q = quantities(); input.faults = [{ id: "pause", target: "app", kind: "pause-service", at: q.q("pause.at", 1000, "us"), duration: q.q("pause.duration", n("pause", 5000), "us") }]; input.ledger.push(...q.ledger); }
    const e = execute(input); conserved(e); const s = e.resources[0]!;
    if (s.consumedCoreUs < 0 || s.consumedCoreUs > e.at * (input.resources[0]!.kind === "router" ? 0 : input.resources[0]!.cores.kind === "known" ? input.resources[0]!.cores.value : 0) + 1e-7) throw new Error("CPU conservation");
    if (i % 20 === 0) expect(physics(execute(input, 31))).toEqual(physics(e));
  }
});

test("isolated FCFS monotonicity holds for 600 paired service/capacity cases", () => {
  for (let i = 0; i < 600; i++) {
    const cpu = i % 997 + 1, base = workloadFixture({ cpu, count: 20, interval: i % 100 + 1, horizon: 100000, timeout: 1000000 });
    const b = execute(base), slow = execute(workloadFixture({ cpu: cpu * 2, count: 20, interval: i % 100 + 1, horizon: 100000, timeout: 1000000 })), fast = execute(workloadFixture({ cpu, count: 20, interval: i % 100 + 1, cores: 2, horizon: 100000, timeout: 1000000 }));
    for (let j = 0; j < 20; j++) { if (slow.results[j]!.responseUs < b.results[j]!.responseUs || fast.results[j]!.responseUs > b.results[j]!.responseUs) throw new Error("Isolated monotonicity"); }
  }
});
