import { expect, test } from "bun:test";
import { prepare, hash } from "./asyncCanvas.fixture";
import { capacitySetup } from "./queueCapacity.fixture";
import { eventBusDesign } from "./eventBus.fixture";
import { gatewayDesign } from "./apiGateway.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { withRunLength } from "../src/model2/product/runContract";
import { withTimeline } from "../src/model2/product/timeline";
import { createProductModel2 } from "../src/model2/product/run";
import type { SavedProductDesign } from "../src/model2/product/contracts";

function run(saved: SavedProductDesign) {
  const f = prepare(saved), c = compileProduct(saved, withRunLength(f.contract, 2, "bus-gateway-depth"));
  if (!c.ok) throw Error(JSON.stringify(c));
  const runtime = createProductModel2(c.value); runtime.advanceTo(2_000_000);
  return runtime.evidence();
}

test("delivery accounting separates publications, attempts, failed attempts, exhaustion and worker effects", () => {
  const healthy = eventBusDesign(), failed = structuredClone(healthy);
  failed.resources.find(r => r.id === "queue")!.listenerSettings = { version: 1, ports: [] };
  const a = run(healthy).asynchronous, b = run(failed).asynchronous;
  for (const e of [a, b]) {
    expect(e.eventBuses![0]!.accepted).toBe(4);
    expect(e.eventBuses![0]!.subscriptions[1]).toMatchObject({ accepted: 4, delivered: 4, deliveryAccounting: { attempts: 4, failedAttempts: 0, exhausted: 0 } });
  }
  expect(a.eventBuses![0]!.subscriptions[0]).toMatchObject({ delivered: 4, deliveryAccounting: { attempts: 4, failedAttempts: 0, exhausted: 0 } });
  expect(b.eventBuses![0]!.subscriptions[0]).toMatchObject({ delivered: 0, retried: 8, deadLettered: 4, deliveryAccounting: { attempts: 12, failedAttempts: 12, exhausted: 4 } });
  expect(a.workers.map(w => w.effects)).toEqual([4, 4]);
  expect(b.workers.map(w => w.effects)).toEqual([0, 4]);
});

test("regression: changing one saved filter changes only its downstream queue and worker", () => {
  const healthy = eventBusDesign(), filtered = structuredClone(healthy);
  filtered.resources.find(r => r.id === "bus")!.eventBus!.subscriptions = [{ id: "e2", edge: "e2", filter: { keyPrefix: "never" } }, { id: "e3", edge: "e3" }];
  const a = run(healthy).asynchronous, b = run(filtered).asynchronous;
  expect(a.workers.map(w => w.effects)).toEqual([4, 4]); expect(b.workers.map(w => w.effects)).toEqual([0, 4]);
  expect(a.brokers.map(q => q.accepted)).toEqual([4, 4]); expect(b.brokers.map(q => q.accepted)).toEqual([0, 4]);
  expect(b.eventBuses![0]!.subscriptions[0]).toMatchObject({ filtered: 4, accepted: 0 });
  expect(a.eventBuses![0]!.subscriptions[1]).toEqual(b.eventBuses![0]!.subscriptions[1]);
});

test("regression: a slow subscriber retains pending work while the other worker completes", () => {
  const d = eventBusDesign(), f = prepare(d), base = withRunLength(f.contract, 2, "slow-subscriber-proof");
  const links = f.compiled.input.paths.find(p => p.source === "bus" && p.target === "queue")!.request;
  const delayed = withTimeline(base, [{ id: "slow-subscriber", kind: "network-delay", links, atUs: 0, durationUs: 2_000_000, delayUs: 1_500_000 }]);
  const results = [base, delayed].map(contract => {
    const c = compileProduct(d, contract); if (!c.ok) throw Error(JSON.stringify(c));
    const runtime = createProductModel2(c.value); runtime.advanceTo(2_000_000); return runtime.evidence().asynchronous;
  });
  expect(results[0]!.eventBuses![0]!.subscriptions[0]!.pending).toBe(0);
  expect(results[1]!.eventBuses![0]!.subscriptions[0]!.pending).toBeGreaterThan(0);
  expect(results[1]!.eventBuses![0]!.subscriptions[1]).toEqual(results[0]!.eventBuses![0]!.subscriptions[1]);
  expect(results[1]!.workers[1]!.effects).toBe(4);
});

