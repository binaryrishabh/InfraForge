import { expect, test } from "bun:test";
import { depthSetup } from "./firewallDepth.fixture";
import { denyNew, firewallDesign } from "./firewallCapacity.fixture";
import type { CausalEvent } from "../src/model2/workload/causal";
import { securityDesign, prepareSecurity } from "./securityCanvas.fixture";
import { createProductModel2 } from "../src/model2/product/run";
import { quantities } from "./workloadFixture";
import { createLiveModel2 } from "../src/model2/product/live";

function slow(idle: number, rules: boolean) {
  const f = depthSetup(idle), i = f.compiled.input, q = quantities();
  for (const a of i.arrivals) if (a.kind === "trace") a.trace.rows = a.trace.rows.slice(0, 1);
  const demand = i.profiles.find(p => p.operation === "read")!;
  if (demand.schema !== "infraforge-compute-demand/1") throw Error("Expected compute demand");
  demand.blockingWait = q.q("slow.wait", 1500000, "us");
  if (rules) i.systems.interventions.push({ id: "deny", kind: "firewall-rules", target: "firewall", at: q.q("slow.deny", 500000, "us"), rules: [denyNew(q)] });
  i.ledger.push(...q.ledger);
  return { ...f, runtime: createProductModel2(f.compiled) };
}

test("an outstanding request survives rule changes until idle expiry, then its response is refused", () => {
  const short = slow(1, true), long = slow(2, true);
  for (const f of [short, long]) f.runtime.advanceTo(1000000);
  for (const f of [short, long]) expect(f.runtime.evidence().counts.inFlight).toBe(1);
  for (const f of [short, long]) f.runtime.advanceTo(2000000);
  expect(short.runtime.evidence().counts).toMatchObject({ completed: 0, rejected: 1, inFlight: 0 });
  expect(short.runtime.evidence().systems.security.policies[0]).toMatchObject({ expired: 1, expiredReturns: 1, returnExchanges: 0 });
  expect(long.runtime.evidence().counts).toMatchObject({ completed: 1, rejected: 0, inFlight: 0 });
  expect(long.runtime.evidence().systems.security.policies[0]).toMatchObject({ expired: 0, expiredReturns: 0, returnExchanges: 1 });
});

test("capacity alone changes refusals, backend deliveries and completed requests in the real engine", () => {
  const run = (capacity: number) => {
    const saved = firewallDesign("front", capacity); saved.workload.targetThroughput = 60000;
    saved.resources.find(r => r.id === "firewall")!.firewallState = { version: 1, idleTimeoutSeconds: 1 };
    const f = prepareSecurity(saved), i = f.compiled.input;
    for (const p of i.paths) p.pool.reuse = false;
    for (const a of i.arrivals) if (a.kind === "trace") a.trace.rows = a.trace.rows.slice(0, 100);
    const runtime = createProductModel2(f.compiled); runtime.advanceTo(1000000); return runtime.evidence();
  };
  const small = run(1), large = run(2), a = small.systems.security.policies[0]!, b = large.systems.security.policies[0]!;
  expect(a.capacityRefused).toBeGreaterThan(b.capacityRefused!);
  expect(small.counts.completed).toBeLessThan(large.counts.completed);
  expect(small.network.paths.find(p => p.id === "external-entry")!.reasons["flow-capacity"]).toBe(a.capacityRefused!);
  for (const [e, p] of [[small, a], [large, b]] as const) {
    expect(e.counts.offered).toBe(100);
    expect(e.counts.offered).toBe(e.counts.completed + e.counts.rejected);
    expect(p.opened).toBe(p.closed + p.expired! + p.flows.length);
    expect(e.systems.security.edges!.find(e => e.path === "external-entry")!.backendDeliveries).toBe(e.counts.completed);
  }
  console.info("firewall-state-capacity-causal", JSON.stringify({ small: { refused: a.capacityRefused, completed: small.counts.completed }, larger: { refused: b.capacityRefused, completed: large.counts.completed } }));
});

test("live firewall readings expose aggregate refusal and expiry even when detail rows are omitted", () => {
  const f = slow(1, false); f.compiled.input.limits.maxTraceRows = 1;
  const live = createLiveModel2(f.compiled, f.saved.resources.map(r => r.id)); live.advanceSecond(); live.advanceSecond();
  expect(live.project().metrics.firewall!.security!.firewall).toMatchObject({ expired: 1, expiredReturns: 1, "flow-capacity": 0 });
  expect(live.project().metrics.firewall!.health).toBe("unknown");
});


test("database-side policy denial and unreachability remain distinct at the upstream caller", () => {
  for (const denied of [true, false]) {
    const saved = securityDesign(); saved.resources.find(r => r.id === "firewall")!.firewallState = { version: 1, idleTimeoutSeconds: 1 };
    if (denied) saved.resources.find(r => r.id === "firewall")!.firewallSettings = { version: 1, default: "deny", rules: [] };
    const f = prepareSecurity(saved), i = f.compiled.input, events: CausalEvent[] = [];
    if (!denied) i.endpoints.db!.ready = false;
    for (const a of i.arrivals) if (a.kind === "trace") a.trace.rows = a.trace.rows.slice(0, 1);
    const runtime = createProductModel2(f.compiled, undefined, e => events.push(e)); runtime.advanceTo(1000000);
    const e = runtime.evidence();
    expect(e.counts).toMatchObject({ offered: 1, completed: 0, rejected: 1 });
    expect(e.data.databases[0]!.transactions.committed).toBe(0);
    expect(e.systems.security.edges!.find(e => e.target === "db")!.backendDeliveries).toBe(0);
    expect(events.find(e => e.kind === "caller-terminal")!.detail).toMatchObject({ rootReason: denied ? "policy-denied" : "unreachable", rootResource: denied ? "firewall" : "db" });
  }
});
