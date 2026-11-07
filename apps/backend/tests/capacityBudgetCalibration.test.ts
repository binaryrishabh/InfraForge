import { expect, test } from "bun:test";
import { findSku } from "@infraforge/catalog";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { captureRunInputs } from "../deployments/runInputs";
import { challengeSeed, findChallenge, specHash } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { validateChallengeVersions } from "../challenges/validate";
import { buildRunReport } from "../reports/report";
import { answers, attemptRow, definition, REFERENCE } from "./challengeHarness";

const d = definition("split-the-capacity-budget");
const predictions = answers(d, {"busiest-type": "Virtual Machine", "overall-health": "healthy"});
const reference = REFERENCE[d.id]!;
const appHeadroom = REFERENCE[`${d.id}-app-headroom`]!;
const dbHeadroom = REFERENCE[`${d.id}-db-headroom`]!;
const size = (s: ChallengeStarter, id: string, skuId: string): ChallengeStarter => ({...s, resources: s.resources.map(r => r.id === id ? {...r, skuId} : r)});
const cpu = (r: ReturnType<typeof buildRunReport>, id: string) => r.terminal!.resources.find(r => r.id === id)!.cpu!;
const cost = (r: ReturnType<typeof buildRunReport>) => r.stages.find(s => s.name === "CostEstimate")!.monthlyEstimateUsd!;
const status = (r: ReturnType<typeof buildRunReport>, id: string) => r.challenge!.criteria.find(c => c.id === id)!.status;
const raw = (r: ReturnType<typeof attemptRow>) => r.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number; overallHealth?: string};

