import { expect, test } from "bun:test";
import { EventKernel } from "../src/model2/time";
import { serverless } from "../src/model2/serverless/run";
import { functionConfig, us, count } from "./serverless.fixture";
import type { Invocation, RemoteOutcome } from "../src/model2/workload/contracts";
import type { Deliver } from "../src/model2/compute/run";
const invocation = (id: string): Invocation => ({ rootId: JSON.stringify([id]), callId: JSON.stringify([id]), operation: "read", attempt: 0, offeredAt: 0 });
const unused: Deliver = () => { throw Error("Unexpected downstream"); };
test("cold initialization, warm reuse and expiry are distinct per-invocation lifecycles", () => {
  const clock = new EventKernel(10000), service = serverless(functionConfig(), clock, unused, "function-proof");
  const results: Array<[number, RemoteOutcome]> = [];
  service.accept(invocation("cold"), o => results.push([clock.now, o])); clock.advanceTo(20000);
  service.accept(invocation("warm"), o => results.push([clock.now, o])); clock.advanceTo(30000);
  expect(results).toEqual([[20000, "completed"], [30000, "completed"]]);
  expect(service.evidence()).toMatchObject({ coldStarts: 1, warmStarts: 1, initialized: 1, instances: 1, expired: 0, active: 0 });
  clock.advanceTo(80000); expect(service.evidence()).toMatchObject({ instances: 0, expired: 1 });
  service.accept(invocation("expired"), o => results.push([clock.now, o])); clock.advanceTo(100000);
  expect(service.evidence()).toMatchObject({ coldStarts: 2, warmStarts: 1, completed: 3 });
});
test("scale-out respects concurrency and throttles immediately without a hidden queue", () => {
  const clock = new EventKernel(10000), service = serverless(functionConfig(), clock, unused, "function-proof");
  const outcomes: RemoteOutcome[] = [];
  for (let n = 0; n < 5; n++) service.accept(invocation(String(n)), o => outcomes.push(o));
  expect(service.evidence()).toMatchObject({ active: 2, instances: 2, coldStarts: 2, scaleOut: 1, throttled: 3, peakInstances: 2 });
  clock.advanceTo(100000); expect(outcomes).toHaveLength(5); expect(service.evidence()).toMatchObject({ completed: 2, active: 0, instances: 0 });
  expect(clock.pending).toBe(0);
});
test("timeout cancels the owned downstream once and ignores ambiguous late completion", () => {
  const clock = new EventKernel(10000); let cancelled = 0, terminals = 0;
  const send: Deliver = (_t, w, done) => { clock.schedule(clock.now + 100000, 2, w.callId, () => done("completed")); return { admitted: true, state: () => "serving", cancel: () => { cancelled++; return "unsupported"; } }; };
  const service = serverless(functionConfig({ database: "db", timeout: us(30000) }), clock, send, "function-proof");
  service.accept(invocation("timeout"), () => terminals++); clock.advanceTo(200000);
  expect(service.evidence()).toMatchObject({ timedOut: 1, completed: 0, active: 0, instances: 0 });
  expect(terminals).toBe(1); expect(cancelled).toBe(1); expect(clock.pending).toBe(0);
});
test("seeded invocation failure is reproducible and independent of evidence reads", () => {
  const run = (reads: boolean) => {
    const clock = new EventKernel(10000), config = functionConfig({ concurrency: count(128), initialization: us(0) });
    config.failurePercent = { kind: "known", unit: "percent", provenance: ["test"], value: 35 };
    const service = serverless(config, clock, unused, "function-seed");
    for (let n = 0; n < 100; n++) { service.accept(invocation(String(n)), () => {}); if (reads) service.evidence(); }
    clock.advanceTo(100000); return service.evidence();
  };
  const evidence = run(false); expect(run(true)).toEqual(evidence); expect(evidence.failed).toBeGreaterThan(0); expect(evidence.completed).toBeGreaterThan(0); expect(evidence.failed + evidence.completed).toBe(100);
});
test("cancellation and unavailable service settle each admitted invocation once", () => {
  const clock = new EventKernel(10000), service = serverless(functionConfig(), clock, unused, "function-proof"); let terminals = 0;
  const receipt = service.accept(invocation("cancel"), () => terminals++); expect(receipt.cancel()).toBe("cancelled"); expect(receipt.cancel()).toBe("already-finished");
  service.accept(invocation("pause"), () => terminals++); service.pause(true); service.accept(invocation("unavailable"), () => terminals++); clock.advanceTo(200000);
  expect(terminals).toBe(3); expect(service.evidence()).toMatchObject({ cancelled: 1, failed: 1, unavailable: 1, active: 0, instances: 0 });
});
test("long invocation streams bound warm instances, timers and retained event rows", () => {
  const clock = new EventKernel(20000), service = serverless(functionConfig({ initialization: us(0), duration: us(1000) }), clock, unused, "function-proof");
  for (let n = 0; n < 3000; n++) { service.accept(invocation(String(n)), () => {}); clock.advanceTo((n + 1) * 2000); }
  expect(service.evidence()).toMatchObject({ instances: 1, active: 0, peakInstances: 1, completed: 3000 });
  expect(service.evidence().events).toHaveLength(2048); expect(service.evidence().omitted).toBeGreaterThan(0); expect(clock.pending).toBe(1);
  clock.advanceTo(clock.now + 50000); expect(clock.pending).toBe(0);
});
