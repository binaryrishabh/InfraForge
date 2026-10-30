import { expect, test } from "bun:test";
import { securityDesign, prepareSecurity } from "./securityCanvas.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { withTimeline } from "../src/model2/product/timeline";
import { intervention, interventionInput, advance } from "./interventionFixture";
import { quantities } from "./workloadFixture";
import { compileInterventions } from "../src/model2/product/interventions";
import { derivedLedger } from "../src/model2/product/provenance";
import { createModel2Run } from "../src/model2/product/liveRun";
import { resolveWorkload } from "@infraforge/domain/workload";

function setup(saved = false, reset = false, fresh = false) {
  const design = securityDesign();
  if (saved) design.resources.find(r => r.id === "firewall")!.firewallSettings = {version: 1, default: "allow", rules: [{id: "allow-db", priority: 0, direction: "egress", source: "any", destination: "any", fromPort: 5432, toPort: 5432, action: "allow"}]};
  const {contract} = prepareSecurity(design), {q, ledger} = quantities();
  contract.horizon = q("test.horizon", 5_000_000, "us");
  if (fresh) contract.transports.database!.pool.reuse = false;
  contract.ledger.push(...ledger);
  const timeline = withTimeline(contract, [{id: "deny", atUs: 1_000_001, kind: "intervention", request: intervention("deny-port", {port: 5432, duration: 2}, {resourceId: "firewall"}).parameters}]);
  const compiled = compileProduct(design, timeline);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  if (reset) {
    const extra = quantities();
    compiled.value.input.networkInterventions.push({id: "reset", at: extra.q("test.reset", 2_000_000, "us"), kind: "reset", target: "edge-1:app:db"});
    compiled.value.input.ledger.push(...extra.ledger);
  }
  return {design, contract, compiled: compiled.value};
}

for (const saved of [false, true]) test(`deny-port preserves established flows, refuses fresh opens and restores exact baseline, saved=${saved}`, () => {
  const reused = setup(saved), fresh = setup(saved, false, true), reset = setup(saved, true);
  const runs = [reused, fresh, reset].map(f => createProductModel2(f.compiled));
  for (const run of runs) run.advanceTo(1_000_000);
  const before = runs.map(r => r.evidence().data.databases[0]!.transactions.committed);
  for (const run of runs) run.advanceTo(3_000_000);
  const during = runs.map(r => r.evidence());
  expect(before).toEqual([11, 11, 11]);
  expect(during.map(e => e.data.databases[0]!.transactions.committed)).toEqual([31, 11, 21]);
  expect(during.map(e => e.systems.security.policies[0]!.denied)).toEqual([0, 20, 10]);
  expect(during[0]!.data.databases[0]!.transactions.committed).toBeGreaterThan(before[0]!);
  expect(during[0]!.systems.security.policies[0]!.denied).toBe(0);
  expect(during[1]!.data.databases[0]!.transactions.committed).toBe(before[1]!);
  for (const e of during.slice(1)) {
    expect(e.systems.security.policies[0]!.denied).toBeGreaterThan(0);
    expect(e.systems.security.admission!.rows.some(r => !r.allowed && r.rule === "intervention:deny:deny-port" && r.generation === 2)).toBe(true);
    expect(e.systems.security.events.rows.some(r => r.detail.includes("policy-denied:firewall:egress:intervention:deny:deny-port"))).toBe(true);
  }
  for (const [i,run] of runs.entries()) {
    expect(run.activeInterventions()).toHaveLength(1);
    run.advanceTo(3_000_001);
    expect(run.activeInterventions()).toEqual([]);
    expect(run.evidence().systems.security.policies[0]!.generation).toBe(3);
    expect(run.evidence().systems.security.policies[0]!.rules).toEqual(reused.compiled.input.systems.firewalls[0]!.rules);
    run.advanceTo(4_000_000);
    expect(run.evidence().data.databases[0]!.transactions.committed).toBeGreaterThan(during[i]!.data.databases[0]!.transactions.committed);
    if (i) expect(run.evidence().systems.security.admission!.rows.some(r => r.allowed && r.at > 3_000_001)).toBe(true);
  }
});

