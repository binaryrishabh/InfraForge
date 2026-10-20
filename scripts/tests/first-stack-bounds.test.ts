import { afterAll, expect, test } from "bun:test";
import { verticalFixture } from "../../packages/simulation/tests/networkFixture";
import { createNetworkModel2 } from "../../packages/simulation/src/model2/network/run";
import { EventKernel, utf8Bytes, micros } from "../../packages/simulation/src/model2/time";
import { ResultBook } from "../../packages/simulation/src/model2/workload/evidence";
import { boundedJson, firstStackPreflight } from "../../packages/simulation/src/firstStack/bounds";
import { diagnosticJournal } from "../../packages/simulation/src/firstStack/journal";
import { createFirstStackRuntime } from "../../packages/simulation/src/firstStack/run";
import { verifyBoundsProof } from "../reality/first-stack-bounds-proof";
import { firstStackCompileFixture } from "../fixtures/first-stack-compile";

afterAll(() => { Bun.gc(true); });

test("equal-time slices preserve ordering and the unfinished timestamp", () => {
  const full = new EventKernel(100), sliced = new EventKernel(100), a: number[] = [], b: number[] = [];
  for (let i = 9; i >= 0; i--) for (const [k, rows] of [[full, a], [sliced, b]] as const) k.schedule(10, i % 2, String(i), () => rows.push(i));
  full.advanceTo(20);
  expect(sliced.advanceSlice(20, 3)).toBe(false); expect(sliced.now).toBe(micros(10)); expect(sliced.processed).toBe(3);
  while (!sliced.advanceSlice(20, 3)) { /* finite event budget */ }
  expect(b).toEqual(a); expect(sliced.now).toBe(micros(20));
});

test("pending and cumulative budgets contain fan-out and cancellation", () => {
  const k = new EventKernel(30, 3), cancel = k.schedule(0, 0, "start", () => {});
  expect(cancel()).toBe(true); expect(cancel()).toBe(false);
  k.schedule(0, 0, "fan", () => { for (let i = 0; i < 4; i++) k.schedule(0, 0, `child${i}`, () => {}); });
  expect(() => k.advanceSlice(1, 2)).toThrow("pending-event budget"); expect(k.pending).toBe(3);
  const cumulative = new EventKernel(3);
  const again = () => cumulative.schedule(0, 0, "loop", again); again();
  expect(() => cumulative.advanceSlice(1, 4)).toThrow("Event budget"); expect(cumulative.processed).toBe(3);
});

test("raw/journal omissions preserve every histogram observation and reducer cardinality is bounded", () => {
  const full = new ResultBook(200), reduced = new ResultBook(0, 1, 4), journal = diagnosticJournal(128);
  for (let i = 0; i < 200; i++) {
    const row = { rootId: String(i), callId: String(i), operation: "read", attempt: 0, offeredAt: 0, at: i, responseUs: i, outcome: "completed" as const };
    full.record(row); reduced.record(row);
    journal.record({ atUs: i, resource: "db", kind: "terminal", detail: { text: "x".repeat(50) } });
  }
  expect(reduced.raw).toHaveLength(0);
  expect(reduced.summary()[0]!.histogram).toEqual(full.summary()[0]!.histogram);
  expect(reduced.summary()[0]!.count).toBe(200);
  expect(journal.measure()).toMatchObject({ observed: 200, complete: false });
  expect(Buffer.byteLength(journal.content())).toBeLessThanOrEqual(128);
  expect(() => new ResultBook(0, 1, 0).record({ rootId: "r", callId: "c", attempt: 0, operation: "new", offeredAt: 0, at: 1, responseUs: 1, outcome: "completed" })).toThrow("cardinality");
});

test("serializer bounds UTF-8, escaping, object expansion and cycles", () => {
  const value = { text: "\u{1f600}\u0000\n\"".repeat(1000), rows: [1, true, null] };
  const exact = JSON.stringify(value), bytes = Buffer.byteLength(exact);
  for (const text of ["ascii", "\u00e9", "\u{1f600}", "\ud800", "\udc00", "\u0800"]) expect(utf8Bytes(text)).toBe(new TextEncoder().encode(text).byteLength);
  expect(boundedJson(value, bytes)).toBe(exact);
  expect(() => boundedJson(value, bytes - 1)).toThrow("byte budget");
  expect(() => boundedJson("\u0000".repeat(1_000_000), 1000)).toThrow("byte budget");
  const cycle: unknown[] = []; cycle.push(cycle);
  expect(() => boundedJson(cycle, 1000)).toThrow("Cyclic");
});

