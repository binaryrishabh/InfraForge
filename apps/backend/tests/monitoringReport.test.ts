import { expect, test } from "bun:test";
import { monitoringReportFixture } from "./monitoringReport.fixture";
import { monitoringSnapshot } from "../simulator/monitoringSnapshot";
import { createModel2Engine } from "../simulator/model2Engine";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { monitoringLayout, monitoringWorkload } from "./monitoringCadence.fixture";

test("saved monitoring round trip preserves separate engine owners, buffer occupancy and freshness", () => {
  const f = monitoringReportFixture();
  for (const c of f.cases) {
    const saved = c.report.terminal!.resources.find(r => r.id === "monitor")!;
    for (const key of ["generated", "collections", "collectionFailures", "exported", "dropped", "droppedBeforeExport", "discardedUnconfirmed", "batches", "failedBatches", "bufferedBytes", "inFlightBytes", "freshness"] as const) {
      expect(saved.monitoring![key]).toEqual(c.raw[key]);
    }
    expect(saved.monitoring!.bufferedSamples).toBe(c.raw.buffered.length);
    expect(saved.monitoring!.inFlightSamples).toBe(c.raw.inFlight.reduce((n, b) => n + b.rows.length, 0));
    expect(saved.monitoringBackend).toEqual({version: 1, id: c.backend.id, received: c.backend.received,
      duplicates: c.backend.duplicates, refused: c.backend.refused, latest: c.backend.latest});
    expect(c.report.checkpoint!.resources.find(r => r.id === "monitor")).toEqual(saved);
    const m = saved.monitoring!;
    expect(m.generated).toBe(m.exported! + m.droppedBeforeExport! + m.discardedUnconfirmed! + m.bufferedSamples! + m.inFlightSamples!);
    expect(m.dropped).toBe(m.droppedBeforeExport! + m.discardedUnconfirmed!);
    console.info(JSON.stringify({mode: c.mode, collector: m, backend: saved.monitoringBackend}));
  }
  const get = (mode: string) => f.cases.find(c => c.mode === mode)!;
  const a = get("pressure"), b = get("fast-export"), larger = get("larger-buffer");
  const baseline = readRunInputs(a.row.runInputs);
  for (const [candidate, field, original] of [[b, "exportIntervalSeconds", 3], [larger, "bufferSamples", 2]] as const) {
    const input = readRunInputs(candidate.row.runInputs);
    const policy = input.resources.find(r => r.id === "monitor")!.monitoringPolicy!;
    Object.assign(policy, {[field]: original});
    expect(input).toEqual(baseline); // exactly one supported control differed
  }
  expect(a.raw.generated).toBe(b.raw.generated);
  expect(a.raw.droppedBeforeExport).toBeGreaterThan(0); expect(b.raw.droppedBeforeExport).toBe(0);
  expect(a.raw.freshness[0]!.state).toBe(b.raw.freshness[0]!.state); // local freshness does not diagnose loss
  expect(larger.raw.droppedBeforeExport).toBeLessThan(a.raw.droppedBeforeExport);
  expect(larger.raw.exported).toBe(a.raw.exported); // more storage does not speed export
  expect(get("ambiguous").raw.discardedUnconfirmed).toBeGreaterThan(0);
  expect(get("ambiguous").backend.received).toBeGreaterThan(get("ambiguous").raw.exported);
  expect(get("retried").backend.duplicates).toBeGreaterThan(0);
  expect(get("in-flight").raw.inFlightBytes).toBeGreaterThan(0);
  expect(get("backend-full").backend.refused).toBeGreaterThan(0);
  expect(get("no-collection").raw.freshness[0]).toMatchObject({ageUs: null, measuredAt: null, state: "missing"});
  expect(get("no-collection").backend.latest).toEqual([]);
  expect(get("stale").raw.freshness[0]!.state).toBe("stale");
  expect(get("stale").raw.collectionFailures).toBeGreaterThan(0);
  expect(get("multiple").raw.freshness).toHaveLength(2);
  expect(f.missing.terminal!.resources.find(r => r.id === "monitor")!.monitoring).toBeUndefined();
  expect(f.nullAge.terminal!.resources.find(r => r.id === "monitor")!.monitoring!.freshness![0]!.ageUs).toBeNull();
  expect(f.unknown.terminal!.resources.find(r => r.id === "monitor")!.monitoringBackend!.received).toBeNull();
  for (const invalid of f.invalid) expect(invalid.terminal).toBeNull();
});

test("capture uses the compiled backend identity, refuses inference when absent and leaves live output untouched", () => {
  const input = captureRunInputs(monitoringLayout({version: 1, collectionIntervalSeconds: 1}), monitoringWorkload, "capture-owner");
  const run = createModel2Engine(input, 4); run.advance(); run.advance();
  const before = run.view(), evidence = run.evidence();
  const captured = monitoringSnapshot(before.metrics, run);
  expect(captured.monitor!.monitoringBackend!.id).toBe(evidence.systems.backends[0]!.id);
  expect(run.view()).toEqual(before); expect(run.evidence()).toEqual(evidence);
  expect(before.metrics.monitor).not.toHaveProperty("monitoringBackend");
  const missing = monitoringSnapshot(before.metrics, {...run, evidence: () => ({...evidence, systems: {...evidence.systems, backends: []}})});
  expect(missing.monitor!.monitoringBackend).toBeUndefined();
});

test("collectors with similar ids retain their own backend identities and independent arrival totals", () => {
  const layout = monitoringLayout({version: 1, collectionIntervalSeconds: 1, exportIntervalSeconds: 10});
  layout.resources.push({...layout.resources[1]!, id: "monitor-copy", monitoringPolicy: {version: 1, collectionIntervalSeconds: 1, exportIntervalSeconds: 1}});
  layout.connectionLines.push({...layout.connectionLines[0]!, id: "copy-edge", sourceId: "monitor-copy"});
  const input = captureRunInputs(layout, monitoringWorkload, "independent-monitor-owners");
  const run = createModel2Engine(input, 4);
  for (let i = 0; i < 4; i++) run.advance();
  const captured = monitoringSnapshot(run.view().metrics, run), e = run.evidence();
  for (const id of ["monitor", "monitor-copy"]) {
    const config = e.systemConfiguration.resources.find(r => r.id === id)!;
    if (config.kind !== "monitor") throw Error("Expected collector config");
    const backend = e.systems.backends.find(b => b.id === config.backend)!;
    expect(captured[id]!.monitoringBackend).toMatchObject({id: backend.id, received: backend.received});
  }
  expect(captured.monitor!.monitoringBackend!.received).toBe(0);
  expect(captured["monitor-copy"]!.monitoringBackend!.received).toBeGreaterThan(0);
  expect(captured.monitor!.monitoringBackend!.id).not.toBe(captured["monitor-copy"]!.monitoringBackend!.id);
});