test("deny-port refuses overlap without state or timeline changes", () => {
  const design = securityDesign(), run = createModel2Run({resources: design.resources, connectionLines: design.connections, workloadProfile: resolveWorkload(design.workload!), seed: "overlap"}, 6);
  const action = intervention("deny-port", {port: 5432, duration: 2}, {resourceId: "firewall"});
  run.apply(action);
  const before = JSON.stringify(run.evidence()), actions = JSON.stringify(run.actions);
  expect(() => run.apply({...action, parameters: {...action.parameters, parameters: {port: 80, duration: 1}}})).toThrow("OVERLAP");
  expect(JSON.stringify(run.actions)).toBe(actions); expect(JSON.stringify(run.evidence())).toBe(before);
});

test("deny-port refuses an ambiguous saved policy update", () => {
  const {design, contract, compiled} = setup(), extra = quantities();
  const input = compiled.input;
  input.systems.interventions = [{id: "authored", kind: "firewall-rules", target: "firewall", at: extra.q("test.conflict", 500_000, "us"), rules: []}];
  input.ledger.push(...extra.ledger);
  contract.interventions = [{id: "conflict", atUs: 1, request: intervention("deny-port", {port: 5432, duration: 1}, {resourceId: "firewall"}).parameters}];
  expect(() => compileInterventions(design, contract, input, derivedLedger(input.ledger))).toThrow("OVERLAP");
});

test("deny-port compile uses shared bounds and revision validation", () => {
  const {design, contract} = setup();
  for (const port of [0, 65536, 1.1]) expect(() => withTimeline(contract, [{id: "bad", atUs: 1, kind: "intervention", request: intervention("deny-port", {port, duration: 1}, {resourceId: "firewall"}).parameters}])).toThrow("BOUNDS");
  const request = intervention("deny-port", {port: 5432, duration: 1}, {resourceId: "firewall"}).parameters;
  for (const r of [{...request, revision: 2}, {...request, parameters: {port: 0, duration: 1}}]) {
    const c = compileProduct(design, {...contract, interventions: [{id: "bad", atUs: 1, request: r}]});
    expect(c.ok).toBe(false); expect(c.diagnostics[0]!.message).toMatch(/BOUNDS|REVISION/);
  }
});

test("adjacent deny-port windows restore before the next rule install independent of IDs", () => {
  const {design, contract} = setup();
  const request = intervention("deny-port", {port: 5432, duration: 1}, {resourceId: "firewall"}).parameters;
  const c = compileProduct(design, {...contract, interventions: [{id: "z", atUs: 1, request}, {id: "a", atUs: 1_000_001, request}]});
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const run = createProductModel2(c.value); run.advanceTo(1_000_001);
  const policy = run.evidence().systems.security.policies[0]!;
  expect(policy.generation).toBe(4);
  expect(policy.rules.map(r => r.id)).toEqual(["intervention:a:deny-port"]);
  run.advanceTo(2_000_001);
  expect(run.evidence().systems.security.policies[0]!.rules).toEqual([]);
});

test("bandwidth increases large-payload transfer latency and restores the exact authored rate", () => {
  const input = interventionInput(false, 1);
  input.workloadProfile = resolveWorkload({...input.workloadProfile, payloadSize: "heavy"});
  const run = createModel2Run(input, 6), baseline = createModel2Run(input, 6);
  run.apply(intervention("bandwidth", {bandwidth: 262_144, duration: 2}, {edgeId: "app-db", direction: "request"}));
  advance(run, 2); advance(baseline, 2);
  const e = run.evidence(), b = baseline.evidence();
  expect(e.network.links.find(l => l.id === "app-db:app:db/request")!.bandwidthBytesPerSecond).toBe(262_144);
  expect(e.counts.completed).toBeLessThan(b.counts.completed);
  expect(run.view().traffic.latencyMs.p95).toBeGreaterThan(1000);
  expect(baseline.view().traffic.latencyMs.p95).toBeLessThan(100);
  advance(run, 1);
  expect(run.evidence().network.links.find(l => l.id === "app-db:app:db/request")!.bandwidthBytesPerSecond).toBe(b.network.links.find(l => l.id === "app-db:app:db/request")!.bandwidthBytesPerSecond);
});

