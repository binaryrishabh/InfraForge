import { expect, test } from "bun:test";
import { depthSetup, gapRun } from "./firewallDepth.fixture";
import { denyNew } from "./firewallCapacity.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { securityPlane } from "../src/model2/systems/security";
import { EventKernel } from "../src/model2/time";
import type { NetworkContext } from "../src/model2/network/run";
import { quantities } from "./workloadFixture";

function plane(idle = 1, capacity = 1) {
  const f = depthSetup(idle, capacity), input = f.compiled.input, kernel = new EventKernel(100000);
  let reachable = true;
  const context: NetworkContext = { invalidateSessions: () => 0, endpoint: id => input.endpoints[id]!, reachable: () => reachable, setReady() {}, observe() {}, setAvailable() {}, abortOwned() {}, drain() {}, backend: () => ({ health: true, draining: false, outstanding: 0 }) };
  const security = securityPlane(input, kernel, context, () => undefined), path = input.paths.find(p => p.id === "external-entry")!;
  const h = security.hook(path, () => { throw Error("Unexpected DNS"); });
  const open = (id: string) => { let result = "allowed"; h.open(id, (route, reason) => { if (!route) result = reason!; }); return result; };
  return { ...f, h, kernel, security, open, disconnect: () => { reachable = false; } };
}

test("idle timeout alone changes real downstream delivery, established survival and recovery", () => {
  const short = gapRun(1), long = gapRun(5);
  short.runtime.advanceTo(2500000); long.runtime.advanceTo(2500000);
  const a = short.runtime.evidence(), b = long.runtime.evidence();
  expect(a.counts).toMatchObject({ offered: 3, completed: 1, rejected: 2 });
  expect(b.counts).toMatchObject({ offered: 3, completed: 3, rejected: 0 });
  expect(a.network.paths.find(p => p.id === "external-entry")!.reasons).toEqual({ "policy-denied": 2 });
  expect(a.systems.security.policies[0]).toMatchObject({ expired: 1, denied: 2, returnExchanges: 1 });
  expect(b.systems.security.policies[0]).toMatchObject({ expired: 0, denied: 0, returnExchanges: 3 });
  for (const f of [short, long]) f.runtime.advanceTo(6000000);
  const after = short.runtime.evidence(), retained = long.runtime.evidence();
  expect(after.counts).toMatchObject({ offered: 5, completed: 3, rejected: 2, inFlight: 0 });
  expect(retained.counts).toMatchObject({ offered: 5, completed: 5, rejected: 0, inFlight: 0 });
  const p = after.network.paths.find(p => p.id === "external-entry")!;
  // A permitted request after restoration re-establishes tracking on the same pooled connection.
  expect(p.pool).toMatchObject({ created: 1, closed: 0, acquired: 5, released: 5 });
  expect(after.systems.security.policies[0]).toMatchObject({ generation: 3, opened: 2, closed: 0, expired: 2 });
  expect(after.systems.security.edges!.find(e => e.path === "external-entry")!.backendDeliveries).toBe(3);
  expect(retained.systems.security.edges!.find(e => e.path === "external-entry")!.backendDeliveries).toBe(5);
  console.info("firewall-idle-causal", JSON.stringify({ short: { completed: after.counts.completed, denied: 2, expired: 2, connections: p.pool.created }, long: { completed: retained.counts.completed, denied: 0, expired: 0, connections: 1 } }));
});

test("table exhaustion refuses NEW connections while ESTABLISHED requests and returns survive deny rules", () => {
  const f = plane(), q = quantities();
  expect(f.open("retained")).toBe("allowed");
  expect(f.open("overflow")).toBe("flow-capacity");
  f.kernel.advanceTo(500000); f.security.update("firewall", [denyNew(q)]);
  expect(f.open("denied")).toBe("policy-denied");
  expect(f.h.requestTraffic!("retained")).toBeUndefined();
  expect(f.h.returnTraffic!("retained")).toBe(true);
  expect(f.security.evidence().policies[0]).toMatchObject({ opened: 1, capacityRefused: 1, denied: 1, returnExchanges: 1 });
  f.kernel.advanceTo(1499999); expect(f.h.returnTraffic!("retained")).toBe(true);
  f.kernel.advanceTo(2499999); expect(f.h.returnTraffic!("retained")).toBe(false);
  expect(f.h.requestTraffic!("retained")!.reason).toBe("policy-denied");
  f.security.update("firewall", []);
  expect(f.h.requestTraffic!("retained")).toBeUndefined();
  expect(f.h.returnTraffic!("retained")).toBe(true);
  const p = f.security.evidence().policies[0]!;
  expect(p.opened).toBe(p.closed + p.expired! + p.flows.length);
  f.h.close("retained"); expect(f.kernel.pending).toBe(0);
});

test("expiry precedes equal-time restoration and new arrival; capacity recovers without evicting other state", () => {
  const f = plane(1, 2), q = quantities();
  f.open("expired"); f.open("retained");
  f.kernel.advanceTo(500000); f.h.returnTraffic!("retained");
  f.security.update("firewall", [denyNew(q)]);
  f.kernel.schedule(1000000, -1, "restore", () => f.security.update("firewall", []));
  f.kernel.schedule(1000000, 2, "arrive", () => expect(f.open("recovered")).toBe("allowed"));
  f.kernel.advanceTo(1000000);
  expect(f.security.evidence().policies[0]!.flows.map(r => r.id)).toEqual(["retained", "recovered"]);
  expect(f.security.evidence().policies[0]).toMatchObject({ expired: 1, opened: 3, generation: 3 });
  expect(f.h.returnTraffic!("retained")).toBe(true);
  expect(f.open("full")).toBe("flow-capacity");
});

