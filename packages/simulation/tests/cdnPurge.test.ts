import { expect, test } from "bun:test";
import { cdnSetup } from "./cdnTtl.fixture";
import { hash } from "./asyncCanvas.fixture";
import { createModel2Run } from "../src/model2/product/liveRun";
import { interventionOptions, resolveIntervention } from "../src/model2/product/interventions";
import { purgeInput, purgeRequest, slowOrigin } from "./cdnPurge.fixture";
import { buildModel2Contract, buildContractFromRunInputs, type ContractBuilder } from "../src/model2/product/runContract";
import { compileProduct } from "../src/model2/product/compiler";
import { withTimeline } from "../src/model2/product/timeline";
import { createProductModel2 } from "../src/model2/product/run";
import { DeploymentChaosNames } from "@infraforge/domain/resource";

// Captured on untouched e62351897483398a2d81ca0ded7adf339e02dab4; LF-normalized, never regenerate.
test("CDN run without actions retains base contract, compiled, assumptions, evidence and live bytes", () => {
  const f = cdnSetup(); f.runtime.advanceTo(12_000_000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual([
    "467009837f1af833c39a3986635742206a595c218d54d4921ea7b37fd0435454", "ff8405d74875eb8b48a3c901b5f18ce8c17a5006d75b44bded4bdc32dbcd3089",
    "602a492a3379d76595bc1e52bdfcd8c377a96a67646ecc61190bb894cf7479bf", "1e8be45dede42f6f7d9d2a3b8b4eb2e3d5104a3c5877aea78e12e21f97d55263"]);
  const run = createModel2Run(purgeInput(), 12); for (let s = 0; s < 12; s++) run.advance();
  expect(hash(run.evidence())).toBe("f4e16886b88e55677a2d6a7f9551bccac145b2200c032ace0c0bb4cc0433f428");
  expect(hash(run.view())).toBe("91c56710cb7293a94a13d0da5f29a2cf1f6b92925f0739964da9738951b331f7");
});

test("live purge removes every warm entry at the receipt microsecond, then misses, refills and hits", () => {
  const input = purgeInput(), run = createModel2Run(input, 12), baseline = createModel2Run(input, 12);
  run.advance(); baseline.advance();
  const warm = run.evidence().systems.cdns[0]!;
  expect(warm.entries).toHaveLength(1); expect(warm).toMatchObject({hits: 1, misses: 1, fills: 1, originRequests: 1, purged: 0});
  const receipt = run.apply(purgeRequest).outcome.intervention!;
  expect(receipt).toMatchObject({atUs: 1_000_001, endUs: null, resolvedTargets: ["cdn"]});
  const built = buildContractFromRunInputs(input, 12); if ("refused" in built) throw Error(JSON.stringify(built));
  const c = compileProduct({schema: "infraforge-saved-design/1", resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile}, withTimeline({...built.contract, arrival: {...built.contract.arrival, generated: true}}, [...run.actions]));
  if (!c.ok) throw Error(JSON.stringify(c));
  expect(c.value.input.systems.interventions).toHaveLength(1);
  expect(c.value.input.systems.interventions[0]).toMatchObject({kind: "cdn-purge", id: "a1:cdn", target: "cdn", at: {value: 1_000_001, unit: "us"}});
  expect(c.value.input.systems.interventions[0]).not.toHaveProperty("key");
  const exact = createProductModel2(c.value), stepped = createProductModel2(c.value);
  exact.advanceTo(1_000_000); expect(exact.inspectCdn("cdn")!.entries).toHaveLength(1);
  exact.advanceTo(receipt.atUs); expect(exact.inspectCdn("cdn")).toMatchObject({entries: [], purged: 1, fills: 1});
  expect(exact.evidence().product.interventions).toMatchObject([{atUs: 1_000_001, endUs: null, phase: "completed"}]);
  const logs = run.advance(); baseline.advance();
  const refill = run.evidence().systems.cdns[0]!, normal = baseline.evidence().systems.cdns[0]!;
  expect(refill).toMatchObject({purged: 1, misses: warm.misses + 1, originRequests: warm.originRequests + 1, fills: warm.fills + 1, hits: warm.hits + 1});
  expect(refill.entries).toHaveLength(1); expect(normal).toMatchObject({misses: 1, fills: 1, originRequests: 1, purged: 0});
  expect(run.view().metrics.cdn!.cdn).toMatchObject({purged: refill.purged, misses: refill.misses, originRequests: refill.originRequests, fills: refill.fills, hits: refill.hits});
  expect(run.view().activeChaos).toEqual([]);
  expect(logs.some(l => l.message.includes("Purge CDN cache applied at 1000001 us") && l.message.includes("one-shot"))).toBe(true);
  exact.advanceTo(exact.horizon); for (let t = 100_000; t <= stepped.horizon; t += 100_000) stepped.advanceTo(t);
  expect(stepped.evidence()).toEqual(exact.evidence());
});

test("warm cache with an unavailable origin serves hits until live purge forces an actual failure", () => {
  const input = purgeInput(), run = createModel2Run(input, 40), baseline = createModel2Run(input, 40);
  for (const r of [run, baseline]) { r.advance(); r.apply({kind: "chaos", parameters: {type: DeploymentChaosNames.Crash, resourceId: "store"}}); r.advance(); }
  const before = run.evidence(); expect(before.systems.cdns[0]!.entries).toHaveLength(1);
  expect(before.systems.cdns[0]!.originFailures).toBe(0);
  expect(run.apply(purgeRequest).outcome.intervention!.atUs).toBe(2_000_001);
  for (let s = 0; s < 6; s++) { run.advance(); baseline.advance(); }
  const e = run.evidence(), b = baseline.evidence();
  expect(e.systems.cdns[0]).toMatchObject({entries: [], purged: 1, hits: before.systems.cdns[0]!.hits, fills: 1});
  expect(e.systems.cdns[0]!.originFailures).toBeGreaterThan(0);
  expect(e.counts.rejected).toBeGreaterThan(b.counts.rejected);
  expect(e.counts.completed).toBe(before.counts.completed);
  expect(b.systems.cdns[0]!.entries).toHaveLength(1); expect(b.systems.cdns[0]!.originFailures).toBe(0);
});

test("live purge during a shared in-flight origin fill preserves stale-fill suppression for every waiter", () => {
  const input = purgeInput(4), run = createModel2Run(input, 8, slowOrigin), baseline = createModel2Run(input, 8, slowOrigin);
  run.advance(); baseline.advance();
  expect(run.evidence().systems.cdns[0]!.pendingFills[0]!.waiters).toBeGreaterThan(1);
  expect(run.apply(purgeRequest).outcome.intervention!.atUs).toBe(1_000_001);
  run.advance(); run.advance(); baseline.advance(); baseline.advance();
  const e = run.evidence(), b = baseline.evidence();
  expect(e.systems.cdns[0]).toMatchObject({staleFills: 1, fills: 0, purged: 0, entries: []});
  expect(b.systems.cdns[0]).toMatchObject({staleFills: 0, fills: 1});
  expect(e.systems.cdns[0]!.coalesced).toBeGreaterThan(1);
  expect(e.counts.completed).toBeGreaterThan(1);
  for (let s = 3; s < 8; s++) run.advance();
  expect(run.evidence().systems.cdns[0]).toMatchObject({staleFills: 1, fills: 1});
  expect(run.evidence().systems.cdns[0]!.hits).toBeGreaterThan(0);
});
test("purge options belong only to the fixed materialized CDN role", () => {
  const {saved, contract, compiled} = cdnSetup();
  expect(interventionOptions(saved, contract, compiled.input).filter(o => o.interventionId === "cdn-purge")).toEqual([{interventionId: "cdn-purge", revision: 1, target: {resourceId: "cdn"}, resolvedTargets: ["cdn"], affectedPaths: []}]);
  for (const resourceId of ["store", "missing"]) expect(() => resolveIntervention(saved, contract, compiled.input, {...purgeRequest.parameters, target: {resourceId}})).toThrow("ROLE");
  for (const type of ["Cache", "Virtual Machine", "Object Storage", "Load Balancer"] as const) {
    saved.resources[0]!.type = type;
    expect(() => resolveIntervention(saved, contract, compiled.input, purgeRequest.parameters)).toThrow("ROLE");
    expect(interventionOptions(saved, contract, compiled.input).some(o => o.interventionId === "cdn-purge")).toBe(false);
  }
  saved.resources[0]!.type = "CDN";
  contract.nodes.cdn!.controller = {} as NonNullable<typeof contract.nodes.cdn>["controller"];
  expect(interventionOptions(saved, contract, compiled.input).some(o => o.interventionId === "cdn-purge")).toBe(false);
  delete contract.nodes.cdn!.controller;
  compiled.input.resources = compiled.input.resources.filter(r => r.id !== "cdn");
  expect(interventionOptions(saved, contract, compiled.input).some(o => o.interventionId === "cdn-purge")).toBe(false);
});

test("live purge owns all entries of its CDN and refuses other targets without changing the timeline", () => {
  const input = purgeInput(10); input.workloadProfile.readWriteRatio = 0.5;
  const build: ContractBuilder = (...args) => {
    const result = buildModel2Contract(...args); if ("refused" in result) return result;
    const cdn = result.contract.nodes.cdn!.resources[0]!.config, origin = result.contract.nodes.store!.resources[0]!.config;
    if (cdn.kind !== "cdn" || origin.kind !== "object-store") throw Error("Expected CDN and origin");
    cdn.keys.write = "second"; origin.initial.push({...origin.initial[0]!, key: "second"}); return result;
  };
  const run = createModel2Run(input, 8, build); run.advance();
  expect(run.evidence().systems.cdns[0]!.entries).toHaveLength(2);
  const before = JSON.stringify(run.evidence());
  for (const target of [{resourceId: "store"}, {resourceId: "absent"}, {edgeId: "e0", direction: "both" as const}]) {
    expect(() => run.apply({...purgeRequest, parameters: {...purgeRequest.parameters, target}})).toThrow(/ROLE|TARGET/);
    expect(JSON.stringify(run.evidence())).toBe(before); expect(run.actions).toEqual([]);
  }
  run.apply(purgeRequest); run.advance();
  expect(run.evidence().systems.cdns[0]).toMatchObject({purged: 2, fills: 4});
  expect(run.evidence().systems.cdns[0]!.entries).toHaveLength(2);
});
