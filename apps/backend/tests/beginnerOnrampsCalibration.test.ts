import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { preflight } from "../challenges/preflight";
import { buildRegistry, challengeSeed, specHash } from "../challenges/registry";
import { validateChallengeVersions } from "../challenges/validate";
import { captureRunInputs } from "../deployments/runInputs";
import { buildRunReport } from "../reports/report";
import { learningContent } from "../learning/content";
import { checkLearningAuthoring } from "../learning/authoring";
import { definition, REFERENCE, attemptRow, answers } from "./challengeHarness";

const ids = ["keep-waiting-work", "check-the-missing-server"];
test("scaling and data level by kind audit uses registered canonical lessons", () => {
  const table = ["scaling", "data"].map(track => ({track, counts: Object.fromEntries(
    ["beginner", "intermediate", "advanced"].map(level => [level, Object.fromEntries(
      ["reading", "conceptual-exercise", "executable-lab"].map(kind => [kind,
        learningContent.lessons.filter(l => l.trackId === track && l.level === level && l.kind === kind).length]))]))}));
  for (const row of table) {
    const registered = learningContent.tracks.find(t => t.id === row.track)!.modules.flatMap(m => m.lessonIds);
    const canonical = learningContent.lessons.filter(l => l.trackId === row.track).map(l => l.id);
    expect(registered.toSorted()).toEqual(canonical.toSorted());
    expect(new Set(registered).size).toBe(registered.length);
  }
  console.info(JSON.stringify(table));
});
const resource = (s: ChallengeStarter, id: string) => s.resources.find(r => r.id === id)!;
const raw = (row: ReturnType<typeof attemptRow>) => row.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number};
const predict = (id: string) => answers(definition(id), {"overall-health": "healthy"});

