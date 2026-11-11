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
import { createModel2Engine } from "../simulator/model2Engine";
import type { captureSnapshot } from "../simulator/snapshot";
import { cpuBudgetLabFixture } from "./cpuBudgetLab.fixture";

test("CPU quota releases useful service; extra workers share the same exhausted budget", () => {
  const {d, designs, rows} = cpuBudgetLabFixture(), reports = rows.map(r => buildRunReport(r));
  const pin = /"release-the-cpu-budget@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!;
  expect(specHash(d)).toBe(pin); expect(validateChallengeVersions([d], {[`${d.id}@1`]: pin})).toEqual([]);
  expect(validateInfrastructureName(d.title)).toBeNull(); expect(d.hints).toHaveLength(3);
  const inputs = rows.map(r => readRunInputs(r.runInputs));
  for (const s of designs) expect(preflight(d, s).errors).toEqual([]);
  for (const i of [1, 2]) {
    expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({classification: "one-change", count: 1});
    expect(inputs[i]!.adapterProfiles).toEqual(inputs[0]!.adapterProfiles);
    expect(inputs[i]!.workloadProfile).toEqual(inputs[0]!.workloadProfile);
    expect(inputs[i]!.seed).toBe(inputs[0]!.seed); expect((inputs[i] as {catalogSnapshot?: string}).catalogSnapshot).toBe((inputs[0] as {catalogSnapshot?: string}).catalogSnapshot);
    const a = {...rows[0]!, createdAt: new Date(0)}, b = {...rows[i]!, createdAt: new Date(1), improvementSourceId: a.id};
    expect(classifyComparison(a, b)).toMatchObject({available: true, starting: {grade: "one-change-design"}, designChangeReview: {count: 1}, lineage: "source-and-improvement", challengeConditions: "same"});
  }
  expect(inputs[0]!.adapterProfiles).toEqual(["vm-execution/1", "vm-cpu-quota/1", "traffic-evidence/2"]);
  const restore = structuredClone(designs[1]!); restore.resources[0]!.vmCpuQuota!.limitPercent = 25;
  expect(restore).toEqual(designs[0]!);
  const restoreNear = structuredClone(designs[2]!); restoreNear.resources[0]!.vmExecution!.workers = 8;
  expect(restoreNear).toEqual(designs[0]!);
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  expect(reports.map(r => r.challenge!.predictions[0]!.actual)).toEqual(["critical", "degraded", "critical"]);
  const callers = reports.map(r => r.terminal!.traffic!.wholeRun!);
  expect(callers.map(w => [w.completed, w.failed, w.inFlight])).toEqual([[496, 1040, 264], [1800, 0, 0], [457, 1023, 320]]);
  expect(callers[1]!.completed - 1650).toBeGreaterThanOrEqual(150);
  expect(1650 - callers[0]!.completed).toBeGreaterThan(1100);
  expect(reports.map(r => r.terminal!.resources[0]!.cpu)).toEqual([25, 90, 25]);
  const rawCompute = inputs.map(input => {
    const run = createModel2Engine(input, d.evaluationSeconds);
    for (let s = 1; s <= d.evaluationSeconds; s++) run.advance();
    return run.evidence().samples.at(-1)!.resources.find(r => r.id === "app")!;
  });
  expect(rawCompute.map(r => r.compute!.workers.configured)).toEqual([8, 8, 64]);
  expect(rawCompute.map(r => r.queued)).toEqual([256, 0, 256]);
  expect(rawCompute.map(r => r.rejected)).toEqual([1040, 0, 1023]);
  expect(rawCompute[0]!.compute!.cpu.appCoreUs).toBe(1500000);
  expect(rawCompute[2]!.compute!.cpu.appCoreUs).toBeCloseTo(1500000, 5);
  expect(rawCompute[1]!.compute!.cpu.appCoreUs).toBe(5400000);
  for (const i of [0, 2]) expect(rawCompute[i]!.compute!.cpu.throttledWallUs).toBeGreaterThan(4400000);
  expect(rawCompute[1]!.compute!.cpu.throttledWallUs).toBe(0);
  for (const [i, report] of reports.entries()) {
    expect(callers[i]).toMatchObject({throughSecond: 6, deadlineExceeded: 0, abandoned: 0});
    expect(callers[i]!.completed + callers[i]!.failed + callers[i]!.inFlight).toBe(1800);
    expect(report.terminal!.resources[0]!.memory).toBeUndefined();
    const row = rows[i]!, saved = {...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot))};
    expect(buildRunReport(saved).terminal).toEqual(report.terminal); expect(buildRunReport(saved).challenge).toEqual(report.challenge);
    expect(inputs[i]!).toEqual(improvementSource(row, d.id).input);
  }
  expect(guidedReview(reports[0]!, true, null)!.cues).toContainEqual(expect.objectContaining({id: "requirement:work", kind: "requirement"}));
  console.info("cpu-budget-calibration", JSON.stringify({callers, cpu: reports.map(r => r.terminal!.resources[0]!.cpu),
    calibrationOnly: rawCompute.map(r => ({queued: r.queued, rejected: r.rejected, appCoreUs: r.compute!.cpu.appCoreUs, throttledWallUs: r.compute!.cpu.throttledWallUs}))}));
}, 120000);

test("CPU budget caller criterion refuses missing, stale, malformed and mismatched evidence", () => {
  const {rows} = cpuBudgetLabFixture(), good = rows[1]!;
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
  const missing = structuredClone(good); delete (raw(missing).metrics.app as {cpu?: number}).cpu;
  expect(buildRunReport(missing).terminal).toBeNull();
  expect(buildRunReport(missing).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated");
});