test("capacity budget: two coupled bottlenecks, three passing allocations and an exclusively budget-failing near miss", () => {
  const start = d.starter!;
  const appOnly = size(start, "app", reference.resources[0]!.skuId!);
  const dbOnly = size(start, "db", reference.resources[1]!.skuId!);
  const underCapacity = size(reference, "app", "s-2vcpu-2gb");
  const overBudget = size(appHeadroom, "db", dbHeadroom.resources[1]!.skuId!);
  const designs = [start, appOnly, dbOnly, underCapacity, reference, appHeadroom, dbHeadroom, overBudget];
  expect(validateInfrastructureName(d.title)).toBeNull();
  expect(d).toMatchObject({difficulty: "advanced", engine: "2", version: 2});
  expect(d.hints).toHaveLength(3);
  expect(validateChallengeVersions([findChallenge(d.id, 1)!.definition, d], {
    [`${d.id}@1`]: findChallenge(d.id, 1)!.hash, [`${d.id}@2`]: specHash(d)})).toEqual([]);
  const control = captureRunInputs(start, d.workload, challengeSeed(d));
  for (const design of designs) {
    expect(preflight(d, design).errors).toEqual([]);
    const input = captureRunInputs(design, d.workload, challengeSeed(d));
    expect(input.workloadProfile).toEqual(control.workloadProfile);
    expect(input.catalogSnapshot).toBe(control.catalogSnapshot); expect(input.seed).toBe(control.seed);
    expect(design.connectionLines).toEqual(start.connectionLines);
    // Every priced resource has a real designer-offered SKU; no generic fallback or hidden replica multiplier.
    for (const resource of design.resources) {
      if (resource.type !== "Virtual Machine" && resource.type !== "Database") throw Error("This lab prices only catalog app and database resources.");
      expect(findSku(resource.skuId!)?.category).toBe(resource.type);
    }
  }
  // Each causal edge changes exactly one resource's Instance size; all other saved settings are identical.
  expect(size(appOnly, "app", start.resources[0]!.skuId!)).toEqual(start);
  expect(size(reference, "db", start.resources[1]!.skuId!)).toEqual(appOnly);
  expect(size(reference, "app", start.resources[0]!.skuId!)).toEqual(dbOnly);
  expect(size(underCapacity, "app", reference.resources[0]!.skuId!)).toEqual(reference);
  expect(size(appHeadroom, "app", reference.resources[0]!.skuId!)).toEqual(reference);
  expect(size(dbHeadroom, "db", reference.resources[1]!.skuId!)).toEqual(reference);
  expect(size(overBudget, "db", reference.resources[1]!.skuId!)).toEqual(appHeadroom);
  const rows = designs.map(s => attemptRow(d, s, predictions));
  const reports = rows.map(r => buildRunReport(r));
  const [before, app, db, short, balanced, extraApp, extraDb, excess] = reports as [typeof reports[number], typeof reports[number], typeof reports[number], typeof reports[number], typeof reports[number], typeof reports[number], typeof reports[number], typeof reports[number]];
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "not-met", "not-met", "not-met", "met", "met", "met", "not-met"]);
  expect(cpu(before, "app")).toBe(100); expect(cpu(before, "db")).toBeLessThan(40);
  expect(before.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(1000);
  expect(status(app, "latency")).toBe("met"); expect(status(app, "work")).toBe("met");
  expect(app.challenge!.criteria.filter(c => c.status !== "met").map(c => c.id)).toEqual(["health"]);
  expect(cpu(app, "db")).toBeGreaterThan(95); expect(cpu(app, "app")).toBeLessThan(80);
  expect(cpu(db, "app")).toBe(100); expect(status(db, "latency")).toBe("not-met");
  expect(status(short, "budget")).toBe("met"); expect(status(short, "latency")).toBe("not-met");
  expect(cpu(short, "app")).toBe(100);
  for (const r of [balanced, extraApp, extraDb, excess]) {
    expect(r.terminal!.health).toBe("healthy"); expect(r.terminal!.traffic!.latencyMs.p95!).toBeLessThan(10);
    expect(r.terminal!.traffic!.wholeRun!.completed).toBeGreaterThan(3900);
    expect(r.terminal!.traffic!.wholeRun!.failed).toBe(0);
  }
  expect(cpu(balanced, "db")).toBeLessThan(cpu(app, "db"));
  expect(cpu(extraApp, "app")).toBeLessThan(cpu(balanced, "app"));
  expect(cpu(extraApp, "db")).toBe(cpu(balanced, "db"));
  expect(cpu(extraDb, "db")).toBeLessThan(cpu(balanced, "db"));
  expect(cpu(extraDb, "app")).toBe(cpu(balanced, "app"));
  expect(cost(balanced)).toBeLessThan(cost(extraApp)); expect(cost(extraApp)).toBeLessThan(cost(extraDb));
  for (const r of [extraApp, extraDb, excess]) {
    expect(r.terminal!.traffic!.latencyMs.p95).toBe(balanced.terminal!.traffic!.latencyMs.p95);
    expect(r.terminal!.traffic!.wholeRun!.completed).toBe(balanced.terminal!.traffic!.wholeRun!.completed);
  }
  expect(excess.challenge!.criteria.filter(c => c.status !== "met").map(c => c.id)).toEqual(["budget"]);
  expect(cost(excess)).toBeGreaterThan(180);
  for (const [i, r] of reports.entries()) {
    const priced = designs[i]!.resources.reduce((total, resource) => total + findSku(resource.skuId!)!.monthlyPriceUsd, 0);
    expect(cost(r)).toBe(priced);
    expect(status(r, "sizes")).toBe("met"); expect(r.challenge!.predictions.every(p => p.actual !== null)).toBe(true);
    const reread = buildRunReport({...rows[i]!, runInputs: JSON.parse(JSON.stringify(rows[i]!.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(rows[i]!.terminalSnapshot))});
    expect(reread.challenge).toEqual(r.challenge); expect(reread.terminal).toEqual(r.terminal); expect(reread.stages).toEqual(r.stages);
  }
  const names = ["starter", "app-only", "db-only", "under-capacity", "balanced", "app-headroom", "db-headroom", "over-budget"];
  console.info(JSON.stringify({lab: d.id, variants: reports.map((r, i) => ({variant: names[i], cost: cost(r), p95: r.terminal!.traffic!.latencyMs.p95,
    health: r.terminal!.health, appCpu: cpu(r, "app"), dbCpu: cpu(r, "db"), work: r.terminal!.traffic!.wholeRun,
    verdict: r.challenge!.status, failing: r.challenge!.criteria.filter(c => c.status !== "met").map(c => c.id)}))}));
}, 120000);