for (const id of ids) test(`${id}: starter fails, single setting passes, near miss fails; saved report refuses missing proof`, () => {
  const d = definition(id), start = d.starter!, fixed = REFERENCE[id]!, near = structuredClone(start), restored = structuredClone(fixed);
  if (id === ids[0]) {
    resource(restored, "queue").asyncQueue!.retentionSeconds = 1;
    resource(near, "queue").asyncQueue!.capacityMessages = 1000;
  } else {
    resource(restored, "lb").lbHealth!.intervalSeconds = 60;
    resource(near, "peer").skuId = "c5.xlarge";
  }
  expect(restored).toEqual(start);
  const captured = captureRunInputs(start, d.workload, challengeSeed(d));
  for (const design of [start, fixed, near]) {
    expect(preflight(d, design).errors).toEqual([]);
    const input = captureRunInputs(design, d.workload, challengeSeed(d));
    expect(input.workloadProfile).toEqual(captured.workloadProfile); expect(input.seed).toBe(captured.seed);
    expect(input.adapterProfiles).toEqual(captured.adapterProfiles); expect(input.catalogSnapshot).toBe(captured.catalogSnapshot);
  }
  const pins = readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8");
  const hash = new RegExp(`"${id}@1": "([a-f0-9]{64})"`).exec(pins)?.[1];
  expect(hash).toBe(specHash(d)); expect(validateChallengeVersions([d], {[`${id}@1`]: hash!})).toEqual([]);
  expect(validateInfrastructureName(d.title)).toBeNull(); expect(d.difficulty).toBe("starter");
  const rows = [start, fixed, near].map(s => attemptRow(d, s, predict(id)));
  const reports = rows.map(row => buildRunReport(row)), [before, after, wrong] = reports;
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  for (const [i, r] of reports.entries()) {
    expect(r.challenge!.predictions[0]!.actual).not.toBeNull();
    const row = rows[i]!, saved = {...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)),
      terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot)), actions: structuredClone(row.actions)};
    expect(buildRunReport(saved).terminal).toEqual(r.terminal);
    expect(buildRunReport(saved).challenge).toEqual(r.challenge);
  }
  if (id === ids[0]) {
    const q = (i: number) => reports[i]!.terminal!.resources.find(r => r.id === "queue")!;
    expect(q(0).queueWork).toMatchObject({originals: 230, acknowledged: 151, expired: 79, ready: 0});
    expect(q(1).queueWork).toMatchObject({originals: 230, acknowledged: 218, expired: 0, ready: 11, inFlight: 1});
    expect(q(2).queueWork).toEqual(q(0).queueWork);
    expect(q(0).asyncQueue).toMatchObject({readyDepth: 0, oldestReadyAgeSeconds: null});
    expect(q(1).asyncQueue!.oldestReadyAgeSeconds!).toBeGreaterThan(10);
    expect(q(1).asyncQueue!.oldestReadyAgeSeconds!).toBeLessThan(12);
    for (const [i, row] of rows.entries()) {
      expect(q(i).asyncQueue).toEqual({version: 2, readyDepth: raw(row).metrics.queue!.asyncQueue!.readyDepth,
        oldestReadyAgeSeconds: raw(row).metrics.queue!.asyncQueue!.oldestReadyAgeSeconds});
    }
    // Acceptance is identical; the message lifetime, not producer throughput, explains the difference.
    expect(before!.terminal!.traffic).toEqual(after!.terminal!.traffic);
    expect(before!.terminal!.traffic!.wholeRun).toMatchObject({completed: 230, failed: 0});
    const short = structuredClone(start); resource(short, "queue").asyncQueue!.retentionSeconds = 5;
    const shortReport = buildRunReport(attemptRow(d, short, predict(id)));
    expect(shortReport.challenge!.status).toBe("not-met");
    expect(shortReport.terminal!.resources.find(r => r.id === "queue")!.queueWork!.expired).toBeGreaterThan(0);
  } else {
    expect(before!.terminal!.traffic!.wholeRun).toMatchObject({completed: 800, failed: 400});
    expect(after!.terminal!.traffic!.wholeRun).toMatchObject({completed: 1150, failed: 50});
    expect(wrong!.terminal!.traffic!.wholeRun).toMatchObject({completed: 800, failed: 400});
    for (const r of reports) {
      expect(r.terminal!.health).toBe("healthy");
      expect(r.actions[0]).toMatchObject({status: "completed", appliedSimulatedSeconds: 2, completedSimulatedSeconds: 11,
        outcome: {interventionEnded: true, intervention: {resolvedTargets: ["app"], atUs: 2_000_001, endUs: 10_000_001}}});
    }
    const {scenario: _scenario, ...control} = d;
    const noCrash = buildRunReport(attemptRow(control, start, predict(id)), buildRegistry([control]));
    expect(noCrash.challenge!.status).toBe("met"); expect(noCrash.terminal!.traffic!.wholeRun).toMatchObject({completed: 1200, failed: 0});
    const slow = structuredClone(start); resource(slow, "lb").lbHealth!.intervalSeconds = 5;
    expect(buildRunReport(attemptRow(d, slow, predict(id))).challenge!.status).toBe("not-met");
    const absent = structuredClone(fixed); absent.resources = absent.resources.filter(r => r.id !== "app");
    absent.connectionLines = absent.connectionLines.filter(e => e.sourceId !== "app" && e.targetId !== "app");
    expect(preflight(d, absent).valid).toBe(false);
    for (const mutate of [
      (r: typeof rows[number]) => { r.actions = []; },
      (r: typeof rows[number]) => { r.actions![0]!.completedAt = null; },
      (r: typeof rows[number]) => { r.actions![0]!.appliedSimulatedSeconds = 3; },
      (r: typeof rows[number]) => { (r.actions![0]!.outcome as {interventionEnded: boolean}).interventionEnded = false; },
      (r: typeof rows[number]) => { (r.actions![0]!.outcome as {intervention: {resolvedTargets: string[]}}).intervention.resolvedTargets = ["peer"]; },
    ]) { const bad = structuredClone(rows[1]!); mutate(bad); expect(buildRunReport(bad).challenge!.status).toBe("not-evaluated"); }
  }
  for (const mutate of [
    (r: typeof rows[number]) => { r.terminalSnapshot = null; },
    (r: typeof rows[number]) => { raw(r).simulatedSeconds--; },
    (r: typeof rows[number]) => { raw(r).metricsTopologyRevision++; },
    (r: typeof rows[number]) => { if (id === ids[0]) delete raw(r).metrics.queue!.queueWork; else delete raw(r).traffic!.wholeRun; },
    (r: typeof rows[number]) => { if (id === ids[0]) raw(r).metrics.queue!.queueWork!.throughSecond--; else raw(r).traffic!.wholeRun!.throughSecond--; },
  ]) { const bad = structuredClone(rows[1]!); mutate(bad); expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated"); }
  const mismatch = structuredClone(rows[1]!); mismatch.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(mismatch).challenge!.status).toBe("unavailable");
  const noInputs = structuredClone(rows[1]!); noInputs.runInputs = null; noInputs.liveTopology = null;
  expect(buildRunReport(noInputs).challenge!.status).not.toBe("met");
  const active = structuredClone(rows[1]!); active.status = "running"; active.runtimeActive = true; active.terminalSnapshot = null;
  expect(buildRunReport(active).challenge!.criteria.find(c => c.id === "work")!.status).toBe("pending");
  console.info(JSON.stringify({lab: id, variants: reports.map((r, i) => ({variant: ["starter", "reference", "near-miss"][i],
    status: r.challenge!.status, wholeRun: r.terminal!.traffic!.wholeRun,
    queue: r.terminal!.resources.find(r => r.id === "queue"), p95Ms: r.terminal!.traffic!.latencyMs.p95}))}));
}, 120000);

