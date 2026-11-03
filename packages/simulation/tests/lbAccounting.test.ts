import { expect, test } from "bun:test";
import { multiLbDesign, prepareMultiLb } from "./multiLb.fixture";
import { quantities } from "./workloadFixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";

test("one entry can queue and refuse at one LB while another LB has spare capacity", () => {
  const d = multiLbDesign(), slow = d.resources.find(r => r.id === "vm-0")!, limited = d.resources.find(r => r.id === "lb-0")!;
  slow.size = "small"; slow.vmCpuQuota = { version: 1, limitPercent: 1 };
  limited.lbAdmission = { version: 1, maxActive: 1, maxQueued: 2, queueWaitMs: 20 };
  const f = prepareMultiLb(d); f.runtime.advanceTo(f.runtime.horizon);
  const e = f.runtime.evidence(), a = e.network.loadBalancers.find(lb => lb.id === "lb-0")!, b = e.network.loadBalancers.find(lb => lb.id === "lb-1")!;
  expect(a.accounting).toBeDefined(); expect(b.accounting).toBeDefined();
  expect(a.accounting!.rejectedAtLb).toBeGreaterThan(0); expect(a.accounting!.queuedAtLb).toBeGreaterThan(0);
  expect(a.accounting!.rejectedByVm).toBe(0);
  expect(b.accounting!.rejectedAtLb).toBe(0); expect(b.accounting!.queuedAtLb).toBe(0);
  expect(b.accounting!.acceptedByBackend).toBeGreaterThan(a.accounting!.acceptedByBackend);
  expect(b.active).toBeLessThan(33); expect(b.pending).toBe(0);
  expect(a.received).toBe(b.received); expect(e.counts.offered).toBe(300);
  const higher = structuredClone(d); higher.resources.find(r => r.id === "lb-0")!.lbAdmission!.maxActive = 8;
  const h = prepareMultiLb(higher); h.runtime.advanceTo(h.runtime.horizon);
  const relaxed = h.runtime.evidence().network.loadBalancers.find(lb => lb.id === "lb-0")!.accounting!;
  expect(relaxed.queuedAtLb).toBeLessThan(a.accounting!.queuedAtLb);
  expect(relaxed.acceptedByBackend).toBeGreaterThan(a.accounting!.acceptedByBackend);
  console.info("lb-accounting-independent", JSON.stringify({ a, b, relaxed, roots: e.counts }));
});

test("VM queue, VM refusal and downstream timeout stay separate from LB admission", () => {
  const d = multiLbDesign(1), vm = d.resources.find(r => r.id === "vm-0")!, lb = d.resources.find(r => r.id === "lb-0")!;
  vm.size = "small"; vm.vmCpuQuota = { version: 1, limitPercent: 1 }; vm.vmExecution = { version: 1, workers: 1, queuedRequests: 2 };
  lb.lbAdmission = { version: 1, maxActive: 128, maxQueued: 128 };
  lb.lbHealth = { version: 1, intervalSeconds: 60, timeoutSeconds: 60 };
  const f = prepareMultiLb(d); f.runtime.advanceTo(f.runtime.horizon);
  const a = f.runtime.evidence().network.loadBalancers[0]!.accounting!;
  expect(a.acceptedByBackend).toBeGreaterThan(0); expect(a.queuedAtVm).toBeGreaterThan(0); expect(a.rejectedByVm).toBeGreaterThan(0);
  expect(a.rejectedAtLb).toBe(0); expect(a.queuedAtLb).toBe(0);
  const delayed = prepareMultiLb(d, 3, c => {
    const edge = c.edges["backend-0"]!, transport = structuredClone(c.transports[edge.transport!]!), q = quantities();
    edge.transport = "accounting-slow"; c.transports[edge.transport] = transport;
    transport.pool.responseTimeout = q.q("accounting.responseTimeout", 1000, "us");
    c.ledger.push(...q.ledger);
  });
  delayed.runtime.advanceTo(delayed.runtime.horizon);
  expect(delayed.runtime.evidence().network.loadBalancers[0]!.accounting!.timedOutDownstream).toBeGreaterThan(0);
  console.info("lb-accounting-vm", JSON.stringify({ normal: a, timed: delayed.runtime.evidence().network.loadBalancers[0]!.accounting }));
});

test("accounting changes no scheduling and does not depend on retained logs", () => {
  const f = prepareMultiLb(); f.runtime.advanceTo(f.runtime.horizon);
  const e = f.runtime.evidence(), oldContract = structuredClone(f.contract); delete oldContract.lbAccountingProfile;
  const old = compileProduct(f.design, oldContract); if (!old.ok) throw Error(JSON.stringify(old.diagnostics));
  expect(old.value.input).toEqual(f.compiled.input);
  const runtime = createProductModel2(old.value); runtime.advanceTo(runtime.horizon);
  expect({ ...e, network: { ...e.network, loadBalancers: e.network.loadBalancers.map(({ accounting: _accounting, ...lb }) => lb) } }).toEqual(runtime.evidence());
  const capped = prepareMultiLb(f.design, 3, c => { c.arrival.generated = true; c.limits.maxRawResults = 0; c.limits.maxTraceRows = 1; });
  capped.runtime.advanceTo(capped.runtime.horizon);
  expect(capped.runtime.evidence().network.loadBalancers.map(lb => lb.accounting)).toEqual(e.network.loadBalancers.map(lb => lb.accounting));
  Object.assign(f.contract, { lbAccountingProfile: "lb-accounting/2" });
  expect(compileProduct(f.design, f.contract).ok).toBe(false);
});
