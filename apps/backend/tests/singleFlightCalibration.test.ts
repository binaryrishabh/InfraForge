import { expect, test } from "bun:test";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { preflight } from "../challenges/preflight";
import { challengeSeed } from "../challenges/registry";
import { recordedScenario } from "../challenges/scenario";
import { captureRunInputs } from "../deployments/runInputs";
import { buildRunReport } from "../reports/report";
import { createModel2Engine } from "../simulator/model2Engine";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

test("single-flight: only joining fills relieves repeated source work; reports refuse missing evidence and scenario receipts", () => {
  const d = definition("share-a-cache-fill"), start = d.starter!, fixed = REFERENCE[d.id]!;
  const restored = structuredClone(fixed), near = structuredClone(start);
  restored.resources.find(r => r.id === "cache")!.cachePolicy!.singleFlight = false;
  expect(restored).toEqual(start);
  near.resources.find(r => r.id === "cache")!.cachePolicy!.capacityEntries = 32;
  expect(validateInfrastructureName(d.title)).toBeNull();
  const designs = [start, fixed, near], inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const [i, design] of designs.entries()) {
    expect(preflight(d, design).errors).toEqual([]);
    expect(inputs[i]!.workloadProfile).toEqual(inputs[0]!.workloadProfile);
    expect(inputs[i]!.seed).toBe(inputs[0]!.seed);
    expect(inputs[i]!.adapterProfiles).toEqual(inputs[0]!.adapterProfiles);
    expect(inputs[i]!.catalogSnapshot).toBe(inputs[0]!.catalogSnapshot);
  }
  const live = inputs.map(input => {
    const run = createModel2Engine(input, d.evaluationSeconds), scenario = recordedScenario(d, input)!;
    for (let second = 1; second <= d.evaluationSeconds; second++) {
      run.advance();
      for (const step of scenario.steps.filter(s => s.atSecond === second)) {
        expect(run.apply({kind: "intervention", parameters: step.request}).outcome.intervention).toEqual(scenario.receipts[0]);
        while (run.catchingUp) run.catchUp(10);
      }
    }
    return {view: run.view(), data: run.evidence().data};
  });
  const fetches = live.map(r => r.data.applications.reduce((n, a) => n + a.databaseFetches, 0));
  const joined = live.map(r => r.data.applications.reduce((n, a) => n + a.coalescedWaiters, 0));
  expect(joined[0]).toBe(0); expect(joined[1]!).toBeGreaterThanOrEqual(15); expect(joined[2]).toBe(0);
  expect(fetches[1]!).toBeLessThan(fetches[0]! / 4); expect(fetches[2]).toBe(fetches[0]);
  for (const [i, r] of live.entries()) {
    expect(r.data.databases[0]!.logicalReads).toBe(fetches[i]!);
    expect(r.view.metrics.cache!.cache!.evictions).toBe(0);
    expect(r.view.traffic.wholeRun).toMatchObject({completed: 1000, failed: 0, deadlineExceeded: 0, abandoned: 0, inFlight: 0, throughSecond: 5});
  }
  const rows = designs.map(s => attemptRow(d, s, answers(d, {"database-health": "healthy"})));
  const reports = rows.map(row => buildRunReport(row));
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  expect(reports[0]!.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(100);
  expect(reports[1]!.terminal!.traffic!.latencyMs.p95!).toBeLessThan(10);
  expect(reports[2]!.terminal!.traffic).toEqual(reports[0]!.terminal!.traffic);
  for (const [i, report] of reports.entries()) {
    expect(report.terminal!.traffic).toEqual(live[i]!.view.traffic);
    expect(report.challenge!.predictions[0]!.actual).toBe("healthy");
    expect(report.terminal!.resources.find(r => r.id === "cache")).not.toHaveProperty("cache");
    const saved = {...rows[i]!, runInputs: JSON.parse(JSON.stringify(rows[i]!.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(rows[i]!.terminalSnapshot))};
    expect(buildRunReport(saved).terminal).toEqual(report.terminal);
    expect(buildRunReport(saved).challenge).toEqual(report.challenge);
    console.info(JSON.stringify({lab: d.id, design: ["starter", "single-flight-only", "capacity-only"][i],
      p95Ms: report.terminal!.traffic!.latencyMs.p95, callers: report.terminal!.traffic!.wholeRun,
      databaseCpu: report.terminal!.resources.find(r => r.id === "db")!.cpu,
      liveOnlyDatabaseFetches: fetches[i], liveOnlyJoinedWaiters: joined[i]}));
  }
  const raw = (r: typeof rows[number]) => r.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number};
  for (const mutate of [
    (r: typeof rows[number]) => { r.terminalSnapshot = null; },
    (r: typeof rows[number]) => { raw(r).simulatedSeconds--; },
    (r: typeof rows[number]) => { raw(r).metricsTopologyRevision++; },
    (r: typeof rows[number]) => { raw(r).traffic!.latencyMs.p95 = null; },
    (r: typeof rows[number]) => { delete raw(r).traffic; },
  ]) {
    const bad = structuredClone(rows[1]!); mutate(bad);
    expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "latency")!.status).toBe("not-evaluated");
  }
  for (const mutate of [
    (r: typeof rows[number]) => { delete raw(r).traffic!.wholeRun; },
    (r: typeof rows[number]) => { raw(r).traffic!.wholeRun!.throughSecond--; },
    (r: typeof rows[number]) => { raw(r).traffic!.wholeRun!.completed = -1; },
  ]) {
    const bad = structuredClone(rows[1]!); mutate(bad);
    expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated");
  }
  for (const mutate of [
    (r: typeof rows[number]) => { r.actions = []; },
    (r: typeof rows[number]) => { r.challengeScenario = null; },
    (r: typeof rows[number]) => { r.actions![0]!.outcome = null; },
    (r: typeof rows[number]) => { r.actions![0]!.status = "running"; r.actions![0]!.completedAt = null; },
    (r: typeof rows[number]) => { r.runInputs = null; r.liveTopology = null; },
    (r: typeof rows[number]) => { r.stages = []; },
  ]) {
    const bad = structuredClone(rows[1]!); mutate(bad);
    expect(buildRunReport(bad).challenge!.status).not.toBe("met");
  }
  const wrongHash = structuredClone(rows[1]!); wrongHash.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(wrongHash).challenge!.status).toBe("unavailable");
  const missingDb = structuredClone(start); missingDb.resources = missingDb.resources.filter(r => r.id !== "db");
  expect(preflight(d, missingDb).valid).toBe(false);
}, 120000);