test("beginner onramps have canonical lessons, existing conceptual prerequisites, reviews and harder next labs", () => {
  expect(() => checkLearningAuthoring(learningContent)).not.toThrow();
  for (const [id, next] of [[ids[0]!, "keep-up-with-the-queue"], [ids[1]!, "choose-a-retry-mitigation"]] as const) {
    const lesson = learningContent.lessons.find(l => l.id === id)!;
    expect(lesson.kind).toBe("executable-lab"); expect(lesson.level).toBe("beginner"); expect(lesson.check).toBeNull();
    expect(lesson.experiment!.challengeId).toBe(id); expect(lesson.followUp).toContain(next!);
    const harder = learningContent.lessons.find(l => l.id === next)!;
    expect(harder.kind).toBe("executable-lab"); expect(harder.level).not.toBe("beginner");
    expect(lesson.prerequisites.length).toBeGreaterThan(0);
    for (const prerequisite of lesson.prerequisites) expect(learningContent.lessons.find(l => l.id === prerequisite)!.kind).toBe("conceptual-exercise");
  }
  console.info(JSON.stringify(["async", "failures"].map(track => ({track, counts: Object.fromEntries(["beginner", "intermediate", "advanced"].map(level =>
    [level, Object.fromEntries(["reading", "conceptual-exercise", "executable-lab"].map(kind => [kind, learningContent.lessons.filter(l => l.trackId === track && l.level === level && l.kind === kind).length]))]))}))));
});

test("saved queue observations preserve Unknown and reject malformed depth or age", () => {
  const d = definition(ids[0]!), row = attemptRow(d, REFERENCE[d.id]!, predict(d.id));
  const q = (r: typeof row) => buildRunReport(r).terminal?.resources.find(r => r.id === "queue");
  const legacy = structuredClone(row); delete raw(legacy).metrics.queue!.asyncQueue;
  expect(q(legacy)!.asyncQueue).toBeUndefined(); expect(q(legacy)!.queueWork).toBeDefined();
  const unknown = structuredClone(row); raw(unknown).metrics.queue!.asyncQueue!.oldestReadyAgeSeconds = null;
  expect(q(unknown)!.asyncQueue!.oldestReadyAgeSeconds).toBeNull();
  for (const key of ["readyDepth", "oldestReadyAgeSeconds"]) for (const bad of [-1, "unknown", NaN, Infinity, undefined]) {
    const corrupt = structuredClone(row); (raw(corrupt).metrics.queue!.asyncQueue as unknown as Record<string, unknown>)[key] = bad;
    expect(q(corrupt)).toBeUndefined();
  }
});
