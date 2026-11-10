import { expect, test } from "bun:test";
import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import { buildRunReport, type StoredRun } from "../reports/report";
import type { captureSnapshot } from "../simulator/snapshot";
import { readRunInputs } from "../deployments/runInputs";
import { evaluatePoolInService } from "../challenges/poolCriterion";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const ID = "scale-on-delivered-samples";
let cached: { d: ReturnType<typeof definition>; start: StoredRun; ref: StoredRun } | undefined;
function fixture() {
  if (cached) return cached;
  const d = definition(ID), a = answers(d, { "scale-out": "yes" });
  return cached = { d, start: attemptRow(d, d.starter!, a), ref: attemptRow(d, REFERENCE[ID]!, a) };
}
const criterionId = () => fixture().d.criteria.find(c => c.kind === "pool-in-service")!.id;
const snapshot = (r: StoredRun) => r.terminalSnapshot as ReturnType<typeof captureSnapshot>;
const controller = (r: StoredRun) => snapshot(r).metrics.app!.startup!.controllers![0]!;
const result = (r: StoredRun) => buildRunReport(r).challenge!.criteria.find(c => c.id === criterionId())!;
const design = (r: StoredRun) => (r.runInputs as { resources: Array<{ id: string; type: string; autoscaling?: { signal?: unknown; enabled?: boolean } }> }).resources;

test("pool-in-service is met by the one-change reference and not met by the starter, from recorded pool readings", () => {
  const { start, ref } = fixture();
  expect([result(ref).status, result(start).status]).toEqual(["met", "not-met"]);
  expect(result(ref).detail).toContain("in service");
  expect(controller(start).missingMeasurements).toBe(controller(start).evaluations);
  expect(controller(ref).missingMeasurements).toBeLessThan(controller(ref).evaluations!);
  expect(controller(ref).signal).toMatchObject({ source: "observed-core-time", backend: "monitor/backend" });
});

type Mutate = (r: StoredRun) => void;
const refusals: Array<[string, Mutate]> = [
  ["missing terminal", r => { r.terminalSnapshot = null; }],
  ["checkpoint only", r => { r.simulationState = r.terminalSnapshot; r.terminalSnapshot = null; }],
  ["active flag with terminal", r => { r.runtimeActive = true; }],
  ["active status with terminal", r => { r.status = "running"; }],
  ["wrong horizon", r => { snapshot(r).simulatedSeconds--; }],
  ["stale metrics revision", r => { snapshot(r).metricsTopologyRevision++; }],
  ["stale terminal revision", r => { r.topologyRevision++; }],
  ["initialized metrics", r => { snapshot(r).metricsComputedAt = null; }],
  ["missing capture", r => { r.runInputs = null; }],
  ["missing accepted topology", r => { r.liveTopology = null; }],
  ["changed live topology", r => { r.liveTopology = structuredClone(r.liveTopology); (r.liveTopology as { resources: Array<{ id: string }> }).resources[0]!.id = "replacement"; }],
  ["missing startup reading", r => { delete snapshot(r).metrics.app!.startup; }],
  ["no controllers", r => { snapshot(r).metrics.app!.startup!.controllers = []; }],
  ["unknown controllers", r => { snapshot(r).metrics.app!.startup!.controllers = null; }],
  ["duplicate controller", r => { const s = snapshot(r).metrics.app!.startup!; s.controllers = [s.controllers![0]!, s.controllers![0]!]; }],
  ["other controller only", r => { controller(r).id = "other"; }],
  ["controller without the selected signal", r => { controller(r).signal = null; }],
  ["pool owner missing", r => { delete snapshot(r).metrics.app; }],
  ["live design lost its signal", r => { r.liveTopology = structuredClone(r.liveTopology); delete (r.liveTopology as { resources: Array<{ id: string; autoscaling?: { signal?: unknown } }> }).resources.find(x => x.id === "app")!.autoscaling!.signal; }],
  ["captured design lost its signal", r => { r.runInputs = structuredClone(r.runInputs); delete design(r).find(x => x.id === "app")!.autoscaling!.signal; }],
  ["captured pool is not enabled", r => { r.runInputs = structuredClone(r.runInputs); design(r).find(x => x.id === "app")!.autoscaling!.enabled = false; }],
  ["captured pool is not an app server", r => { r.runInputs = structuredClone(r.runInputs); design(r).find(x => x.id === "app")!.type = "Database"; }],
  ["missing evaluation count", r => { controller(r).evaluations = null; }],
  ["missing-measurement count exceeds evaluations", r => { controller(r).missingMeasurements = controller(r).evaluations! + 1; }],
];
for (const field of ["inService", "desired", "evaluations", "missingMeasurements"] as const) for (const value of [null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  refusals.push([`${field}=${value}`, r => { controller(r)[field] = value; }]);
}
test.each(refusals)("pool-in-service refuses %s", (_name, mutate) => {
  const r = structuredClone(fixture().ref); mutate(r);
  expect(result(r).status).toBe("not-evaluated");
});

test("pool evaluator never turns unknown readings into a verdict and respects its floor", () => {
  const { d, ref } = fixture(), c = d.criteria.find(x => x.kind === "pool-in-service") as Extract<ChallengeCriterion, { kind: "pool-in-service" }>;
  const input = readRunInputs(ref.runInputs), terminal = buildRunReport(ref).terminal!;
  expect(evaluatePoolInService(c, input, terminal, 90, false).met).toBe(true);
  expect(evaluatePoolInService({ ...c, minInService: controller(ref).inService! + 1 }, input, terminal, 90, false).met).toBe(false);
  expect(evaluatePoolInService(c, input, terminal, 90, true).met).toBeUndefined();
  expect(evaluatePoolInService(c, input, terminal, 89, false).met).toBeUndefined();
  expect(evaluatePoolInService(c, null, terminal, 90, false).met).toBeUndefined();
  expect(evaluatePoolInService(c, input, null, 90, false).met).toBeUndefined();
  expect(evaluatePoolInService({ ...c, resourceId: "missing" }, input, terminal, 90, false).met).toBeUndefined();
});
