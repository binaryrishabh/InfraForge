import { expect, test } from "bun:test";
import { bufferSetup } from "./monitoringBuffer.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { withRunLength } from "../src/model2/product/runContract";
import { quantities } from "./workloadFixture";

const policy = (bufferSamples = 8, batchSamples = 2, exportAttempts = 10, collectionIntervalSeconds = 1, exportIntervalSeconds = 10) => ({ version: 2 as const, bufferSamples, batchSamples, exportAttempts, collectionIntervalSeconds, exportIntervalSeconds });
type Fixture = ReturnType<typeof bufferSetup>;
function state(f: Fixture, at = 65000000) {
  f.runtime.advanceTo(at); const evidence = f.runtime.evidence(), monitor = evidence.systems.monitors[0]!, backend = evidence.systems.backends[0]!;
  const owned = [...monitor.buffered, ...monitor.inFlight.flatMap(b => b.rows)];
  expect(monitor.generated).toBe(monitor.exported + monitor.droppedBeforeExport + monitor.discardedUnconfirmed + owned.length);
  expect(monitor.dropped).toBe(monitor.droppedBeforeExport + monitor.discardedUnconfirmed);
  expect(monitor.bufferedBytes + monitor.inFlightBytes).toBe(owned.length * 128);
  expect(monitor.bufferedBytes + monitor.inFlightBytes).toBeLessThanOrEqual(1048576);
  const p = f.saved.resources.find(r => r.id === "monitor")!.monitoringPolicy;
  expect(owned.length).toBeLessThanOrEqual(p?.version === 2 ? p.bufferSamples : 1000);
  return { evidence, monitor, backend, owned };
}

test("same backend outage fills the small buffer, drops newest and lets a larger buffer retain more", () => {
  const small = bufferSetup("backend-outage", policy(2)), large = bufferSetup("backend-outage", policy(8));
  const a = state(small, 25000000), b = state(large, 25000000);
  expect([a.monitor.generated, b.monitor.generated]).toEqual([24, 24]);
  expect([a.owned.length, b.owned.length]).toEqual([2, 8]);
  expect([a.monitor.droppedBeforeExport, b.monitor.droppedBeforeExport]).toEqual([20, 14]);
  expect(a.monitor.bufferedBytes).toBe(256); expect(b.monitor.bufferedBytes).toBe(1024);
  expect(a.monitor.discardedUnconfirmed).toBe(0); expect(b.monitor.discardedUnconfirmed).toBe(0);
  expect(state(small, 35000000).monitor.droppedBeforeExport).toBe(30);
  expect(state(large, 35000000).monitor.droppedBeforeExport).toBe(24);
  expect(small.runtime.inspect("vm")).toEqual(large.runtime.inspect("vm"));
});

test("recovery exports retained samples with their original identity and never reconstructs dropped observations", () => {
  const f = bufferSetup("backend-outage", policy(2)), before = state(f, 35000000);
  const retained = before.owned.map(r => r.sample), dropped = before.monitor.events.rows.filter(r => r.kind === "telemetry-drop").map(r => r.id);
  expect(retained).toHaveLength(2); expect(dropped).toHaveLength(30);
  const after = state(f);
  for (const old of retained) {
    const delivered = after.backend.samples.find(s => s.id === old.id)!;
    expect(delivered).toBeDefined(); expect(delivered.arrivedAt).toBeGreaterThan(35001000);
    const { arrivedAt: _at, ...sample } = delivered; expect(sample).toEqual(old);
  }
  const all = [...after.backend.samples, ...after.owned.map(r => r.sample)];
  expect(all.some(s => dropped.includes(s.id))).toBe(false);
  expect(after.monitor.generated).toBe(64); expect(after.monitor.exported).toBe(8); expect(after.monitor.droppedBeforeExport).toBe(54);
  expect(after.backend.samples).toHaveLength(after.monitor.exported);
});

