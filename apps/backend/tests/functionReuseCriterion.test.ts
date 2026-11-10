import { expect, test } from "bun:test";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { evaluateFunctionReuse } from "../challenges/functionReuseCriterion";
import { validateChallengeVersions } from "../challenges/validate";
import { specHash } from "../challenges/registry";
import { buildRunReport } from "../reports/report";
import { functionReuseLabFixture } from "./functionReuseLab.fixture";

test("function reuse refuses missing, stale, contradictory and foreign evidence", () => {
  const {d, rows} = functionReuseLabFixture(), good = rows[1]!, raw = (r: typeof good) => r.terminalSnapshot as SimulationSnapshot;
  const f = (r: typeof good) => raw(r).metrics.fn!.serverless!;
  const changes: Array<(r: typeof good) => void> = [
    r => {r.runInputs = null;}, r => {r.terminalSnapshot = null;}, r => {r.runtimeActive = true;}, r => {r.topologyRevision++;},
    r => {raw(r).simulatedSeconds--;}, r => {raw(r).metricsTopologyRevision = -1;},
    r => {delete raw(r).metrics.fn!.serverless;}, r => {delete f(r).lifecycle;},
    r => {f(r).coldStarts++;}, r => {f(r).completed = -1;}, r => {f(r).warmStarts = Number.NaN;},
    r => {f(r).expired = 2;}, r => {f(r).active++;}, r => {f(r).initialized = 2;},
    r => {f(r).lifecycle!.settled--;}, r => {f(r).lifecycle!.initializationUs++;},
    r => {raw(r).metrics.other = raw(r).metrics.fn!; delete raw(r).metrics.fn;},
  ];
  for (const [i, change] of changes.entries()) {
    const bad = structuredClone(good); change(bad);
    expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "reuse")!.status, `mutation ${i}`).toBe("not-evaluated");
  }
  const report = buildRunReport(good), c = d.criteria.find(c => c.kind === "function-reuse")!;
  if (c.kind !== "function-reuse") throw Error("Expected reuse criterion");
  for (const input of [null, {...d.starter!, resources: []}, {...d.starter!, resources: [...d.starter!.resources, d.starter!.resources[0]!]}]) {
    expect(evaluateFunctionReuse(c, input, report.terminal, 8).met).toBeUndefined();
  }
  expect(evaluateFunctionReuse(c, d.starter!, {...report.terminal!, measurementFreshness: "previous-revision"}, 8).met).toBeUndefined();
  expect(evaluateFunctionReuse(c, d.starter!, {...report.terminal!, resources: [...report.terminal!.resources, report.terminal!.resources[0]!]}, 8).met).toBeUndefined();
  expect(evaluateFunctionReuse({...c, minCompleted: 0}, d.starter!, report.terminal, 8).met).toBeUndefined();
  expect(evaluateFunctionReuse({...c, minCompleted: 9}, d.starter!, report.terminal, 8).met).toBe(false);
  const invalid = structuredClone(good); invalid.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(invalid).challenge!.status).toBe("unavailable");
});

test("function reuse authoring rejects invalid identity and budgets", () => {
  const {d} = functionReuseLabFixture();
  for (const patch of [{resourceId: "db"}, {resourceId: "missing"}, {minCompleted: 0}, {minCompleted: 1.5}, {maxColdStarts: -1}, {maxColdStarts: Number.MAX_SAFE_INTEGER + 1}, {maxUnsuccessful: -1}]) {
    const bad = structuredClone(d); Object.assign(bad.criteria[1]!, patch);
    expect(validateChallengeVersions([bad], {[`${d.id}@1`]: specHash(bad)}).join(" ")).toContain("function-reuse");
  }
});

test("function reuse counts every recorded unsuccessful outcome against the budget", () => {
  const {d, rows} = functionReuseLabFixture(), report = buildRunReport(rows[1]!);
  const c = d.criteria.find(c => c.kind === "function-reuse")!;
  if (c.kind !== "function-reuse") throw Error("Expected reuse criterion");
  for (const key of ["failed", "timedOut", "cancelled", "throttled", "unavailable", "duplicate"] as const) {
    const t = structuredClone(report.terminal!), f = t.resources.find(r => r.id === "fn")!.serverless!;
    f[key]++;
    if (["failed", "timedOut", "cancelled"].includes(key)) {f.completed--;} else {f.received++;}
    expect(evaluateFunctionReuse({...c, minCompleted: 7}, d.starter!, t, 8).met, key).toBe(false);
    expect(evaluateFunctionReuse({...c, minCompleted: 7, maxUnsuccessful: 1}, d.starter!, t, 8).met, key).toBe(true);
  }
});
