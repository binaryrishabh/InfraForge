import { expect, test } from "bun:test";
import { prepare, design, hash } from "./asyncCanvas.fixture";
import { functionDesign } from "./serverlessCanvas.fixture";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { compileProduct } from "../src/model2/product/compiler";
import { withRunLength } from "../src/model2/product/runContract";
import { createProductModel2 } from "../src/model2/product/run";

function timerDesign(): SavedProductDesign {
  return { ...design(false), resources: [{ id: "app", type: "Virtual Machine", x: 0, y: 0 }, { id: "timer", type: "Scheduler", x: 0, y: 0, scheduler: { version: 1, periodMs: 10, maxTriggers: 100 } }], connections: [{ id: "tick", sourceId: "timer", targetId: "app", sourceType: "Scheduler", targetType: "Virtual Machine", port: 80 }] };
}
function run(saved: SavedProductDesign) {
  const f = prepare(saved), c = compileProduct(saved, withRunLength(f.contract, 2, "schedfn-depth"));
  if (!c.ok) throw Error(JSON.stringify(c));
  const runtime = createProductModel2(c.value); runtime.advanceTo(2_000_000); return runtime;
}

test("scheduler accounting distinguishes original starts, failed attempts and retries under downstream failure", () => {
  const healthy = timerDesign(); healthy.workload.targetThroughput = 60;
  healthy.resources[1]!.scheduler!.overlap = "allow";
  healthy.resources[1]!.scheduler!.maxConcurrent = 128;
  const failed = structuredClone(healthy);
  failed.resources[0]!.listenerSettings = { version: 1, ports: [] };
  const a = run(healthy), b = run(failed);
  expect(a.inspectScheduler("timer")!.attemptAccounting).toMatchObject({ started: 100, failedAttempts: 0, timedOutAttempts: 0, pendingAttempts: 0, retryWaiting: 0 });
  expect(b.inspectScheduler("timer")!.attemptAccounting).toMatchObject({ started: 100, failedAttempts: 300, timedOutAttempts: 0, pendingAttempts: 0, retryWaiting: 0 });
  expect(b.inspectScheduler("timer")).toMatchObject({ due: 100, fired: 300, retried: 200, failed: 100, completed: 0 });
  expect(a.inspect("app")!.completed).toBeGreaterThan(b.inspect("app")!.completed);
  expect(run(failed).inspectScheduler("timer")).toEqual(b.inspectScheduler("timer"));
});

test("scheduler queue delay measures real starts when bounded execution capacity changes", () => {
  const normal = timerDesign(), slow = structuredClone(normal);
  for (const d of [normal, slow]) d.resources[1]!.scheduler = { version: 1, periodMs: 10, maxTriggers: 20, overlap: "queue", queueCapacity: 128, maxLatenessMs: 2000 };
  slow.resources[0]!.vmCpuQuota = { version: 1, limitPercent: 10 };
  const a = run(normal).inspectScheduler("timer")!, b = run(slow).inspectScheduler("timer")!;
  expect(b.attemptAccounting.delayedStarts).toBeGreaterThan(a.attemptAccounting.delayedStarts);
  expect(b.attemptAccounting.totalStartDelayUs).toBeGreaterThan(a.attemptAccounting.totalStartDelayUs);
  expect(b.attemptAccounting.maxStartDelayUs).toBeGreaterThan(a.attemptAccounting.maxStartDelayUs);
  expect(a.completed).toBe(20); expect(b.completed).toBe(20);
});

test("function lifecycle duration follows saved initialization while downstream work stays real", () => {
  const normal = functionDesign(4), cold = structuredClone(normal);
  for (const d of [normal, cold]) { d.workload.targetThroughput = 60; d.resources[0]!.serverless!.idleExpiryMs = 5000; }
  cold.resources[0]!.serverless!.initializationMs = 300;
  const a = run(normal).inspectFunction("fn")!, b = run(cold).inspectFunction("fn")!;
  expect(a.completed).toBe(2); expect(b.completed).toBe(2);
  expect(b.lifecycle.initializationUs - a.lifecycle.initializationUs).toBe(290000);
  expect(b.lifecycle.executionUs).toBe(a.lifecycle.executionUs);
  expect(b.lifecycle.downstreamUs).toBe(a.lifecycle.downstreamUs);
  expect(a.lifecycle.downstreamUs).toBeGreaterThan(0);
  expect(b.lifecycle.totalDurationUs - a.lifecycle.totalDurationUs).toBe(290000);
  for (const f of [a, b]) {
    expect(f.lifecycle.settled).toBe(2);
    expect(f.lifecycle.busyUs).toBe(f.lifecycle.initializationUs + f.lifecycle.executionUs + f.lifecycle.downstreamUs);
  }
});

