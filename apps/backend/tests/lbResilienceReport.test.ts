import { expect, test } from "bun:test";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { readRecords } from "../reports/records";
import { buildRunReport } from "../reports/report";
import { checkLessonClaims } from "../learning/claims";
import { findLearningLesson } from "../learning/registry";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { resilienceCases } from "./lbResilienceReport.fixture";
import { definition } from "./challengeHarness";
import { LbRetrySchema, CircuitBreakerSchema } from "../reports/lbResilienceSchema";

const cases = resilienceCases();
const snapshot = (row: typeof cases.retries[number]["row"]) => row.terminalSnapshot as SimulationSnapshot;

test("real retry and per-path circuit counters round-trip unchanged through capture, JSON, checkpoint and terminal reports", () => {
  for (const fixture of [...cases.retries, ...cases.circuits, cases.failedProbes, cases.multiPath]) {
    const last = fixture.samples.at(-1)!, row = JSON.parse(JSON.stringify(fixture.row));
    row.simulationState = row.terminalSnapshot;
    const limits: string[] = [], records = readRecords(row, limits);
    expect(limits).toEqual([]);
    for (const checkpoint of [records.checkpoint!, records.terminal!, fixture.report.terminal!]) {
      const saved = checkpoint.resources.find(r => r.id === "lb")!;
      expect(saved.lbRetry).toEqual(last.metrics.lbRetry);
      expect(saved.circuitBreaker).toEqual(last.metrics.circuitBreaker);
    }
    for (const {metrics, lb, paths, second} of fixture.samples) {
      if (metrics.lbRetry) {
        const {version: _v, sampledAtUs, ...retry} = metrics.lbRetry;
        expect(sampledAtUs).toBe(second * 1_000_000);
        for (const [key, value] of Object.entries(retry)) expect(lb).toHaveProperty(key, value);
      }
      if (metrics.circuitBreaker) expect(metrics.circuitBreaker).toEqual({version: 1, sampledAtUs: second * 1_000_000,
        paths: paths.map(p => ({id: p.id, source: p.source, target: p.target, ...p.circuitBreaker!}))});
    }
  }
  expect(cases.retries.some(c => c.samples.some(s => s.metrics.lbRetry!.activeRetries > 0))).toBe(true);
  expect(cases.retries.some(c => c.samples.some(s => s.metrics.lbRetry!.retriesWaiting > 0))).toBe(true);
  expect(cases.retries[0]!.samples.at(-1)!.metrics.lbRetry!.suppressedByReason["max-attempts"]).toBeGreaterThan(0);
  expect(cases.retries[1]!.samples.at(-1)!.metrics.lbRetry!.suppressedByReason.budget).toBeGreaterThan(0);
  expect(cases.circuits[0]!.samples.at(-1)!.metrics.circuitBreaker!.paths[0]!.state).toBe("open");
  expect(cases.circuits[1]!.samples.at(-1)!.metrics.circuitBreaker!.paths[0]!.probes.succeeded).toBeGreaterThan(0);
  expect(cases.failedProbes.samples.at(-1)!.metrics.circuitBreaker!.paths[0]!.probes.failed).toBeGreaterThan(0);
  expect(cases.multiPath.samples.at(-1)!.metrics.circuitBreaker!.paths.map(p => [p.target, p.state])).toEqual([["app", "open"], ["peer", "closed"]]);
});

test("every added count refuses negative, fractional, nonfinite and unsafe values without manufacturing an outcome", () => {
  const retry = cases.retries[1]!.samples.at(-1)!.metrics.lbRetry!, breaker = cases.circuits[1]!.samples.at(-1)!.metrics.circuitBreaker!;
  const counterPaths = (value: unknown, prefix: string[] = []): string[][] => value && typeof value === "object"
    ? Object.entries(value).flatMap(([key, v]) => counterPaths(v, [...prefix, key])) : typeof value === "number" ? [prefix] : [];
  for (const [value, schema] of [[retry, LbRetrySchema], [breaker, CircuitBreakerSchema]] as const) {
    for (const path of counterPaths(value)) for (const bad of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const copy = structuredClone(value);
      let parent = copy as unknown as Record<string, unknown>;
      for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
      parent[path.at(-1)!] = bad;
      expect(schema.safeParse(copy).success).toBe(false);
    }
  }
});


test("old absent evidence stays absent; malformed, wrong-window and wrong-owner evidence cannot supply a terminal conclusion", () => {
  for (const c of [cases.retries[1]!, cases.circuits[1]!]) {
    const old = structuredClone(c.row); delete snapshot(old).metrics.lb!.lbRetry; delete snapshot(old).metrics.lb!.circuitBreaker;
    const report = buildRunReport(old);
    expect(report.terminal!.resources.find(r => r.id === "lb")!.lbRetry).toBeUndefined();
    expect(report.terminal!.resources.find(r => r.id === "lb")!.circuitBreaker).toBeUndefined();
    for (const mutate of [
      (m: SimulationSnapshot["metrics"][string]) => { if (m.lbRetry) m.lbRetry.version = 2 as never; if (m.circuitBreaker) m.circuitBreaker.version = 2 as never; },
      (m: SimulationSnapshot["metrics"][string]) => { if (m.lbRetry) m.lbRetry.sampledAtUs--; if (m.circuitBreaker) m.circuitBreaker.sampledAtUs--; },
      (m: SimulationSnapshot["metrics"][string]) => { if (m.lbRetry) m.lbRetry.activeRetries = -1; if (m.circuitBreaker) m.circuitBreaker.paths[0]!.source = "another-lb"; },
      (m: SimulationSnapshot["metrics"][string]) => { if (m.lbRetry) m.lbRetry.suppressedByReason.budget = Infinity; if (m.circuitBreaker) m.circuitBreaker.paths.push(m.circuitBreaker.paths[0]!); },
      (m: SimulationSnapshot["metrics"][string]) => { if (m.lbRetry) delete (m.lbRetry as Partial<typeof m.lbRetry>).retriesWaiting; if (m.circuitBreaker) m.circuitBreaker.paths[0]!.state = "recovered" as never; },
    ]) {
      const row = structuredClone(c.row); mutate(snapshot(row).metrics.lb!);
      const failed = buildRunReport(row);
      expect(failed.terminal).toBeNull();
      expect(failed.unknown.join(" ")).toContain("terminal record is malformed");
    }
  }
});

test("claim gate accepts exact audited labels and refuses invented state histories and retry populations", () => {
  const d = definition("retrying-a-full-pool"), source = findLearningLesson(d.id)!;
  if (source.kind !== "executable-lab") throw Error("Expected the existing retry lab");
  const labels = Object.entries(LEARNING_REPORT_MEASUREMENTS).filter(([,m]) => /^(lbRetry|circuitBreaker)\./.test(m.path)).map(([label]) => label);
  expect(labels).toHaveLength(28);
  expect(checkLessonClaims({...source, experiment: {...source.experiment!, evidenceToInspect: labels}}, d)).toEqual([]);
  for (const label of ["Retry success percentage", "Circuit recovery time", "Circuit state history", "All scheduled retry timers"]) {
    expect(checkLessonClaims({...source, experiment: {...source.experiment!, evidenceToInspect: [label]}}, d).join(" ")).toContain("report does not render measurement");
  }
});