test("ownership includes exports in flight and obeys sample and byte bounds through slow delivery", () => {
  const f = bufferSetup("slow-export", policy(2, 2, 3, 1, 3)); let observedFlight = false;
  for (let at = 2500000; at <= 6500000; at += 50000) {
    const s = state(f, at); if (s.monitor.inFlight.length) { observedFlight = true; expect(s.monitor.inFlightBytes).toBeGreaterThan(0); }
  }
  expect(observedFlight).toBe(true); expect(state(f).monitor.droppedBeforeExport).toBeGreaterThan(0);
  const max = bufferSetup("vm", policy(8192, 8192)); state(max);
  expect(8192 * 128).toBe(1048576);
});

test("maximum authored sample capacity really fills the unchanged one-MiB byte buffer", () => {
  const f = bufferSetup("vm", policy(8192, 1, 10, 1, 60)), q = quantities(), contract = withRunLength(f.contract, 8400, "monitor-cadence-proof");
  contract.faults.push({ id: "long-backend-outage", kind: "Crash", target: "monitor/backend", at: q.q("proof.long.at", 0, "us"), duration: q.q("proof.long.duration", 8500000000, "us"), restart: q.q("proof.long.restart", 1000, "us"), profile: "retain-logical-state/1" });
  contract.ledger.push(...q.ledger);
  const compiled = compileProduct(f.saved, contract); if (!compiled.ok) throw Error(JSON.stringify(compiled));
  const s = state({ ...f, runtime: createProductModel2(compiled.value) }, 8400000000);
  expect(s.evidence.capture).toMatchObject({ reachedHorizon: true, failure: null });
  expect(s.monitor).toMatchObject({ generated: 8399, bufferedBytes: 1048576, droppedBeforeExport: 207, discardedUnconfirmed: 0, exported: 0 });
  expect(s.owned).toHaveLength(8192);
});

test("one-sample batches use more real batches for the same exported measurements", () => {
  const one = bufferSetup("collection-stop", policy(20, 1, 2, 2, 3)), larger = bufferSetup("collection-stop", policy(20, 4, 2, 2, 3));
  const a = state(one), b = state(larger);
  expect([a.monitor.generated, b.monitor.generated, a.monitor.exported, b.monitor.exported]).toEqual([12, 12, 12, 12]);
  expect([a.monitor.batches, b.monitor.batches]).toEqual([12, 9]);
  const identity = (s: typeof a.backend.samples[number]) => [s.id, s.target, s.measurementAt, s.collectedAt, s.bytes, s.values];
  expect(a.backend.samples.map(identity)).toEqual(b.backend.samples.map(identity));
  expect(a.monitor.dropped).toBe(0); expect(b.monitor.dropped).toBe(0);
});

test("Depth 1 collection and export cadence each compose with buffer pressure", () => {
  const fastExport = state(bufferSetup("vm", policy(4, 4, 10, 1, 1))), slowExport = state(bufferSetup("vm", policy(4, 4, 10, 1, 10)));
  expect(fastExport.monitor.generated).toBe(slowExport.monitor.generated); expect(fastExport.monitor.droppedBeforeExport).toBe(0);
  expect(slowExport.monitor.droppedBeforeExport).toBeGreaterThan(0);
  const fastCollect = state(bufferSetup("backend-outage", policy(4, 4, 10, 1, 10))), slowCollect = state(bufferSetup("backend-outage", policy(4, 4, 10, 10, 10)));
  expect(fastCollect.monitor.generated).toBeGreaterThan(slowCollect.monitor.generated);
  expect(fastCollect.monitor.droppedBeforeExport).toBeGreaterThan(slowCollect.monitor.droppedBeforeExport);
});