test("regression with lifecycle evidence: burst invokes cold bounded instances, throttles and pressures database sessions", () => {
  const small = functionDesign(1), large = functionDesign(128);
  const runBurst = (d: SavedProductDesign) => {
    const f = prepare(d), contract = withRunLength(f.contract, 1, "schedfn-burst");
    contract.interventions = [{ id: "sessions", atUs: 0, request: { interventionId: "session-capacity", revision: 1, target: { resourceId: "db" }, parameters: { sessions: 8, duration: 1 } } }];
    const c = compileProduct(d, contract); if (!c.ok) throw Error(JSON.stringify(c));
    const r = createProductModel2(c.value); r.advanceTo(999999); return { fn: r.inspectFunction("fn")!, db: r.inspectData.database("db")! };
  };
  const a = runBurst(small), b = runBurst(large);
  expect(a.fn.throttled).toBeGreaterThan(0); expect(b.fn.throttled).toBeGreaterThan(0);
  expect(a.fn.peakInstances).toBe(1); expect(b.fn.peakInstances).toBe(128);
  expect(b.fn.coldStarts).toBeGreaterThan(a.fn.coldStarts);
  expect(a.db.sessionEvents!.refused).toBe(0); expect(b.db.sessionEvents!.refused).toBeGreaterThan(0);
  expect(b.fn.downstreamFailed).toBeGreaterThan(0);
  expect(b.fn.lifecycle.initializationUs).toBeGreaterThan(a.fn.lifecycle.initializationUs);
  expect(runBurst(large)).toEqual(b);
});

test("regression with accounting: function timeout forces bounded scheduler retries and new cold instances", () => {
  const runTimeout = (timeoutMs: number) => {
    const d = functionDesign(4); d.workload.targetThroughput = 60;
    d.resources[0]!.serverless!.timeoutMs = timeoutMs;
    d.resources.push({ id: "timer", type: "Scheduler", x: 0, y: 0, scheduler: { version: 1, startMs: 300, periodMs: 0, maxAttempts: 3, retryDelayMs: 100 } });
    d.connections.push({ id: "tick", sourceId: "timer", targetId: "fn", sourceType: "Scheduler", targetType: "Serverless Function", port: 443 });
    const r = run(d); return { timer: r.inspectScheduler("timer")!, fn: r.inspectFunction("fn")!, db: r.inspectData.database("db")! };
  };
  const healthy = runTimeout(2000), timeout = runTimeout(1);
  expect(healthy.timer).toMatchObject({ completed: 1, retried: 0, attemptAccounting: { started: 1, failedAttempts: 0 } });
  expect(timeout.timer).toMatchObject({ failed: 1, retried: 2, fired: 3, attemptAccounting: { started: 1, failedAttempts: 3 } });
  expect(timeout.fn.coldStarts).toBeGreaterThan(healthy.fn.coldStarts);
  expect(timeout.fn).toMatchObject({ timedOut: 5, initialized: 0, downstreamCalls: 0, lifecycle: { initializationUs: 5000, executionUs: 0, downstreamUs: 0 } });
  expect(healthy.fn.downstreamCalls).toBe(3);
});

// Captured from the untouched schedfn baseline; LF-normalized JSON. Never regenerate.
test("regression: unconfigured designs and historical scheduler/function captures retain recorded bytes", () => {
  const expected = [
    ["7f91fddd4dd760a224607471d6ca343c22dfccc7f328e2dc6d9e700400b177ca", "0f74045c79c5519d2875fc7a4199894e905b074629f1934dc9da3fcefeb7fd05", "a34ebfbdb61243f406ebc7e95c39274e2994fddaba4eb4786164abf887d67dc2", "e255e4eb4249302dbf3c04d6c0c3050bd85853e84789db72d883a170c2bb33bc"],
    ["0f40c82fca9afd3e43c3a2832d858954db115d3c4f814ae7639d7cae65f27bca", "dc20dfbe1c62d1f523a79a062679fdb4dfdb459ce870d317d19cec4e65a1b61e", "74aa155140cc9dc62c4f1d65c71b4481f39e77d18a27bf13524e7bbfebb357de", "e88ede6a8fb4f9c15e9ef06c48dc6003bca7195b9931772a32cbeb474995680b"],
    ["522a6bd05a1256461820d402884a9146307f444c45fa3791c67ec6e1eb99594b", "cab8aedc9a2c5278c35f51d3168633765f8d61773acd74b0df1b7a86609db27d", "8476ecc1084e9f5a0a91cc878d17b98e9ac59cd817d24779df515f3993087001", "18e55c6271cb07d012e0298c54915ab71b0a06541576e9a8045042ba1cf659d5"],
  ];
  [design(false), timerDesign(), functionDesign()].forEach((d, i) => {
    const f = prepare(d), runtime = createProductModel2(f.compiled); runtime.advanceTo(2_000_000);
    expect([hash(f.contract), hash(f.compiled.input), hash(f.assumptions), hash(runtime.evidence())]).toEqual(expected[i]!);
  });
});