test("preflight rejects probes, queues, dictionary and semantic expansion; RSS forecast stays Unknown", async () => {
  const f = await firstStackCompileFixture();
  expect(firstStackPreflight(f.sidecar, f.schedule, f.policy).rssForecast.kind).toBe("unknown");
  f.sidecar.balancer.intervalUs = 1;
  expect(() => firstStackPreflight(f.sidecar, f.schedule, f.policy)).toThrow("health probes");
  f.sidecar.balancer.intervalUs = 100000; f.sidecar.nodes[0]!.queue = 10001;
  expect(() => firstStackPreflight(f.sidecar, f.schedule, f.policy)).toThrow("live-state");
  f.sidecar.nodes[0]!.queue = 1;
  f.sidecar.database.keys = Array.from({ length: 5000 }, (_, i) => `${i}${"x".repeat(252)}`);
  expect(() => firstStackPreflight(f.sidecar, f.schedule, f.policy)).toThrow("dictionary");
  f.sidecar.sources = ["\u0000".repeat(3_000_000)];
  expect(() => firstStackPreflight(f.sidecar, f.schedule, f.policy)).toThrow("serialization");
});

test("1/2/4/8 apps preserve counts and histograms with slices and raw omissions", async () => {
  for (const apps of [1, 2, 4, 8]) {
    const f = await firstStackCompileFixture(apps);
    const full = createFirstStackRuntime(f.sidecar, f.schedule, f.policy); full.advanceTo(full.horizon);
    const reduced = createFirstStackRuntime(f.sidecar, f.schedule, { ...f.policy, maxRawResults: 0 });
    while (!reduced.advanceSlice(reduced.horizon, 7)) { /* bounded fixture */ }
    const a = full.evidence(), b = reduced.evidence();
    expect(b.counts).toEqual(a.counts); expect(b.execution).toEqual(a.execution);
    expect(b.distributions.groups.map(g => g.histogram)).toEqual(a.distributions.groups.map(g => g.histogram));
    expect(b.resultRetention).toMatchObject({ retained: 0, omitted: 24 });
    expect(b.capture.reachedHorizon).toBe(true);
  }
});

test("retained sample prefix is finite while cumulative counts remain complete", async () => {
  const f = await firstStackCompileFixture();
  const runtime = createFirstStackRuntime(f.sidecar, f.schedule, { ...f.policy, sampleIntervalUs: 100, maxSamples: 1000 });
  runtime.advanceTo(runtime.horizon); const e = runtime.evidence();
  expect(e.samples).toHaveLength(128); expect(e.sampleRetention?.omitted).toBe(773);
  expect(e.counts.completed).toBe(24); expect(e.distributions.censored).toBe(0);
});

test("fresh bounds proof retains the original eight composition replays", async () => {
  expect(await verifyBoundsProof()).toEqual({ cases: 4, historicalCompositions: 8 });
});

test("LB health exchanges share the same live-call guard as foreground and child work", () => {
  const input = verticalFixture({ horizon: 20000 });
  input.limits.maxLiveCalls = 1;
  const runtime = createNetworkModel2(input);
  expect(() => runtime.advanceTo(runtime.horizon)).toThrow("live-call budget");
  expect(runtime.evidence().capture.reachedHorizon).toBe(false);
});

test("a slice at the horizon with equal-time work remaining never claims the horizon is complete", async () => {
  const f = await firstStackCompileFixture();
  const runtime = createFirstStackRuntime(f.sidecar, f.schedule, { ...f.policy, horizonUs: 5000 });
  let e = runtime.evidence();
  while (e.capture.throughUs < 5000) { runtime.advanceSlice(runtime.horizon, 1); e = runtime.evidence(); }
  expect(e.capture.timestampComplete).toBe(false); expect(e.capture.reachedHorizon).toBe(false);
  while (!runtime.advanceSlice(runtime.horizon, 1)) { /* finite same-time arrivals */ }
  expect(runtime.evidence().capture.reachedHorizon).toBe(true);
});

test("isolated bounded executor verifies durable cuts, cancellation and resource/output interruption", () => {
  // The RSS budget belongs to a worker, not the accumulated tooling-test host.
  Bun.gc(true);
  const child = Bun.spawnSync([process.execPath, "--no-env-file", "--no-install", "test", "./scripts/fixtures/first-stack-bounded-execution.test.ts"], { stdout: "pipe", stderr: "pipe", timeout: 60000 });
  if (child.exitCode !== 0) throw Error(child.stderr.toString() + child.stdout.toString());
  expect(child.exitCode).toBe(0);
  expect(child.stderr.toString()).toContain("4 pass");
}, 65000);