test("capacity budget: saved totals and generic requirement evidence are auditable; missing evidence remains unscored", () => {
  const row = attemptRow(d, reference, predictions), report = buildRunReport(row);
  const budget = report.challenge!.criteria.find(c => c.id === "budget")!;
  expect(budget).toMatchObject({status: "met", detail: "Estimated $108.00 a month; the limit is $180.00.", sources: ["stages.CostEstimate.monthlyEstimate"]});
  expect(cost(report)).toBe(108);
  expect((row.stages as Array<{name: string; details: {lineItems: unknown}}>).find(s => s.name === "CostEstimate")!.details.lineItems)
    .toEqual(report.stages.find(s => s.name === "CostEstimate")!.lineItems);
  expect(report.monthlyBudgets).toEqual([{criterionId: "budget", label: d.criteria.find(c => c.id === "budget")!.label, limitUsd: 180, remainingUsd: 72}]);
  for (const value of [undefined, null, -1, "108", Number.NaN, Number.POSITIVE_INFINITY]) {
    const bad = structuredClone(row);
    const stages = bad.stages as Array<{name: string; details: {monthlyEstimate?: unknown}}>;
    stages.find(s => s.name === "CostEstimate")!.details.monthlyEstimate = value;
    expect(status(buildRunReport(bad), "budget")).toBe("not-evaluated");
  }
  const absentCost = structuredClone(row);
  absentCost.stages = (absentCost.stages as Array<{name: string}>).filter(s => s.name !== "CostEstimate");
  expect(status(buildRunReport(absentCost), "budget")).toBe("not-evaluated");
  for (const mutate of [
    (r: typeof row) => { r.terminalSnapshot = null; },
    (r: typeof row) => { raw(r).simulatedSeconds--; },
    (r: typeof row) => { raw(r).metricsTopologyRevision++; },
    (r: typeof row) => { raw(r).traffic!.latencyMs.p95 = null; },
    (r: typeof row) => { raw(r).traffic!.completedRps = 0; },
  ]) { const bad = structuredClone(row); mutate(bad); expect(status(buildRunReport(bad), "latency")).toBe("not-evaluated"); }
  for (const mutate of [
    (r: typeof row) => { delete raw(r).traffic!.wholeRun; },
    (r: typeof row) => { raw(r).traffic!.wholeRun!.throughSecond--; },
    (r: typeof row) => { raw(r).traffic!.wholeRun!.completed = -1; },
  ]) { const bad = structuredClone(row); mutate(bad); expect(status(buildRunReport(bad), "work")).toBe("not-evaluated"); }
  const noHealth = structuredClone(row); delete raw(noHealth).overallHealth;
  expect(status(buildRunReport(noHealth), "health")).toBe("not-evaluated");
  const noDesign = structuredClone(row); noDesign.runInputs = null; noDesign.liveTopology = null;
  expect(status(buildRunReport(noDesign), "sizes")).toBe("not-evaluated");
  expect(buildRunReport(noDesign).challenge!.status).not.toBe("met");
  const wrongHash = structuredClone(row); wrongHash.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(wrongHash).challenge!.status).toBe("unavailable");
  const generic = structuredClone(reference); delete generic.resources[0]!.skuId;
  expect(preflight(d, generic).checks.find(c => c.id === "sizes")!.status).toBe("problem");
}, 30000);
