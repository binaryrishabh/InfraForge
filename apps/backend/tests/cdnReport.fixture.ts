import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import type { ContractBuilder, Quantity } from "@infraforge/simulation/internal-product";
import { buildRunReport, type StoredRun } from "../reports/report";
import { cdnLayout, cdnWorkload } from "./cdnTtl.fixture";

// Only the purge-fence cases use synthetic origin delays, to cross an action boundary.
// This changes test contracts, never engine behavior or the learner's calibration.
export const slowCdnOrigin: ContractBuilder = (...args) => {
  const built = buildModel2Contract(...args);
  if ("refused" in built) return built;
  const set = (quantity: Quantity<"us">, value: number) => {
    if (quantity.kind !== "known") throw Error("Expected known timing");
    quantity.value = value;
    const entry = built.contract.ledger.find(e => e.id === quantity.provenance[0])!;
    entry.quantity = {...quantity}; entry.formula = String(value);
  };
  for (const node of Object.values(built.contract.nodes)) for (const role of node.resources) {
    if (role.config.kind === "cdn" || role.config.kind === "object-store") set(role.config.timeout, 4_000_000);
    if (role.config.kind === "object-store") set(role.config.demands.get!.wait, 2_000_000);
  }
  return built;
};

export function cdnReportFixture() {
  const cases = (["expiry", "shared-fill", "independent-fills", "warm-purge", "waiter-limit"] as const).map(mode => {
    const slow = ["shared-fill", "independent-fills", "waiter-limit"].includes(mode);
    const layout = cdnLayout(mode === "expiry" ? 1 : 60);
    if (slow) layout.resources[0]!.cdnCachePolicy = {version: 2, ttlSeconds: 60, coalesce: mode !== "independent-fills", maxWaiters: mode === "waiter-limit" ? 1 : undefined};
    // maxWaiters is only legal when coalescing is enabled.
    if (mode === "independent-fills") layout.resources[0]!.cdnCachePolicy = {version: 2, ttlSeconds: 60, coalesce: false};
    const input = captureRunInputs(layout, {...cdnWorkload, targetThroughput: 240}, "cdn-report");
    const run = createModel2Engine(input, 10, slow ? slowCdnOrigin : buildModel2Contract);
    for (let s = 1; s <= 10; s++) {
      run.advance();
      if (s === 1 && mode !== "expiry" && mode !== "waiter-limit") run.apply({kind: "intervention", parameters: {interventionId: "cdn-purge", revision: 1, target: {resourceId: "cdn"}, parameters: {}}});
    }
    const view = run.view();
    const snapshot = {...view, version: 1, kind: "terminal", capturedAt: "2026-11-08T00:00:00.000Z", topologyRevision: 0, accumulatedCostUsd: 0};
    const row = {id: mode, infrastructureId: null, runName: "CDN evidence", status: "torn-down", resourceCount: input.resources.length,
      createdAt: new Date(snapshot.capturedAt), updatedAt: new Date(snapshot.capturedAt), topologyRevision: 0, stages: [], timeline: [], chaosEvents: [],
      workloadProfile: input.workloadProfile, seed: input.seed, simulationState: snapshot as unknown, runInputs: input, liveTopology: input,
      terminalSnapshot: JSON.parse(JSON.stringify(snapshot))} satisfies StoredRun;
    return {mode, row, raw: run.evidence().systems.cdns[0]!, report: buildRunReport(row)};
  });
  const base = cases[0]!.row;
  const variant = (change: (row: typeof base) => void) => { const row = structuredClone(base); row.simulationState = null; change(row); return buildRunReport(row); };
  return {cases,
    missing: variant(row => { delete row.terminalSnapshot.metrics.cdn.cdn; }),
    unknown: variant(row => { row.terminalSnapshot.metrics.cdn.cdn.hits = null; }),
    invalid: [-1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(value => variant(row => { row.terminalSnapshot.metrics.cdn.cdn.hits = value; })),
    inventedRefusal: variant(row => { row.terminalSnapshot.metrics.cdn.cdn["cdn-waiter-capacity"] = 0; }),
    checkpointOnly: variant(row => { row.simulationState = row.terminalSnapshot; row.terminalSnapshot = null; }),
  };
}
if (import.meta.main) console.log(JSON.stringify(cdnReportFixture()));
