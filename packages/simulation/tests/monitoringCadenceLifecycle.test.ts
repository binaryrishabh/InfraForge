import { expect, test } from "bun:test";
import type { MonitoringPolicy } from "@infraforge/domain/resource";
import { monitoringModes, monitoringSetup, type MonitoringMode } from "./monitoringCadence.fixture";
import { createProductModel2 } from "../src/model2/product/run";
import { compileProduct } from "../src/model2/product/compiler";
import { withRunLength } from "../src/model2/product/runContract";

const policy = (collectionIntervalSeconds: number, exportIntervalSeconds = 10): MonitoringPolicy => ({ version: 1, collectionIntervalSeconds, exportIntervalSeconds });
function run(mode: MonitoringMode, p?: MonitoringPolicy, at = 65000000) {
  const f = monitoringSetup(mode, p); f.runtime.advanceTo(at);
  const evidence = f.runtime.evidence(), monitor = evidence.systems.monitors[0]!, backend = evidence.systems.backends[0]!;
  const samples = [...backend.samples, ...monitor.buffered.map(r => r.sample), ...monitor.inFlight.flatMap(b => b.rows.map(r => r.sample))].sort((a, b) => a.measurementAt - b.measurementAt || a.id.localeCompare(b.id));
  return { ...f, evidence, monitor, backend, samples };
}

for (const mode of ["vm", "db", "multiple", "cdn-dns"] as const) test(`shorter collection generates more real observations on authored cadence without application work: ${mode}`, () => {
  const fast = run(mode, policy(2)), normal = run(mode), slow = run(mode, policy(20));
  const targets = mode === "multiple" || mode === "cdn-dns" ? 2 : 1;
  expect([fast.monitor.generated, normal.monitor.generated, slow.monitor.generated]).toEqual([32, 6, 3].map(n => n * targets));
  for (const f of [fast, normal, slow]) {
    const seconds = f.saved.resources.find(r => r.id === "monitor")!.monitoringPolicy?.collectionIntervalSeconds ?? 10;
    expect(f.monitor.collections).toBe(f.monitor.generated); expect(f.monitor.collectionFailures).toBe(0);
    expect(f.samples).toHaveLength(f.monitor.generated);
    for (const target of f.monitor.freshness.map(r => r.target)) {
      const samples = f.samples.filter(s => s.target === target);
      expect(samples.map(s => Math.floor(s.measurementAt / (seconds * 1000000)))).toEqual(Array.from({ length: samples.length }, (_, n) => n + 1));
      for (const [n, s] of samples.entries()) {
        // Observations complete after the periodic request traverses the real transport.
        expect(s.measurementAt - (n + 1) * seconds * 1000000).toBeLessThan(1000);
        expect(s.collectedAt).toBeGreaterThanOrEqual(s.measurementAt);
      }
      expect(f.runtime.inspect(target)).toEqual(normal.runtime.inspect(target));
    }
    expect(f.evidence.counts).toEqual(normal.evidence.counts);
    expect(f.evidence.results).toEqual(normal.evidence.results);
    // Monitoring uses real DB connections: slow polling lets its idle session expire.
    // Query work, rows, CPU, locks and current sessions must still match exactly.
    const applicationData = (data: typeof f.evidence.data) => ({ ...data, databases: data.databases.map(({ sessionEvents: _events, ...database }) => database) });
    expect(applicationData(f.evidence.data)).toEqual(applicationData(normal.evidence.data));
    for (const db of f.evidence.data.databases) expect(db.sessionEvents).toEqual({ established: seconds > 10 ? 4 : 2, closed: seconds > 10 ? 2 : 0, refused: 0, transactionTerminated: 0, protectedCommitCancels: 0 });
    expect(f.evidence.systems.cdns).toEqual(normal.evidence.systems.cdns);
    expect(f.evidence.systems.instrumentation.map(r => r.produced)).toEqual(Array(targets).fill(f.monitor.generated / targets));
    expect(f.monitor.scope).toContain("Target instrumentation CPU Unknown");
  }
});

test("export cadence changes delivery latency and real local buffering, leaving observations fixed", () => {
  const fast = run("vm", policy(2, 1), 19000000), slow = run("vm", policy(2, 20), 19000000);
  expect([fast.monitor.generated, slow.monitor.generated]).toEqual([9, 9]);
  expect([fast.monitor.exported, slow.monitor.exported]).toEqual([8, 0]);
  expect([fast.monitor.buffered.length, slow.monitor.buffered.length]).toEqual([1, 9]);
  expect([fast.monitor.bufferedBytes, slow.monitor.bufferedBytes]).toEqual([128, 1152]);
  expect(fast.backend.samples[0]!.arrivedAt).toBeLessThan(4000000);
  expect(fast.samples.map(s => [s.id, s.measurementAt, s.collectedAt, s.values])).toEqual(slow.samples.map(s => [s.id, s.measurementAt, s.collectedAt, s.values]));
  for (const exportSeconds of [1, 10, 60]) {
    const f = run("vm", policy(2, exportSeconds));
    expect(f.monitor.generated).toBe(32); expect(f.monitor.collections).toBe(32);
    expect(f.runtime.inspect("vm")).toEqual(run("vm", policy(2)).runtime.inspect("vm"));
  }
});

