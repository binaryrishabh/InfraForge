import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { readRunInputs } from "../deployments/runInputs";
import { reviewDesignChanges } from "../challenges/designChanges";
import { preflight } from "../challenges/preflight";
import { specHash } from "../challenges/registry";
import { validateChallengeVersions } from "../challenges/validate";
import { improvementSource } from "../challenges/improvements";
import { guidedReview } from "../challenges/guidedReview";
import { classifyComparison } from "../comparison/classify";
import { buildRunReport } from "../reports/report";
import type { captureSnapshot } from "../simulator/snapshot";
import { lbForwardingLabFixture } from "./lbForwardingLab.fixture";

test("active forwarding admits spare backend capacity; a bigger waiting queue leaves failures unchanged", () => {
  const {d, designs, rows} = lbForwardingLabFixture(), reports = rows.map(r => buildRunReport(r));
  const pin = /"open-the-forwarding-gate@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!;
  expect(specHash(d)).toBe(pin); expect(validateChallengeVersions([d], {[`${d.id}@1`]: pin})).toEqual([]);
  expect(validateInfrastructureName(d.title)).toBeNull();
  const inputs = rows.map(r => readRunInputs(r.runInputs));
  for (const s of designs) expect(preflight(d, s).errors).toEqual([]);
  for (const i of [1, 2]) {
    expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({classification: "one-change", count: 1});
    expect(inputs[i]!.adapterProfiles).toEqual(inputs[0]!.adapterProfiles);
    const a = {...rows[0]!, createdAt: new Date(0)}, b = {...rows[i]!, createdAt: new Date(1), improvementSourceId: a.id};
    expect(classifyComparison(a, b)).toMatchObject({available: true, starting: {grade: "one-change-design"}, designChangeReview: {count: 1}, lineage: "source-and-improvement", challengeConditions: "same"});
  }
  expect(inputs[0]!.adapterProfiles).toContain("lb-admission/1");
  const restore = structuredClone(designs[1]!); restore.resources[0]!.lbAdmission!.maxActive = 1;
  expect(restore).toEqual(designs[0]!);
  const restoreNear = structuredClone(designs[2]!); restoreNear.resources[0]!.lbAdmission!.maxQueued = 64;
  expect(restoreNear).toEqual(designs[0]!);
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  expect(reports.map(r => r.challenge!.predictions[0]!.actual)).toEqual(["Virtual Machine", "Virtual Machine", "Virtual Machine"]);
  const callers = reports.map(r => r.terminal!.traffic!.wholeRun!);
  const lb = reports.map(r => r.terminal!.resources.find(m => m.id === "lb")!.lbAccounting!);
  expect(callers.map(w => [w.completed, w.failed, w.inFlight])).toEqual([[1352, 418, 30], [1799, 0, 1], [1352, 418, 30]]);
  expect(lb.map(m => [m.rejectedAtLb, m.queuedAtLb, m.acceptedByBackend])).toEqual([[418, 1799, 1353], [0, 0, 1800], [418, 1799, 1353]]);
  expect(lb[2]).toEqual(lb[0]); expect(callers[2]).toEqual(callers[0]);
  expect(callers[1]!.completed - 1700).toBeGreaterThan(90);
  expect(1700 - callers[0]!.completed).toBeGreaterThan(300);
  for (const [i, report] of reports.entries()) {
    expect(lb[i]).toMatchObject({queuedAtVm: 0, rejectedByVm: 0, timedOutDownstream: 0});
    expect(report.terminal!.resources.find(m => m.id === "app")!.cpu!).toBeLessThan(50);
    expect(report.terminal!.resources.find(m => m.id === "db")!.cpu!).toBeLessThan(20);
    expect(report.terminal!.resources.find(m => m.id === "lb")!.cpu).toBeUndefined();
    expect(callers[i]).toMatchObject({throughSecond: 6, deadlineExceeded: 0, abandoned: 0});
    expect(callers[i]!.completed + callers[i]!.failed + callers[i]!.inFlight).toBe(1800);
    const row = rows[i]!, saved = {...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot))};
    expect(buildRunReport(saved).terminal).toEqual(report.terminal); expect(buildRunReport(saved).challenge).toEqual(report.challenge);
    expect(improvementSource(row, d.id).input).toEqual(inputs[i]!);
  }
  const latency = reports[0]!.terminal!.traffic!.latency!;
  expect(latency.typical!.categories.loadBalancerPending!.meanMs!).toBeGreaterThan(90);
  expect(reports[1]!.terminal!.traffic!.latency!.typical!.categories.loadBalancerPending!.meanMs).toBe(0);
  expect(guidedReview(reports[0]!, true, null)!.cues).toContainEqual(expect.objectContaining({id: "requirement:work", kind: "requirement"}));
  console.info("lb-forwarding-calibration", JSON.stringify({callers, lb, appCpu: reports.map(r => r.terminal!.resources.find(m => m.id === "app")!.cpu)}));
});

test("forwarding caller criterion refuses absent, stale, malformed and mismatched evidence", () => {
  const {rows} = lbForwardingLabFixture(), good = rows[1]!;
  const raw = (r: typeof good) => r.terminalSnapshot as ReturnType<typeof captureSnapshot>;
  const changes: Array<(r: typeof good) => void> = [
    r => {r.runInputs = null;}, r => {r.terminalSnapshot = null;},
    r => {raw(r).simulatedSeconds--;}, r => {raw(r).metricsTopologyRevision = 1;},
    r => {raw(r).metricsTopologyRevision = -1;}, r => {raw(r).metricsComputedAt = null;},
    r => {delete raw(r).traffic;}, r => {delete raw(r).traffic!.wholeRun;},
    r => {raw(r).traffic!.wholeRun!.throughSecond--;}, r => {raw(r).traffic!.wholeRun!.completed = -1;},
    r => {raw(r).traffic!.wholeRun!.failed = NaN;}, r => {raw(r).traffic!.wholeRun!.abandoned = Number.MAX_SAFE_INTEGER;},
  ];
  for (const [i, change] of changes.entries()) {
    const bad = structuredClone(good); change(bad);
    expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "work")!.status, `mutation ${i}`).toBe("not-evaluated");
  }
  const badIdentity = structuredClone(good); badIdentity.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(badIdentity).challenge!.status).toBe("unavailable");
  const missing = structuredClone(good); delete raw(missing).metrics.lb!.lbAccounting;
  expect(buildRunReport(missing).terminal!.resources.find(r => r.id === "lb")!.lbAccounting).toBeUndefined();
});
