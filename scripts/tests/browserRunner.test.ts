import { expect, test } from "bun:test";
import { firstStackCompileFixture } from "../fixtures/first-stack-compile";
import { firstStackCacheFixture } from "../fixtures/first-stack-cache";
import { executeBrowser } from "../../apps/web/src/firstStack/worker/execute";
import { runFirstStackInBrowser } from "../../apps/web/src/firstStack/runner";
import { canonical, hash, browserLimits } from "../../apps/web/src/firstStack/protocol";
import pin from "../../apps/web/src/firstStack/enginePin.json";
import { canonical as serverCanonical, hash as serverHash } from "../../apps/backend/firstStack/canonical";
import { captureExecutionCut } from "../../apps/backend/firstStack/executionCut";
import { instantiatePreparedFirstStack } from "../../apps/backend/firstStack/execution";
import { inputDigest, cutFingerprint, readIsolatedCut, type IsolatedCut } from "../../apps/backend/firstStack/isolationProtocol";
import type { WorkerReply } from "../../apps/web/src/firstStack/protocol";
import { browserFixture } from "../fixtures/browser-runner";
import { captureBrowserReport } from "../../apps/web/src/firstStack/worker/reportCapture";
import { captureReport } from "../../apps/backend/firstStack/reportCapture";
import { replayFirstStackPrefix } from "../../apps/backend/firstStack/isolationReplay";
import { serverCases, fixtureRows } from "../browser-first-stack/oracle";
import serverResults from "../fixtures/browser-server-results.json";
test("browser canonical JSON and Unicode hashing match the server without normalizing data", async () => {
  const value = { z: "é\r\n🧪", a: [1, -0, null, { "__proto__": null }] };
  expect(canonical(value)).toBe(serverCanonical(value)); expect(await hash(value)).toBe(serverHash(value));
  expect(() => canonical({ large: "x".repeat(browserLimits.inputBytes) })).toThrow("byte budget");
  expect(() => canonical(new Array(100_001))).toThrow("collection budget");
  expect(() => canonical({ n: NaN })).toThrow("finite");
  const cycle: unknown[] = []; cycle.push(cycle); expect(() => canonical(cycle)).toThrow("acyclic");
});
for (const cache of [false, true]) test(`browser ${cache ? "cache" : "relational"} cut matches the current server cut including slice 12 report capture`, async () => {
  const request = await browserFixture(cache), f = cache ? await firstStackCacheFixture() : await firstStackCompileFixture(2, { shared: true });
  const prepared = f.prepare(), runtime = instantiatePreparedFirstStack(prepared); runtime.advanceTo(runtime.horizon);
  const oracle = captureExecutionCut(prepared, runtime, 1, { wallMs: 15000, cpuUs: 30000000, rssBytes: 536870912, frameBytes: 1048576, summaryBytes: 10485760, captureBytes: 33554432 }, null).value;
  const result = await executeBrowser(request);
  expect(result.status).toBe("completed"); const evidence = result.evidence!;
  expect(evidence.fingerprint).toBe(cutFingerprint(oracle));
  expect(evidence.cut.lock).toEqual(prepared.lock);
  expect(evidence.cut.reportCapture).toEqual(oracle.reportCapture!);
  expect(serverCanonical({ ...evidence.cut, effectiveLimits: null })).toBe(serverCanonical({ ...oracle, effectiveLimits: null }));
  expect(evidence.inputHash).toBe(inputDigest(serverCanonical(request.input)));
  expect(readIsolatedCut(evidence as unknown as IsolatedCut, pin.source, evidence.inputHash) === evidence as unknown).toBe(true);
  expect(evidence.cut.effectiveLimits.cpuUs).toBe("Unknown"); expect(result.memory.observedHeapBytes).toBe("Unknown");
  const changed = structuredClone(evidence); changed.cut.reportCapture.selection.omitted++;
  expect(() => readIsolatedCut(changed as unknown as IsolatedCut, pin.source, evidence.inputHash)).toThrow("fingerprint");
});
test("retained browser fixtures are fingerprints computed by the current server capture path", async () => {
  expect(serverCanonical(fixtureRows(await serverCases()))).toBe(serverCanonical(serverResults.cases));
});
test("report overflow matches the server's bounded Unknown fallback", async () => {
  expect(captureBrowserReport).toBe(captureReport);
  const f = await firstStackCompileFixture(), prepared = f.prepare(), runtime = instantiatePreparedFirstStack(prepared);
  runtime.advanceTo(runtime.horizon);
  const e = runtime.evidence(), oversized = { ...e, resources: { large: "x".repeat(256 * 1024) } as unknown as typeof e.resources };
  const oracle = captureReport(runtime, oversized), browser = captureBrowserReport(runtime, oversized);
  expect(browser).toEqual(oracle); expect(browser.saturation.cpu).toBeNull();
  expect(browser.events).toEqual([]); expect(browser.selection.omitted).toBe(runtime.journal.measure().retained);
  expect(browser.unknown).toEqual(["Diagnostic capture exceeded its byte budget; saturation and selected causes are Unknown"]);
  expect(browser.allocationUsage).toEqual(oracle.allocationUsage);
});