test("ordered rules are first-match in each direction; equal priority uses stable lexical ID", () => {
  const q = quantities(), deny = { ...denyNew(q), direction: "both" as const, id: "a-deny" }, allow = { ...deny, id: "b-allow", action: "allow" as const };
  const f = plane(1, 3);
  f.security.update("firewall", [allow, deny]); expect(f.open("one")).toBe("policy-denied");
  expect(f.security.evidence().admission!.rows.at(-1)).toMatchObject({ rule: "a-deny", direction: "egress" });
  f.security.update("firewall", [{ ...allow, id: "a-allow" }, { ...deny, id: "b-deny" }]); expect(f.open("two")).toBe("allowed");
  f.security.update("firewall", [{ ...deny, priority: q.q("later", 1, "count") }, allow]); expect(f.open("three")).toBe("allowed");
  expect(f.h.requestTraffic!("two")).toBeUndefined();
});

test("unreachable and explicit denial produce distinct real request failures and no backend deliveries", () => {
  const run = (deny: boolean) => {
    const f = depthSetup(), i = f.compiled.input;
    for (const a of i.arrivals) if (a.kind === "trace") a.trace.rows = a.trace.rows.slice(0, 1);
    if (deny) i.systems.firewalls[0]!.default = "deny"; else i.endpoints.lb!.ready = false;
    const runtime = createProductModel2(f.compiled); runtime.advanceTo(1000000); return runtime.evidence();
  };
  const denied = run(true), unreachable = run(false);
  expect(denied.network.paths.find(p => p.id === "external-entry")!.reasons).toEqual({ "policy-denied": 1 });
  expect(unreachable.network.paths.find(p => p.id === "external-entry")!.reasons).toEqual({ unreachable: 1 });
  for (const e of [denied, unreachable]) {
    expect(e.counts).toMatchObject({ offered: 1, completed: 0, rejected: 1 });
    expect(e.systems.security.edges!.find(e => e.path === "external-entry")!.backendDeliveries).toBe(0);
    expect(e.systems.security.policies[0]!.flows).toEqual([]);
  }
});

test("saved idle policy requires exact captured and owned profiles and materialized intent", () => {
  const f = depthSetup(2);
  expect(currentAdapterProfiles(f.saved.resources)).toEqual(["failure-cause/1", "firewall-flow-capacity/1", "firewall-state/1"]);
  for (const adapterProfiles of [[], ["firewall-flow-capacity/1"], ["firewall-state/1", "firewall-state/1"]] as const) expect(contractFromDesign(f.saved, { adapterProfiles })).toHaveProperty("refused");
  const absent = structuredClone(f.saved); delete absent.resources.find(r => r.id === "firewall")!.firewallState;
  expect(contractFromDesign(absent, { adapterProfiles: ["failure-cause/1", "firewall-flow-capacity/1", "firewall-state/1"] })).toHaveProperty("refused");
  for (const version of ["canvas-assumptions/2", "canvas-assumptions/2/firewall-state/2", "canvas-assumptions/2/firewall-state/10", "canvas-assumptions/2/firewall-state/1/firewall-state/1"]) {
    const c = structuredClone(f.contract); c.nodes.firewall!.profileVersion = version; expect(compileProduct(f.saved, c).ok).toBe(false);
  }
  const c = structuredClone(f.contract); c.nodes.app!.profileVersion += "/firewall-state/1"; expect(compileProduct(f.saved, c).ok).toBe(false);
  const tampered = structuredClone(f.contract), timeout = tampered.nodes.firewall!.firewall!.statePolicy!.idleTimeout;
  if (timeout.kind !== "known") throw Error("Expected timeout"); timeout.value++;
  tampered.ledger.find(r => r.id === timeout.provenance[0])!.quantity = timeout;
  expect(compileProduct(f.saved, tampered).ok).toBe(false);
  const forged = structuredClone(absent), old = contractFromDesign(forged);
  if ("refused" in old) throw Error("Expected historical contract");
  old.contract.nodes.firewall!.firewall!.statePolicy = f.contract.nodes.firewall!.firewall!.statePolicy;
  expect(compileProduct(forged, old.contract).ok).toBe(false);
});

test("repeated activity bounds timers, close releases expiry, and evidence omission preserves total refusals", () => {
  const f = plane(); f.compiled.input.limits.maxTraceRows = 3;
  f.open("live");
  for (let at = 1; at <= 1100; at++) { f.kernel.advanceTo(at); f.h.requestTraffic!("live"); f.open(`refused-${at}`); }
  expect(f.kernel.pending).toBe(1);
  expect(f.security.evidence().admission!.rows.length).toBeLessThanOrEqual(3);
  expect(f.security.evidence().admission!.omitted).toBeGreaterThan(1000);
  expect(f.security.evidence().policies[0]).toMatchObject({ capacityRefused: 1100, flows: [expect.objectContaining({ id: "live" })] });
  f.h.close("live"); expect(f.kernel.pending).toBe(0);
});

test("stepped replay equals one-shot evidence through expiry, refusal and recovery", () => {
  for (const idle of [1, 5]) {
    const f = gapRun(idle), other = createProductModel2(structuredClone(f.compiled));
    f.runtime.advanceTo(6000000); for (let at = 0; at <= 6000000; at += 10000) other.advanceTo(at);
    expect(other.evidence()).toEqual(f.runtime.evidence());
  }
});