test("bandwidth restores exactly at the ending microsecond", () => {
  const {design, contract} = setup();
  const c = compileProduct(design, withTimeline(contract, [{id: "rate", atUs: 1, kind: "intervention", request: intervention("bandwidth", {bandwidth: 1000, duration: 1}, {edgeId: "edge-1", direction: "both"}).parameters}]));
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const run = createProductModel2(c.value); run.advanceTo(1_000_000);
  expect(run.evidence().network.links.find(l => l.id === "edge-1:app:db/request")!.bandwidthBytesPerSecond).toBe(1000);
  run.advanceTo(1_000_001);
  expect(run.evidence().network.links.find(l => l.id === "edge-1:app:db/request")!.bandwidthBytesPerSecond).toBe(125_000_000);
  expect(run.activeInterventions()).toEqual([]);
});

test("bandwidth compile refuses invalid bounds, revision and overlapping aliases", () => {
  const {design, contract} = setup();
  const request = intervention("bandwidth", {bandwidth: 1000, duration: 1}, {edgeId: "edge-1", direction: "both"}).parameters;
  for (const r of [{...request, revision: 2}, {...request, parameters: {bandwidth: 0, duration: 1}}]) {
    const c = compileProduct(design, {...contract, interventions: [{id: "bad", atUs: 1, request: r}]});
    expect(c.ok).toBe(false); expect(c.diagnostics[0]!.message).toMatch(/BOUNDS|REVISION/);
  }
  const c = compileProduct(design, {...contract, interventions: [{id: "one", atUs: 1, request}, {id: "two", atUs: 1, request: {...request, target: {edgeId: "edge-1", direction: "request"}}}]});
  expect(c.ok).toBe(false); expect(c.diagnostics[0]!.message).toContain("OVERLAP");
});

for (const port of [443, 5432]) test(`deny-port receipt and live affected paths match the dialed port ${port}`, () => {
  const design = securityDesign();
  const run = createModel2Run({resources: design.resources, connectionLines: design.connections, workloadProfile: resolveWorkload(design.workload!), seed: "port-specific"}, 5);
  const receipt = run.apply(intervention("deny-port", {port, duration: 2}, {resourceId: "firewall"})).outcome.intervention!;
  const matching = port === 5432;
  expect(receipt.affectedPaths).toEqual(matching ? ["edge-1:app:db"] : []);
  advance(run, 1);
  const active = run.view().activeChaos;
  expect(active.map(c => c.resourceId).sort()).toEqual(matching ? ["app", "db", "firewall"] : ["firewall"]);
  expect(active.flatMap(c => c.intervention?.edgeIds ?? [])).toEqual(matching ? ["edge-1", "edge-1", "edge-1"] : []);
  const e = run.evidence();
  expect(e.product.interventions![0]!.affectedPaths).toEqual(receipt.affectedPaths);
  expect(e.systems.security.policies[0]!.denied > 0).toBe(matching);
  expect(e.data.databases[0]!.transactions.committed > 0).toBe(!matching);
});

test("live intervention countdown rounds up while preserving the exact restore time", () => {
  const run = createModel2Run(interventionInput(), 5);
  run.apply(intervention("session-capacity", {sessions: 0, duration: 2}));
  for (const remaining of [2, 1]) {
    advance(run, 1);
    expect(run.view().activeChaos).toMatchObject([{resourceId: "db", remainingTicks: remaining, intervention: {restoreAtUs: 2_000_001}}]);
  }
  advance(run, 1);
  expect(run.view().activeChaos).toEqual([]);
});
