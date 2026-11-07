import { expect, test } from "bun:test";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { preflight } from "../challenges/preflight";
import { buildRunReport } from "../reports/report";
import { challengeSeed } from "../challenges/registry";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { definition, REFERENCE } from "./challengeHarness";
import { cdnLabFixture } from "./cdnLab.fixture";

test("CDN TTL alone retains the asset during an origin outage; shorter near miss fails and missing evidence refuses", () => {
  const d = definition("keep-an-asset-cached"), f = cdnLabFixture(), start = d.starter!, fixed = REFERENCE[d.id]!;
  const restored = structuredClone(fixed); restored.resources[0]!.cdnCachePolicy!.ttlSeconds = 1;
  expect(restored).toEqual(start);
  expect(validateInfrastructureName(d.title)).toBeNull();
  const inputs = [start, fixed].map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  expect(inputs[0]!.seed).toBe(inputs[1]!.seed);
  expect(inputs[0]!.workloadProfile).toEqual(inputs[1]!.workloadProfile);
  expect(inputs[0]!.adapterProfiles).toEqual(inputs[1]!.adapterProfiles);
  for (const s of [start, fixed]) expect(preflight(d, s).valid).toBe(true);
  // Independent raw runs verify that the saved reports kept the same resource-owned evidence.
  for (const [i, input] of inputs.entries()) {
    const engine = createModel2Engine(input, d.evaluationSeconds);
    for (let s = 1; s <= d.evaluationSeconds; s++) { engine.advance(); if (s === 2) engine.apply({kind: "chaos", parameters: {type: DeploymentChaosNames.Crash, resourceId: "store"}}); }
    const report = f.reports[i]!, raw = engine.evidence().systems.cdns[0]!;
    const saved = report.terminal!.resources.find(r => r.id === "cdn")!.cdn!;
    for (const key of ["hits", "misses", "originRequests", "fills", "expirations", "coalesced", "purged", "staleFills"] as const) expect(saved[key]).toBe(raw[key]);
    expect(report.terminal!.traffic!.wholeRun).toEqual(engine.view().traffic!.wholeRun);
    expect(report.terminal!.resources.find(r => r.id === "store")!.health).toBe("failed");
    expect(report.challenge!.experiment).toMatchObject({state: "ended", appliedSimulatedSeconds: 2, endedSimulatedSeconds: 32});
    const roundTrip = buildRunReport({...f.rows[i]!, runInputs: JSON.parse(JSON.stringify(f.rows[i]!.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(f.rows[i]!.terminalSnapshot))});
    expect(roundTrip.terminal).toEqual(report.terminal); expect(roundTrip.challenge).toEqual(report.challenge);
  }
  expect(f.reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  const counts = f.reports.map(r => r.terminal!.traffic!.wholeRun!);
  expect(counts[0]!.failed).toBeGreaterThan(50); expect(counts[1]!).toMatchObject({completed: 64, failed: 0, deadlineExceeded: 0, abandoned: 0, inFlight: 0});
  expect(counts[2]!.failed).toBeGreaterThan(30);
  const cdn = f.reports.map(r => r.terminal!.resources.find(r => r.cdn)!.cdn!);
  expect(cdn[0]!.expirations!).toBeGreaterThan(0); expect(cdn[1]!.expirations).toBe(0);
  expect(cdn[1]!.originRequests).toBe(1); expect(cdn[1]!.fills).toBe(1); expect(cdn[1]!.hits).toBe(63);
  for (const [i, r] of f.reports.entries()) console.info(JSON.stringify({lab: d.id, variant: ["starter", "TTL-only", "shorter-TTL"][i], callers: counts[i], cdn: cdn[i], health: r.terminal!.health, verdict: r.challenge!.status}));
  const snapshot = (r: typeof f.rows[number]) => r.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number};
  for (const mutate of [
    (r: typeof f.rows[number]) => { r.terminalSnapshot = null; },
    (r: typeof f.rows[number]) => { snapshot(r).simulatedSeconds--; },
    (r: typeof f.rows[number]) => { snapshot(r).metricsTopologyRevision++; },
    (r: typeof f.rows[number]) => { delete snapshot(r).traffic!.wholeRun; },
    (r: typeof f.rows[number]) => { snapshot(r).traffic!.wholeRun!.throughSecond--; },
    (r: typeof f.rows[number]) => { snapshot(r).traffic!.wholeRun!.failed = -1; },
  ]) {
    const row = structuredClone(f.rows[1]!); mutate(row);
    expect(buildRunReport(row).challenge!.criteria.find(c => c.id === "callers")!.status).toBe("not-evaluated");
  }
  const noAction = structuredClone(f.rows[1]!); noAction.actions = [];
  expect(buildRunReport(noAction).challenge!.status).toBe("not-evaluated");
  const badHash = structuredClone(f.rows[1]!); badHash.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(badHash).challenge!.status).toBe("unavailable");
  const missingCdn = structuredClone(f.rows[1]!); delete snapshot(missingCdn).metrics.cdn!.cdn;
  expect(buildRunReport(missingCdn).terminal!.resources.find(r => r.id === "cdn")!.cdn).toBeUndefined();
  const invalid = structuredClone(start); invalid.resources[0]!.cdnCachePolicy!.ttlSeconds = 0;
  expect(preflight(d, invalid).valid).toBe(false);
});