test("one attempt abandons the same unconfirmed batch sooner; extra attempts really retry it", () => {
  const one = bufferSetup("slow-export", policy(8, 4, 1, 1, 3)), more = bufferSetup("slow-export", policy(8, 4, 3, 1, 3));
  const a = state(one, 4500000), b = state(more, 4500000);
  expect(a.monitor.discardedUnconfirmed).toBe(2); expect(b.monitor.discardedUnconfirmed).toBe(0);
  expect(b.monitor.buffered.filter(r => r.attempts === 1)).toHaveLength(2);
  const retried = b.monitor.buffered.filter(r => r.attempts === 1).map(r => r.sample.id);
  const c = state(more, 7500000);
  expect(c.backend.duplicates).toBe(2);
  for (const id of retried) expect(c.monitor.buffered.find(r => r.sample.id === id)?.attempts).toBe(2);
  const d = state(more);
  expect(d.backend.duplicates).toBe(52); expect(d.monitor.discardedUnconfirmed).toBe(25);
  expect(d.monitor.failedBatches).toBe(21); expect(d.monitor.exported).toBe(0);
});

test("ambiguous backend arrival remains independent of confirmed exports and local loss", () => {
  const f = bufferSetup("slow-export", policy(8, 4, 3, 1, 3)), s = state(f);
  expect(s.monitor).toMatchObject({ generated: 64, exported: 0, droppedBeforeExport: 31, discardedUnconfirmed: 25 });
  expect(s.backend.samples).toHaveLength(30); expect(s.backend.received).toBe(82); expect(s.backend.duplicates).toBe(52);
  expect(s.backend.received).toBe(s.backend.samples.length + s.backend.duplicates);
  for (const sample of s.backend.samples) { expect(sample.measurementAt).toBeLessThanOrEqual(sample.collectedAt); expect(sample.collectedAt).toBeLessThanOrEqual(sample.arrivedAt); }
  expect(s.monitor.freshness[0]!.state).toBe("fresh");
  expect(s.monitor.events.rows.some(r => r.kind === "telemetry-discard-unconfirmed")).toBe(true);
});

test("backend capacity and failure are independent of the agent buffer settings", () => {
  for (const capacity of [4, 8]) {
    const f = bufferSetup("backend-full", policy(capacity, 1, 2, 1, 3)), s = state(f);
    expect(s.backend.samples).toHaveLength(2); expect(s.backend.refused).toBeGreaterThan(0);
    expect(s.monitor.failedBatches).toBeGreaterThan(0); expect(s.monitor.discardedUnconfirmed).toBeGreaterThan(0);
    const backend = f.compiled.input.resources.find(r => r.kind === "telemetry-backend");
    expect(backend).toMatchObject({ samples: { value: 2 } });
  }
});

test("target outage produces collection gaps and stale freshness without buffer drops or backfill", () => {
  const f = bufferSetup("target-outage", policy(8, 4, 2, 1, 3)), before = state(f, 35000000), after = state(f);
  expect(before.monitor.collectionFailures).toBe(20); expect(before.monitor.dropped).toBe(0);
  expect(after.monitor).toMatchObject({ collections: 64, generated: 43, collectionFailures: 21, dropped: 0 });
  expect(after.backend.samples.some(s => s.measurementAt >= 15000000 && s.measurementAt < 35001000)).toBe(false);
  expect(after.backend.samples.some(s => s.measurementAt > 35001000)).toBe(true);
  const stale = bufferSetup("collection-stop", policy(8, 4, 2, 1, 3));
  expect(state(stale).monitor.freshness[0]!.state).toBe("stale");
});

test("one-shot and stepped buffer runs match exactly through outages, failures and ambiguity", () => {
  for (const mode of ["vm", "multiple", "target-outage", "backend-outage", "slow-export", "backend-full"] as const) {
    const one = bufferSetup(mode, policy(4, 2, 3, 1, 3)), stepped = bufferSetup(mode, policy(4, 2, 3, 1, 3));
    const a = state(one);
    for (let second = 1; second <= 65; second++) state(stepped, second * 1000000);
    expect(stepped.runtime.evidence()).toEqual(a.evidence);
  }
});