test("export batches really own samples while delivery is in flight", () => {
  const f = monitoringSetup("vm", policy(2));
  let inFlight = false;
  for (let at = 10000100; at <= 10000600; at += 50) {
    f.runtime.advanceTo(at); const m = f.runtime.evidence().systems.monitors[0]!;
    if (!m.inFlight.length) continue;
    inFlight = true;
    expect(m.inFlightBytes).toBe(m.inFlight.flatMap(b => b.rows).reduce((n, r) => n + r.sample.bytes, 0));
    expect(m.inFlightBytes).toBeGreaterThan(0); expect(m.batches).toBe(1); expect(m.exported).toBe(0);
  }
  expect(inFlight).toBe(true);
});

test("target outage creates failures and gaps; recovery never backfills missing observations", () => {
  const f = run("target-outage", policy(2));
  expect(f.monitor).toMatchObject({ collections: 32, generated: 22, collectionFailures: 10 });
  expect(f.monitor.events.rows.filter(r => r.kind === "collection-gap")).toHaveLength(10);
  expect(f.samples.some(s => s.measurementAt >= 15000000 && s.measurementAt < 35001000)).toBe(false);
  expect(f.samples.some(s => s.measurementAt > 35001000)).toBe(true);
  expect(new Set(f.samples.map(s => s.id)).size).toBe(f.monitor.generated);
});

test("Monitoring Agent outage leaves gaps while application target continues unchanged", () => {
  const normal = run("vm", policy(2)), f = run("agent-outage", policy(2));
  expect(f.monitor.generated).toBe(22); expect(f.monitor.collections).toBe(22);
  expect(f.samples.some(s => s.measurementAt >= 15000000 && s.measurementAt < 35001000)).toBe(false);
  expect(f.samples.some(s => s.measurementAt > 35001000)).toBe(true);
  expect(f.runtime.inspect("vm")).toEqual(normal.runtime.inspect("vm"));
  expect(f.evidence.results).toEqual(normal.evidence.results);
});

test("backend outage retries retain original measurement timestamps and delivery ordering", () => {
  const f = monitoringSetup("backend-outage", policy(2)); f.runtime.advanceTo(25000000);
  const before = f.runtime.evidence().systems.monitors[0]!;
  expect(before.failedBatches).toBeGreaterThan(0); expect(before.bufferedBytes).toBeGreaterThan(0);
  const original = new Map([...before.buffered.map(r => r.sample), ...before.inFlight.flatMap(b => b.rows.map(r => r.sample))].map(s => [s.id, s]));
  f.runtime.advanceTo(65000000); const e = f.runtime.evidence(), m = e.systems.monitors[0]!, backend = e.systems.backends[0]!;
  expect(m).toMatchObject({ generated: 32, collections: 32, collectionFailures: 0, failedBatches: 2 });
  const delayed = backend.samples.filter(s => original.has(s.id)); expect(delayed.length).toBeGreaterThan(0);
  for (const s of delayed) {
    const old = original.get(s.id)!;
    expect([s.measurementAt, s.collectedAt, s.values]).toEqual([old.measurementAt, old.collectedAt, old.values]);
    expect(s.arrivedAt).toBeGreaterThan(35001000);
  }
  for (const s of backend.samples) { expect(s.measurementAt).toBeLessThanOrEqual(s.collectedAt); expect(s.collectedAt).toBeLessThanOrEqual(s.arrivedAt); }
});

test("freshness remains measurement age against historical 30 seconds, independent of export", () => {
  const base = monitoringSetup("vm", policy(60, 60));
  const compiled = compileProduct(base.saved, withRunLength(base.contract, 125, "monitor-cadence-proof")); if (!compiled.ok) throw Error(JSON.stringify(compiled));
  const runtime = createProductModel2(compiled.value);
  runtime.advanceTo(59000000); expect(runtime.evidence().systems.monitors[0]!.freshness[0]).toMatchObject({ measuredAt: null, ageUs: null, state: "missing" });
  runtime.advanceTo(89000000); expect(runtime.evidence().systems.monitors[0]!.freshness[0]!.state).toBe("fresh");
  runtime.advanceTo(91000000); const fresh = runtime.evidence().systems.monitors[0]!.freshness[0]!;
  expect(fresh.state).toBe("stale"); expect(fresh.ageUs).toBe(91000000 - fresh.measuredAt!);
  runtime.advanceTo(121000000); expect(runtime.evidence().systems.monitors[0]!.freshness[0]!.state).toBe("fresh");
  expect(runtime.evidence().systems.monitors[0]!.generated).toBe(2);
});

test("one-shot and stepped cadence runs have identical evidence including outages", () => {
  for (const mode of [...monitoringModes, "agent-outage"] as const) {
    const one = run(mode, policy(2, 3)), stepped = monitoringSetup(mode, policy(2, 3));
    for (let s = 1; s <= 65; s++) stepped.runtime.advanceTo(s * 1000000);
    expect(stepped.runtime.evidence()).toEqual(one.evidence);
  }
});