test("per-route outcomes and measured duration follow actual accepted upstream work", () => {
  const a = run(gatewayDesign(1)), b = run(gatewayDesign(100));
  const small = a.asynchronous.gateways![0]!, large = b.asynchronous.gateways![0]!;
  expect(small.routes[0]).toMatchObject({ admitted: 2, rejected: 8, outcomes: { matched: 10, completed: 2, pending: 0, settled: 2 } });
  expect(large.routes[0]).toMatchObject({ admitted: 10, rejected: 0, outcomes: { matched: 10, completed: 10, pending: 0, settled: 10 } });
  expect(small.routes[1]).toEqual(large.routes[1]);
  expect(small.routes[0]!.outcomes.totalDurationUs).toBeGreaterThan(0);
  expect(small.routes[0]!.outcomes.maxDurationUs).toBeGreaterThan(0);
  for (const e of [a, b]) for (const route of e.asynchronous.gateways![0]!.routes) {
    expect(route.outcomes.completed).toBe(e.resources.find(r => r.id === route.target)!.completed);
  }
});

test("regression with route evidence: raising admission saturates the real bounded upstream", () => {
  const small = gatewayDesign(1), large = gatewayDesign(10000);
  for (const d of [small, large]) {
    d.workload.targetThroughput = 120000;
    d.resources[0]!.apiGateway!.routes![0]!.requestsPerSecond = 1;
    d.resources[1]!.vmExecution = { version: 1, workers: 1, queuedRequests: 0 };
  }
  const a = run(small), b = run(large), low = a.asynchronous.gateways![0]!, high = b.asynchronous.gateways![0]!;
  const appA = a.resources.find(r => r.id === "readApp")!, appB = b.resources.find(r => r.id === "readApp")!;
  expect(high.admitted).toBeGreaterThan(low.admitted);
  expect(appB.rejected).toBeGreaterThan(appA.rejected);
  expect(high.routes[0]!.outcomes.upstreamFailed).toBeGreaterThan(low.routes[0]!.outcomes.upstreamFailed);
  expect(high.routes[0]!.outcomes.upstreamFailed).toBe(appB.rejected);
  // Both routes share gateway command CPU; their budgets remain independent.
  expect(high.routes[1]).toMatchObject({ admitted: low.routes[1]!.admitted, rejected: low.routes[1]!.rejected, outcomes: { completed: low.routes[1]!.outcomes.completed, upstreamFailed: 0 } });
});

test("route duration responds to actual upstream CPU delay under identical traffic", () => {
  const normal = gatewayDesign(100), constrained = structuredClone(normal);
  for (const d of [normal, constrained]) d.resources[0]!.apiGateway!.upstreamTimeoutMs = 5000;
  constrained.resources[1]!.vmCpuQuota = { version: 1, limitPercent: 1 };
  const a = run(normal).asynchronous.gateways![0]!, b = run(constrained).asynchronous.gateways![0]!;
  expect(b.routes[0]!.admitted).toBe(a.routes[0]!.admitted);
  expect(b.routes[0]!.outcomes.maxDurationUs).toBeGreaterThan(a.routes[0]!.outcomes.maxDurationUs);
  expect(b.routes[0]!.outcomes.totalDurationUs / b.routes[0]!.outcomes.settled).toBeGreaterThan(a.routes[0]!.outcomes.totalDurationUs / a.routes[0]!.outcomes.settled);
  expect(b.routes[1]).toEqual(a.routes[1]);
});

// Captured on the untouched busgw baseline; LF-normalized JSON. Never regenerate.
test("regression: designs without bus or gateway settings retain all recorded bytes", () => {
  const f = capacitySetup(); f.runtime.advanceTo(70_000_000);
  expect([hash(f.contract), hash(f.compiled.input), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual([
    "82a9673cb4b36f8a2c5fe4d3d2ee13b6d372555602ed45441d327fec578e9c4f",
    "72f03c8f8a5867f9a905b9abc46a967bcd0e0071012620d81eff318132febdf1",
    "fde40806e9d0323e26c114c1bfa80166dd32ac18143f4be8be149f64c85aad03",
    "813b1d20bc65c2a53b60e496d2b8b2d68e84c8a682d8b7ead4300cbe1e5a10c1",
  ]);
});
