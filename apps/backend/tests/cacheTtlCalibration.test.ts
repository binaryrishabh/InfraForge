import { expect, test } from "bun:test";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { preflight } from "../challenges/preflight";
import { challengeSeed } from "../challenges/registry";
import { captureRunInputs } from "../deployments/runInputs";
import { buildRunReport } from "../reports/report";
import { createModel2Engine } from "../simulator/model2Engine";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const d = definition("reuse-before-expiry");
const cache = (s: ChallengeStarter) => s.resources.find(r => r.id === "cache")!;
const raw = (row: ReturnType<typeof attemptRow>) => row.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number};

test("cache TTL: controlled expiry change passes; capacity-only near miss still fails; reports refuse missing evidence", () => {
  const start = d.starter!, fixed = REFERENCE[d.id]!, near = structuredClone(start), restored = structuredClone(fixed);
  cache(restored).cachePolicy!.ttlSeconds = 1;
  expect(restored).toEqual(start); // Exactly one saved control differs.
  cache(near).cachePolicy = {...cache(near).cachePolicy!, version: 2, capacityEntries: 512};
  expect(validateInfrastructureName(d.title)).toBeNull(); expect(d.difficulty).toBe("core");
  const designs = [start, fixed, near];
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const [i, s] of designs.entries()) {
    expect(preflight(d, s).errors).toEqual([]);
    expect(inputs[i]!.workloadProfile).toEqual(inputs[0]!.workloadProfile);
    expect(inputs[i]!.seed).toBe(inputs[0]!.seed);
    expect(inputs[i]!.catalogSnapshot).toBe(inputs[0]!.catalogSnapshot);
    // The adapter tags nondefault TTL only; 60 seconds is its unchanged default.
    expect(inputs[i]!.adapterProfiles).toEqual(i === 1
      ? inputs[0]!.adapterProfiles!.filter(p => p !== "data-cache-policy/1") : inputs[0]!.adapterProfiles);
  }
  const live = inputs.map(input => {
    const run = createModel2Engine(input, d.evaluationSeconds);
    for (let second = 0; second < d.evaluationSeconds; second++) run.advance();
    return run.view();
  });
  const counters = live.map(v => v.metrics.cache!.cache!);
  const [a, b, c] = counters as [typeof counters[number], typeof counters[number], typeof counters[number]];
  for (const n of counters) { expect(n.evictions).toBe(0); expect(n.hits! + n.misses!).toBeGreaterThan(5900); }
  expect(a.expirations).toBeGreaterThan(1000); expect(b.expirations).toBe(0);
  expect(b.hits!).toBeGreaterThan(a.hits!); expect(b.misses!).toBeLessThan(a.misses! / 4);
  expect(c).toEqual(a); // More room cannot stop fill-based expiry.
  const hitRatio = (v: typeof a) => v.hits! / (v.hits! + v.misses!);
  expect(hitRatio(b) - hitRatio(a)).toBeGreaterThan(0.15);
  expect(live[0]!.metrics.db!.cpu!).toBeGreaterThan(15);
  expect(live[1]!.metrics.db!.cpu).toBe(0);
  expect(live[0]!.metrics.app!.cpu).toBe(live[1]!.metrics.app!.cpu);
  const rows = designs.map(s => attemptRow(d, s, answers(d, {"database-health": "healthy"})));
  const reports = rows.map(row => buildRunReport(row));
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  expect(reports[0]!.challenge!.criteria.find(c => c.id === "latency")!.status).toBe("not-met");
  expect(reports[2]!.challenge!.criteria.find(c => c.id === "latency")!.status).toBe("not-met");
  expect(reports[0]!.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(5);
  expect(reports[1]!.terminal!.traffic!.latencyMs.p95!).toBeLessThan(4);
  for (const [i, r] of reports.entries()) {
    expect(r.challenge!.predictions[0]!.actual).toBe("healthy");
    expect(r.terminal!.traffic).toEqual(live[i]!.traffic);
    expect(r.terminal!.resources.find(r => r.id === "db")!.cpu).toBe(live[i]!.metrics.db!.cpu);
    expect(r.terminal!.traffic!.wholeRun!.completed).toBeGreaterThanOrEqual(5900);
    expect(r.terminal!.traffic!.wholeRun).toMatchObject({failed: 0, deadlineExceeded: 0, abandoned: 0, throughSecond: 6});
    // Cache counters are live calibration evidence; the saved report makes no hit-ratio claim.
    expect(r.terminal!.resources.find(r => r.id === "cache")).not.toHaveProperty("cache");
    const saved = {...rows[i]!, runInputs: JSON.parse(JSON.stringify(rows[i]!.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(rows[i]!.terminalSnapshot))};
    expect(buildRunReport(saved).terminal).toEqual(r.terminal);
    expect(buildRunReport(saved).challenge).toEqual(r.challenge);
    console.info(JSON.stringify({lab: d.id, design: ["starter", "TTL-only", "capacity-only"][i], second: 6,
      p95Ms: r.terminal!.traffic!.latencyMs.p95, dbCpu: live[i]!.metrics.db!.cpu,
      callers: r.terminal!.traffic!.wholeRun, liveOnlyCache: counters[i], liveOnlyHitRatio: hitRatio(counters[i]!)}));
  }
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
  const wrongHash = structuredClone(rows[1]!); wrongHash.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(wrongHash).challenge!.status).toBe("unavailable");
  const noInputs = structuredClone(rows[1]!); noInputs.runInputs = null; noInputs.liveTopology = null;
  expect(buildRunReport(noInputs).challenge!.status).not.toBe("met");
  const noChecks = structuredClone(rows[1]!); noChecks.stages = [];
  expect(buildRunReport(noChecks).challenge!.status).not.toBe("met");
  const invalid = structuredClone(start); cache(invalid).cachePolicy!.ttlSeconds = 0;
  expect(preflight(d, invalid).valid).toBe(false);
  expect(() => captureRunInputs(invalid, d.workload)).toThrow();
}, 180000);
