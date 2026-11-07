import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { captureRunInputs } from "../deployments/runInputs";
import { buildRunReport } from "../reports/report";
import { challengeSeed, specHash } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { validateChallengeVersions } from "../challenges/validate";
import { readPrediction } from "../challenges/prediction";
import { checkLearningAuthoring } from "../learning/authoring";
import { learningContent } from "../learning/content";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const id = "diagnose-query-admission";
const db = (design: ChallengeStarter) => design.resources.find(r => r.id === "db")!;
const raw = (row: ReturnType<typeof attemptRow>) => row.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number};
const metric = (report: ReturnType<typeof buildRunReport>, id: string) => report.terminal!.resources.find(r => r.id === id)!;

test("diagnose-query-admission: one-setting causal runs, wrong fix, saved report and evidence refusals", () => {
  const d = definition(id), start = d.starter!, fixed = REFERENCE[id]!, near = structuredClone(start);
  db(near).skuId = "db.m5.xlarge";
  const restored = structuredClone(fixed); db(restored).dbConcurrency!.activeQueries = 1;
  expect(restored).toEqual(start);
  const restoredNear = structuredClone(near); db(restoredNear).skuId = db(start).skuId;
  expect(restoredNear).toEqual(start);
  const pins = readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8");
  const hash = new RegExp(`"${id}@1": "([a-f0-9]{64})"`).exec(pins)![1]!;
  expect(specHash(d)).toBe(hash);
  expect(validateChallengeVersions([d], {[`${id}@1`]: hash})).toEqual([]);
  expect(validateInfrastructureName(d.title)).toBeNull(); expect(d.hints).toHaveLength(3);
  expect(checkLearningAuthoring(learningContent).labs).toBeGreaterThan(0);
  expect(REVIEWED_CHALLENGES[`${id}@1`]).toEqual({challengeId: id, version: 1, hash});
  const label = LEARNING_REPORT_MEASUREMENTS["Queued queries"];
  expect(label.path).toBe("database.queued");
  const renderer = readFileSync(new URL(`../../../${label.source}`, import.meta.url), "utf8");
  expect(renderer).toContain(label.marker);
  const captured = captureRunInputs(start, d.workload, challengeSeed(d));
  for (const design of [start, fixed, near]) {
    expect(preflight(d, design).errors).toEqual([]);
    const input = captureRunInputs(design, d.workload, challengeSeed(d));
    expect(input.workloadProfile).toEqual(captured.workloadProfile); expect(input.seed).toBe(captured.seed);
    expect(input.catalogSnapshot).toBe(captured.catalogSnapshot); expect(input.adapterProfiles).toEqual(captured.adapterProfiles);
  }
  const prediction = answers(d, {"database-health": "healthy", "busiest-type": "Database"});
  // Both sides are real controlled engine runs; no expected report is hand-authored.
  const rows = [start, fixed, near].map(design => attemptRow(d, design, prediction));
  const reports = rows.map(row => buildRunReport(row));
  const [before, after, wrong] = reports as [typeof reports[number], typeof reports[number], typeof reports[number]];
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  for (const [i, report] of reports.entries()) {
    expect(report.terminal!.simulatedSeconds).toBe(6);
    expect(report.challenge!.predictions.every(p => p.actual !== null)).toBe(true);
    expect(report.actions).toEqual([]);
    expect(metric(report, "db").health).toBe("healthy");
    expect(metric(report, "db").database).toMatchObject({waiting: 0, sessionRefused: 0});
    expect(report.terminal!.traffic!.latency!.typical!.categories.connectionWait!.meanMs).toBe(0);
    const saved = {...rows[i]!, terminalSnapshot: JSON.parse(JSON.stringify(rows[i]!.terminalSnapshot)), runInputs: JSON.parse(JSON.stringify(rows[i]!.runInputs))};
    expect(buildRunReport(saved).terminal).toEqual(report.terminal);
    expect(buildRunReport(saved).challenge).toEqual(report.challenge);
  }
  expect(metric(before, "db").cpu).toBe(50); expect(metric(before, "db").database).toMatchObject({serving: 1, queued: 9});
  expect(metric(before, "db").connections).toBe(10);
  expect(metric(after, "db").database!.queued).toBe(0); expect(metric(after, "db").cpu!).toBeLessThan(80);
  expect(metric(after, "db").connections!).toBeLessThan(metric(before, "db").connections!);
  expect(before.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(250);
  expect(after.terminal!.traffic!.latencyMs.p95!).toBeLessThan(10);
  expect(before.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(800);
  expect(after.terminal!.traffic!.wholeRun!.failed).toBe(0);
  expect(after.terminal!.traffic!.wholeRun!.completed).toBeGreaterThan(7000);
  expect(after.terminal!.traffic!.wholeRun!.inFlight).toBeGreaterThan(0);
  expect(metric(wrong, "db").cpu!).toBeLessThan(metric(before, "db").cpu!);
  expect(metric(wrong, "db").database).toEqual(metric(before, "db").database);
  expect(wrong.terminal!.traffic!.latencyMs).toEqual(before.terminal!.traffic!.latencyMs);
  expect(wrong.terminal!.traffic!.wholeRun).toEqual(before.terminal!.traffic!.wholeRun);

  // A learner can record a measured prediction in another unchanged run before editing.
  const chosen = readPrediction({answers: prediction.answers, reasoning: "DB is Healthy but serves one query with pending work, spare CPU, no lock wait and no session refusals. Test the active query bound."}, d, start.resources.map(r => r.type));
  const unchanged = buildRunReport(attemptRow(d, start, chosen));
  expect(unchanged.challenge!.status).toBe("not-met");
  expect(unchanged.challenge!.predictions.every(p => p.outcome === "matched")).toBe(true);
  expect(unchanged.terminal!.traffic).toEqual(before.terminal!.traffic);
  expect(() => readPrediction({answers: {database: "query-cap", busy: "Database"}}, d, start.resources.map(r => r.type))).toThrow();
  const unsupported = structuredClone(start); db(unsupported).dbConcurrency!.activeQueries = 0;
  expect(preflight(d, unsupported).valid).toBe(false);

  for (const mutate of [
    (row: typeof rows[number]) => { row.terminalSnapshot = null; },
    (row: typeof rows[number]) => { raw(row).simulatedSeconds--; },
    (row: typeof rows[number]) => { raw(row).metricsTopologyRevision++; },
    (row: typeof rows[number]) => { raw(row).traffic = undefined; },
    (row: typeof rows[number]) => { raw(row).traffic!.latencyMs.p95 = null; },
    (row: typeof rows[number]) => { raw(row).traffic!.completedRps = 0; },
  ]) {
    const bad = structuredClone(rows[1]!); mutate(bad);
    expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "latency")!.status).toBe("not-evaluated");
    expect(buildRunReport(bad).challenge!.status).not.toBe("met");
  }
  for (const mutate of [
    (row: typeof rows[number]) => { delete raw(row).traffic!.wholeRun; },
    (row: typeof rows[number]) => { raw(row).traffic!.wholeRun!.throughSecond--; },
    (row: typeof rows[number]) => { raw(row).traffic!.wholeRun!.completed = -1; },
    (row: typeof rows[number]) => { raw(row).traffic!.wholeRun!.failed = Number.MAX_SAFE_INTEGER + 1; },
  ]) {
    const bad = structuredClone(rows[1]!); mutate(bad);
    expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated");
    expect(buildRunReport(bad).challenge!.status).not.toBe("met");
  }
  for (const key of ["failed", "deadlineExceeded", "abandoned"] as const) {
    const bad = structuredClone(rows[1]!); raw(bad).traffic!.wholeRun![key] = 1;
    expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-met");
  }
  const absent = structuredClone(rows[0]!); delete raw(absent).metrics.db!.database;
  expect(metric(buildRunReport(absent), "db").database).toBeUndefined();
  const unknown = structuredClone(rows[0]!); raw(unknown).metrics.db!.database!.queued = null;
  expect(metric(buildRunReport(unknown), "db").database!.queued).toBeNull();
  const malformed = structuredClone(rows[0]!); raw(malformed).metrics.db!.database!.queued = -1;
  expect(buildRunReport(malformed).terminal).toBeNull();
  const noInput = structuredClone(rows[1]!); noInput.runInputs = null; noInput.liveTopology = null;
  expect(buildRunReport(noInput).challenge!.status).not.toBe("met");
  const noChecks = structuredClone(rows[1]!); noChecks.stages = [];
  expect(buildRunReport(noChecks).challenge!.status).not.toBe("met");
  const hashMismatch = structuredClone(rows[1]!); hashMismatch.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(hashMismatch).challenge!.status).toBe("unavailable");
  const running = structuredClone(rows[1]!); running.status = "running"; running.runtimeActive = true; running.terminalSnapshot = null;
  expect(buildRunReport(running).challenge!.criteria.find(c => c.id === "work")!.status).toBe("pending");
  console.info(JSON.stringify({lab: id, variants: reports.map((r, i) => ({variant: ["starter", "reference", "near-miss"][i], status: r.challenge!.status,
    p95: r.terminal!.traffic!.latencyMs.p95, wholeRun: r.terminal!.traffic!.wholeRun, resources: r.terminal!.resources, criteria: r.challenge!.criteria}))}));
}, 120000);