test("fixed host usage is unique across shared roles and survives process faults without provider data", async () => {
  const { firstStackFaultFixture } = await import("../fixtures/first-stack-faults");
  for (const fixture of [await firstStackCompileFixture(2, { shared: true }), await firstStackFaultFixture()]) {
    const runtime = instantiatePreparedFirstStack(fixture.prepare()); runtime.advanceTo(runtime.horizon);
    const capture = captureReport(runtime, runtime.evidence()), usage = capture.allocationUsage!;
    expect(usage.allocations.length).toBe(fixture.sidecar.placement.length);
    expect(new Set(usage.allocations.map(a => a.host)).size).toBe(usage.allocations.length);
    for (const a of usage.allocations) expect(a).toMatchObject({ fromUs: 0, toUs: runtime.horizon, instanceUs: runtime.horizon });
    expect(JSON.stringify(capture)).not.toContain("computeCost");
    expect(JSON.stringify(capture)).not.toContain("OnDemand");
  }
});
test("browser refuses mutated workload, wrong bundle identity and excessive budgets before runtime", async () => {
  const request = await browserFixture(); request.input.recording.rows[0]!.keys = ["cold"];
  await expect(executeBrowser(request)).rejects.toThrow("identity changed");
  const wrong = await browserFixture(); wrong.engine.source = "a".repeat(64);
  await expect(executeBrowser(wrong)).rejects.toThrow("pinned bundle");
  const large = await browserFixture(); large.input.policy.maxEvents = browserLimits.events + 1;
  await expect(executeBrowser(large)).rejects.toThrow("events budget");
  large.input.policy.maxEvents = 100000; large.input.policy.horizonUs = browserLimits.horizonUs + 1;
  await expect(executeBrowser(large)).rejects.toThrow("horizon budget");
  large.input.policy.horizonUs = 90000; large.wallMs = browserLimits.wallMs + 1;
  await expect(executeBrowser(large)).rejects.toThrow("lower the ceiling");
});
test("observed heap, wall time and cancellation stop before setup; event exhaustion retains an honest prefix", async () => {
  const request = await browserFixture();
  expect((await executeBrowser(request, { heap: () => browserLimits.heapBytes })).reason).toContain("heap");
  expect((await executeBrowser(request, { cancelled: () => true })).evidence).toBeNull();
  let now = 0;
  expect((await executeBrowser(request, { now: () => now += 20000 })).reason).toContain("wall");
  request.input.policy.maxEvents = 100;
  const prefix = await executeBrowser(request);
  expect(prefix.status).toBe("interrupted"); expect(prefix.evidence?.cut.completeness.horizonReached).toBe(false);
  expect(prefix.evidence?.cut.interruption).not.toBeNull();
  if (!prefix.evidence) throw Error("Missing event-budget prefix");
  const f = await firstStackCompileFixture(2, { shared: true }); f.policy.maxEvents = 100;
  const prepared = f.prepare(), runtime = instantiatePreparedFirstStack(prepared);
  expect(() => runtime.advanceTo(runtime.horizon)).toThrow("Event budget exhausted");
  const oracle = captureExecutionCut(prepared, runtime, 1, { wallMs: 15000, cpuUs: 30000000, rssBytes: 536870912,
    frameBytes: 1048576, summaryBytes: 10485760, captureBytes: 33554432 }, prefix.evidence.cut.interruption).value;
  expect(prefix.evidence.fingerprint).toBe(cutFingerprint(oracle));
  let cancelled = false;
  request.input.policy.maxEvents = 100000;
  const cooperative = await executeBrowser(request, { yield: async () => { cancelled = true; }, cancelled: () => cancelled });
  expect(cooperative.status).toBe("interrupted"); expect(cooperative.reason).toContain("cancelled");
  if (!cooperative.evidence) throw Error("Missing cancelled prefix");
  f.policy.maxEvents = 100000;
  const replay = await replayFirstStackPrefix(f.prepare(), cooperative.evidence as unknown as IsolatedCut, pin.source, cooperative.evidence.inputHash);
  expect(replay.kind).toBe("MatchesRecordedPrefix");
});
function workerPort() {
  return { onmessage: null as ((event: MessageEvent<WorkerReply>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null, onmessageerror: null as (() => void) | null,
    terminated: false, sent: "", postMessage(text: string) { this.sent = text; }, terminate() { this.terminated = true; } };
}
test("one disposable worker per page; cancel, crash, pre-abort and hard watchdog release it", async () => {
  const request = await browserFixture(), port = workerPort();
  const run = runFirstStackInBrowser(request, { worker: () => port });
  expect(() => runFirstStackInBrowser(request, { worker: workerPort })).toThrow("already running");
  expect(JSON.parse(port.sent)).toEqual(request); run.cancel();
  expect((await run.result).reason).toContain("cancelled"); expect(port.terminated).toBe(true);
  const crashed = workerPort(), crash = runFirstStackInBrowser(request, { worker: () => crashed });
  crashed.onerror!({} as ErrorEvent); expect((await crash.result).reason).toContain("failed"); expect(crashed.terminated).toBe(true);
  const controller = new AbortController(); controller.abort();
  const aborted = runFirstStackInBrowser(request, { signal: controller.signal, worker: () => { throw Error("Must not create"); } });
  expect((await aborted.result).reason).toContain("cancelled");
  const stuck = workerPort(), timeout = runFirstStackInBrowser({ ...request, wallMs: 5 }, { worker: () => stuck });
  expect((await timeout.result).reason).toContain("watchdog"); expect(stuck.terminated).toBe(true);
  const signal = new AbortController(), signalled = runFirstStackInBrowser(request, { signal: signal.signal, worker: workerPort });
  signal.abort(); expect((await signalled.result).reason).toContain("cancelled");
});
