import { expect, test } from "bun:test";
import { firewallSetup, firewallDesign, denyNew } from "./firewallCapacity.fixture";
import { prepareSecurity } from "./securityCanvas.fixture";
import { securityPlane } from "../src/model2/systems/security";
import { EventKernel } from "../src/model2/time";
import type { NetworkContext } from "../src/model2/network/run";
import { quantities } from "./workloadFixture";
import { createProductModel2 } from "../src/model2/product/run";

// Exercise the existing security hook with the capacity from the real saved-design compiler.
function plane(two = false, tls = false) {
  const f = firewallSetup(two ? "two" : tls ? "tls" : "front", 2), input = f.compiled.input;
  const context: NetworkContext = { invalidateSessions: () => 0, endpoint: id => input.endpoints[id]!, reachable: () => true, setReady() {}, observe() {}, setAvailable() {}, abortOwned() {}, drain() {}, backend: () => ({ health: true, draining: false, outstanding: 0 }) };
  const security = securityPlane(input, new EventKernel(1000), context, () => undefined);
  const hook = (path: string) => security.hook(input.paths.find(p => p.id === path)!, () => { throw Error("Unexpected DNS"); });
  return { ...f, security, hook };
}
test("two slots admit exactly two connections; exhaustion, returns, close and fresh admission use real ownership", () => {
  const f = plane(), h = f.hook("external-entry");
  const open = (id: string) => { let admitted = false; h.open(id, route => { admitted = !!route; }); return admitted; };
  expect(open("one")).toBe(true); expect(open("two")).toBe(true); expect(open("three")).toBe(false);
  expect(f.security.evidence().events.rows.at(-1)).toMatchObject({ kind: "connection-denied", detail: "flow-capacity:firewall" });
  expect(f.security.evidence().policies[0]!.flows).toHaveLength(2);
  expect(h.returnTraffic!("one")).toBe(true); expect(h.returnTraffic!("two")).toBe(true);
  h.close("one"); expect(h.returnTraffic!("one")).toBe(false); expect(open("four")).toBe(true);
  expect(f.security.evidence().policies[0]).toMatchObject({ opened: 3, closed: 1, returnExchanges: 2 });
  h.close("two"); h.close("four"); expect(f.security.evidence().policies[0]!.flows).toHaveLength(0);
});
test("deny updates retain admitted flows and return traffic; fresh policy denial stays separate from full table", () => {
  const f = plane(), h = f.hook("external-entry"); h.open("one", () => {}); h.open("two", () => {});
  f.security.update("firewall", [denyNew(quantities())]);
  expect(h.returnTraffic!("one")).toBe(true); expect(f.security.evidence().policies[0]!.flows).toHaveLength(2);
  h.open("blocked", route => expect(route).toBeUndefined());
  expect(f.security.evidence().admission!.rows.at(-1)).toMatchObject({ reason: "policy-denied:firewall:ingress:deny-new", generation: 2, rule: "deny-new" });
  h.close("one"); h.open("still-blocked", route => expect(route).toBeUndefined());
  expect(f.security.evidence().events.rows.at(-1)!.detail).toBe("policy-denied:firewall:ingress:deny-new");
});
test("separate firewall instances hold independent state tables", () => {
  const f = plane(true), first = f.hook("external-entry"), second = f.hook("edge-0:lb:app");
  first.open("one", () => {}); first.open("two", () => {}); first.open("full", route => expect(route).toBeUndefined());
  second.open("other", route => expect(route).toBeDefined());
  const policies = f.security.evidence().policies;
  expect(policies.find(p => p.id === "firewall")!.flows).toHaveLength(2);
  expect(policies.find(p => p.id === "second")!.flows).toHaveLength(1);
  first.close("one"); expect(f.security.evidence().policies.find(p => p.id === "second")!.flows).toHaveLength(1);
});
test("TLS and listener failures keep their own causes and consume no state slots", () => {
  for (const reason of ["tls-required", "certificate-name", "no-listener"] as const) {
    const f = plane(false, true), input = f.compiled.input;
    // securityPlane holds the compiled dial/listener objects; only the selected gate changes.
    const dial = input.systems.connections.find(c => c.path === "external-entry")!;
    if (reason === "tls-required") dial.tls.mode = "plaintext";
    if (reason === "certificate-name") dial.tls.serverName = "wrong.example";
    if (reason === "no-listener") dial.port = quantities().q("absent.port", 81, "count");
    const h = f.hook("external-entry"); h.open("bad", route => expect(route).toBeUndefined());
    expect(f.security.evidence().events.rows.at(-1)!.detail).toBe(reason);
    expect(f.security.evidence().policies[0]!.flows).toHaveLength(0);
  }
});
test("real fresh workload exhausts a small table; capacity alone changes the outcome", () => {
  const run = (limit: number, reuse: boolean) => {
    const saved = firewallDesign("front", limit); saved.workload.targetThroughput = 60000;
    const f = prepareSecurity(saved);
    // Keep topology, traffic, seed and execution identical across the capacity comparison.
    const input = f.compiled.input;
    for (const path of input.paths) path.pool = { ...path.pool, reuse };
    for (const arrival of input.arrivals) if (arrival.kind === "trace") arrival.trace.rows = arrival.trace.rows.slice(0, 100);
    const runtime = createProductModel2(f.compiled); runtime.advanceTo(runtime.horizon); return runtime.evidence();
  };
  const small = run(1, false), larger = run(2, false), reused = run(1, true);
  const refusals = (e: typeof small) => e.systems.security.events.rows.filter(r => r.detail === "flow-capacity:firewall").length;
  expect(refusals(small)).toBeGreaterThan(0); expect(refusals(larger)).toBeLessThan(refusals(small));
  expect(reused.systems.security.policies[0]!.opened).toBe(1);
  expect(reused.systems.security.policies[0]!.returnExchanges).toBeGreaterThan(1);
  console.info("firewall-capacity-workload", JSON.stringify({ small: { refused: refusals(small), completed: small.counts.completed }, larger: { refused: refusals(larger), completed: larger.counts.completed }, reused: { opened: reused.systems.security.policies[0]!.opened, returns: reused.systems.security.policies[0]!.returnExchanges } }));
});
test("one-shot and stepped execution have identical complete evidence", () => {
  for (const mode of ["front", "update", "tls", "reuse", "two"] as const) {
    const f = firewallSetup(mode, 1), stepped = createProductModel2(f.compiled);
    f.runtime.advanceTo(f.runtime.horizon);
    for (let time = 1000000; time <= stepped.horizon; time += 1000000) stepped.advanceTo(time);
    expect(stepped.evidence()).toEqual(f.runtime.evidence());
  }
});
test("saved small capacity retains reused flows across runtime rule updates while new connections use generation two", () => {
  const run = (reuse: boolean) => { const f = firewallSetup("update", 1, reuse); f.runtime.advanceTo(1000000); return f.runtime.evidence(); };
  const reused = run(true), fresh = run(false);
  expect(reused.counts.completed).toBe(10); expect(fresh.counts.completed).toBe(1);
  expect(reused.systems.security.policies[0]).toMatchObject({ generation: 2, opened: 1, returnExchanges: 10 });
  expect(fresh.systems.security.admission!.rows.filter(r => !r.allowed)).toHaveLength(10);
  expect(fresh.systems.security.admission!.rows.filter(r => !r.allowed).every(r => r.generation === 2 && r.reason === "policy-denied:firewall:ingress:deny-new")).toBe(true);
});
