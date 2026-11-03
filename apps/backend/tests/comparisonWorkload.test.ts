import { expect, test } from "bun:test";
import { captureRunInputs } from "../deployments/runInputs";
import { createWorkloadVariantInput } from "../reruns/variants";
import { classifyComparison } from "../comparison/classify";
import type { StoredRun } from "../reports/report";
import { layout, workload } from "./integration/scenario";

const input = captureRunInputs(layout, workload, "compare-workload"), at = new Date(0);
const variant = createWorkloadVariantInput(input, {dimension: "arrival-process", value: "poisson"});
const whole = {version: 1, throughSecond: 20, completed: 100, failed: 2, deadlineExceeded: 1, abandoned: 1, inFlight: 3,
  minMs: 1, maxMs: 2, percentiles: {p50: {lowMs: 1, highMs: 1.02}, p95: {lowMs: 2, highMs: 2.04}, p99: {lowMs: 2, highMs: 2.04}},
  resolution: "log-linear-32/1", relativeErrorBound: 0.03125, window: "whole run from start through this second"};
const terminal = {version: 1, kind: "terminal", capturedAt: at.toISOString(), topologyRevision: 0, simulatedSeconds: 20,
  accumulatedCostUsd: 0, overallHealth: "healthy", metrics: {}, traffic: {offeredRps: 7, completedRps: 4, failedRps: 1,
    latencyMs: {p50: 3, p95: 4, p99: 5}, wholeRun: whole}};
function row(id: string, changes: Partial<StoredRun> = {}): StoredRun {
  return {id, infrastructureId: null, status: "completed", resourceCount: input.resources.length, createdAt: at, updatedAt: at,
    topologyRevision: 0, stages: [], timeline: [], chaosEvents: [], actions: [], actionCount: 0, simulationState: null,
    runInputs: input, seed: input.seed, workloadProfile: input.workloadProfile, liveTopology: layout, terminalSnapshot: terminal, ...changes};
}
const compare = (changes: Partial<StoredRun> = {}) => classifyComparison(row("a"), row("b", {sourceRunId: "a", rerunMode: "workload-variant", runInputs: variant, ...changes}));
test("linked one-workload pairs describe before/after, preserved conditions and honest causal limits", () => {
  const pair = compare();
  expect(pair.starting.grade).toBe("one-change-workload");
  const observed = pair.observed.find(f => f.id === "workload-change")!;
  expect(observed.message).toContain("Arrival process: even → poisson");
  for (const field of ["topology", "resources", "seed", "model/catalog", "other workload fields"]) expect(observed.message).toContain(field);
  const interpretation = pair.interpreted.find(f => f.id === "workload-pair")!.message;
  for (const word of ["only recorded starting-input difference", "same seed", "random draws", "offered requests", "finite Poisson sample", "Another seed"]) expect(interpretation).toContain(word);
  expect(pair.unknown.find(f => f.id === "workload-pair")?.message).toContain("one pair, one seed");
  expect(compare({terminalSnapshot: {...terminal, simulatedSeconds: 21}}).interpreted.some(f => f.id === "workload-pair")).toBe(false);
  expect(compare({sourceRunId: null}).observed.some(f => f.id === "workload-change")).toBe(false);
  const cpu = createWorkloadVariantInput(input, {dimension: "application-cpu-variability", value: "moderate"});
  expect(compare({runInputs: cpu}).observed.find(f => f.id === "workload-change")?.message).toContain("Application CPU variability: fixed (CV 0) → moderate (CV 0.5)");
});
test("configured targets show their difference as a starting input; whole-run originals use recorded totals and equal exact durations", () => {
  const rows = compare().traffic!;
  expect(rows.find(m => m.field === "Configured target rate (starting input)")).toMatchObject({earlier: workload.targetThroughput / 3600, later: workload.targetThroughput / 3600, delta: 0});
  expect(rows.find(m => m.field === "Original requests offered, whole run")).toMatchObject({earlier: 107, later: 107, delta: 0});
  expect(rows.find(m => m.field === "Original requests completed, whole run")?.earlier).toBe(100);
  expect(rows.find(m => m.field.startsWith("Original requests failed"))?.earlier).toBe(4);
  const shorter = compare({terminalSnapshot: {...terminal, simulatedSeconds: 10, traffic: {...terminal.traffic, wholeRun: {...whole, throughSecond: 10, completed: 50}}}});
  expect(shorter.traffic!.filter(m => m.field.startsWith("Original requests")).every(m => m.delta === null && m.withheldReason === "Different observation durations: whole-run totals are not comparable.")).toBe(true);
  const checkpoint = compare({terminalSnapshot: null, simulationState: terminal});
  expect(checkpoint.traffic!.filter(m => m.field.startsWith("Original requests")).every(m => m.delta === null)).toBe(true);
});
test("missing original evidence stays Unknown rather than using last-second requests or attempt counts", () => {
  const {wholeRun: _, ...traffic} = terminal.traffic;
  const missing = compare({terminalSnapshot: {...terminal, traffic}}).traffic!;
  expect(missing.find(m => m.field === "Original requests offered, whole run")).toMatchObject({earlier: 107, later: null, delta: null});
  const missingBoth = classifyComparison(row("a", {terminalSnapshot: null}), row("b", {runInputs: variant, sourceRunId: "a", terminalSnapshot: null}));
  expect(missingBoth.traffic!.find(m => m.field === "Original requests completed, whole run")).toMatchObject({earlier: null, later: null, delta: null});
  expect(compare({sourceRunId: null}).traffic).toHaveLength(8);
});
test("objective-only records provide originals without inventing an offered count from rate", () => {
  const {wholeRun: _, ...traffic} = terminal.traffic;
  const objective = {version: 1, objective: {version: 1, maxResponseMs: 20, targetSuccessPercent: 95}, throughUs: 20_000_000, horizonUs: 20_000_000,
    offered: 10, good: 6, late: 1, failed: 1, deadlineExceeded: 1, abandoned: 0, unresolvedPastThreshold: 1, pending: 0,
    status: "missed", measuredFraction: 0.6, worstCaseFraction: 0.6, bestCaseFraction: 0.6};
  const rows = compare({terminalSnapshot: {...terminal, traffic: {...traffic, objective}}}).traffic!;
  expect(rows.find(m => m.field === "Original requests offered, whole run")?.later).toBe(10);
  expect(rows.find(m => m.field === "Original requests completed, whole run")?.later).toBe(7);
  expect(rows.find(m => m.field.startsWith("Original requests failed"))?.later).toBe(2);
});
