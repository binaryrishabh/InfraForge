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
import { functionReuseLabFixture } from "./functionReuseLab.fixture";

test("function reuse: idle expiry alone avoids repeated cold starts; more concurrency is ineffective", () => {
  const {d, designs, rows} = functionReuseLabFixture(), reports = rows.map(r => buildRunReport(r));
  const pin = /"keep-a-function-warm@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!;
  expect(specHash(d)).toBe(pin);
  expect(validateChallengeVersions([d], {[`${d.id}@1`]: pin})).toEqual([]);
  expect(validateInfrastructureName(d.title)).toBeNull();
  const inputs = rows.map(r => readRunInputs(r.runInputs));
  for (const design of designs) expect(preflight(d, design).errors).toEqual([]);
  for (const i of [1, 2]) {
    expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({classification: "one-change", count: 1});
    const a = {...rows[0]!, createdAt: new Date(0)}, b = {...rows[i]!, createdAt: new Date(1), improvementSourceId: a.id};
    expect(classifyComparison(a, b)).toMatchObject({available: true, starting: {grade: "one-change-design"}, designChangeReview: {count: 1}, lineage: "source-and-improvement"});
    expect(inputs[i]!.adapterProfiles).toEqual(inputs[0]!.adapterProfiles);
  }
  const restored = structuredClone(designs[1]!); restored.resources[0]!.serverless!.idleExpiryMs = 100;
  expect(restored).toEqual(designs[0]!);
  const nearRestored = structuredClone(designs[2]!); nearRestored.resources[0]!.serverless!.concurrency = 1;
  expect(nearRestored).toEqual(designs[0]!);
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  expect(reports.map(r => r.challenge!.predictions[0]!.actual)).toEqual(["healthy", "healthy", "healthy"]);
  const measurements = reports.map(r => r.terminal!.resources.find(m => m.id === "fn")!);
  const functions = measurements.map(m => m.serverless!);
  expect(functions.map(f => [f.completed, f.coldStarts, f.warmStarts, f.expired, f.lifecycle!.initializationUs])).toEqual([[8, 8, 0, 8, 4800000], [8, 1, 7, 0, 600000], [8, 8, 0, 8, 4800000]]);
  expect(functions[2]).toEqual(functions[0]);
  expect(measurements.map(m => m.cpu ?? null)).toEqual([null, null, null]);
  for (const [i, r] of reports.entries()) {
    expect(r.terminal!.traffic!.wholeRun).toMatchObject({completed: 8, failed: 0, inFlight: 0, percentiles: {p95: null, p99: null}});
    expect(functions[i]).toMatchObject({throttled: 0, timedOut: 0, downstreamCalls: 8, downstreamFailed: 0, active: 0, peakInstances: 1});
    const row = rows[i]!, saved = {...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot))};
    expect(buildRunReport(saved).terminal).toEqual(r.terminal);
    expect(buildRunReport(saved).challenge).toEqual(r.challenge);
    expect(inputs[i]!).toEqual(improvementSource(row, d.id).input);
  }
  expect(guidedReview(reports[0]!, true, null)!.cues).toContainEqual(expect.objectContaining({id: "requirement:reuse", kind: "requirement"}));
  console.info("function-reuse-calibration", JSON.stringify(functions.map(f => ({completed: f.completed, cold: f.coldStarts, warm: f.warmStarts, expired: f.expired, initializationUs: f.lifecycle!.initializationUs, totalDurationUs: f.lifecycle!.totalDurationUs}))));
});
