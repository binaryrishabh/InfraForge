import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { captureRunInputs } from "../deployments/runInputs";
import { compareInputs } from "../comparison/inputs";
import { buildRunReport } from "../reports/report";
import { challengeSeed, findChallenge, specHash } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { recordedScenario } from "../challenges/scenario";
import { validateChallengeVersions } from "../challenges/validate";
import { readPrediction } from "../challenges/prediction";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const id = "diagnose-consumer-credit", d = definition(id), start = d.starter!, fixed = REFERENCE[id]!;
const resource = (design: ChallengeStarter, id: string) => design.resources.find(r => r.id === id)!;
const near = structuredClone(start); resource(near, "queue").asyncQueue!.visibilityTimeoutSeconds = 60;
const buffer = structuredClone(start); resource(buffer, "queue").asyncQueue!.capacityMessages = 5000;
const designs = [start, fixed, near, buffer];
const rows = designs.map(design => attemptRow(d, design, answers(d, {"overall-health": "healthy"})));
const reports = rows.map(row => buildRunReport(row));
const queue = (report: typeof reports[number]) => report.terminal!.resources.find(r => r.id === "queue")!.queueWork!;
const raw = (row: typeof rows[number]) => row.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number};

test("diagnose-consumer-credit: one credit change improves real saved work; longer leases and more buffer still fail", () => {
  const restored = structuredClone(fixed); resource(restored, "worker").asyncWorker!.prefetch = 1;
  expect(restored).toEqual(start);
  const restoredNear = structuredClone(near); resource(restoredNear, "queue").asyncQueue!.visibilityTimeoutSeconds = 30;
  expect(restoredNear).toEqual(start);
  const restoredBuffer = structuredClone(buffer); resource(restoredBuffer, "queue").asyncQueue!.capacityMessages = 1000;
  expect(restoredBuffer).toEqual(start);
  expect(validateInfrastructureName(d.title)).toBeNull(); expect(d.hints).toHaveLength(3);
  const family = [findChallenge(id, 1)!.definition, d];
  const pins = Object.fromEntries(family.map(version => [`${id}@${version.version}`,
    new RegExp(`"${id}@${version.version}": "([a-f0-9]{64})"`).exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!]));
  expect(specHash(d)).toBe(pins[`${id}@${d.version}`]!); expect(validateChallengeVersions(family, pins)).toEqual([]);
  const captured = captureRunInputs(start, d.workload, challengeSeed(d));
  for (const design of designs) {
    expect(preflight(d, design).errors).toEqual([]);
    const input = captureRunInputs(design, d.workload, challengeSeed(d));
    expect(input.workloadProfile).toEqual(captured.workloadProfile); expect(input.seed).toBe(captured.seed);
    expect(input.catalogSnapshot).toBe(captured.catalogSnapshot); expect(input.adapterProfiles).toEqual(captured.adapterProfiles);
  }
  expect(compareInputs(captured, captureRunInputs(fixed, d.workload, challengeSeed(d)))).toMatchObject({grade: "one-change-design",
    design: {reconfigured: [{id: "worker", fields: [{field: "asyncWorker"}]}]}});
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met", "not-met"]);
  const [before, after] = reports;
  expect(queue(before!)).toMatchObject({originals: 96, deliveries: 8, effects: 8, acknowledged: 7, ready: 88, inFlight: 1, redeliveries: 0});
  expect(queue(after!)).toMatchObject({originals: 96, deliveries: 96, effects: 96, acknowledged: 84, ready: 0, inFlight: 12, redeliveries: 0});
  expect(queue(reports[2]!)).toEqual(queue(before!)); expect(queue(reports[3]!)).toEqual(queue(before!));
  for (const [i, report] of reports.entries()) {
    expect(report.actions).toEqual([]); expect(report.terminal!.simulatedSeconds).toBe(12);
    expect(report.challenge!.predictions.every(p => p.actual !== null)).toBe(true);
    expect(report.terminal!.traffic).toEqual(before!.terminal!.traffic);
    expect(report.terminal!.traffic!.wholeRun).toMatchObject({completed: 96, failed: 0, deadlineExceeded: 0, abandoned: 0, inFlight: 0});
    expect(report.terminal!.resources.find(r => r.id === "worker")!.cpu!).toBeLessThan(20);
    expect(queue(report)).toEqual(raw(rows[i]!).metrics.queue!.queueWork!);
    const saved = {...rows[i]!, terminalSnapshot: JSON.parse(JSON.stringify(rows[i]!.terminalSnapshot)), runInputs: JSON.parse(JSON.stringify(rows[i]!.runInputs))};
    expect(buildRunReport(saved).terminal).toEqual(report.terminal); expect(buildRunReport(saved).challenge).toEqual(report.challenge);
  }
  const prediction = readPrediction({answers: {health: "degraded"}, reasoning: "Producer work completes, ready messages remain and receipts are held with spare CPU and no redeliveries. Test prefetch credit while preserving the lease."}, d, start.resources.map(r => r.type));
  const repeat = buildRunReport(attemptRow(d, start, prediction));
  expect(repeat.challenge!.status).toBe("not-met"); expect(repeat.challenge!.predictions.every(p => p.outcome === "matched")).toBe(true);
  expect(repeat.terminal!.traffic).toEqual(before!.terminal!.traffic);
  const earlier = buildRunReport(attemptRow(d, start, answers(d, {"overall-health": "degraded"}), {stopAt: 4}));
  expect(queue(earlier).ready).toBeLessThan(queue(before!).ready);
  expect(earlier.challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated");
  console.info(JSON.stringify({lab: id, variants: reports.map((report, i) => ({variant: ["starter", "reference", "longer-visibility", "larger-buffer"][i],
    status: report.challenge!.status, queue: queue(report), workerCpu: report.terminal!.resources.find(r => r.id === "worker")!.cpu,
    p95: report.terminal!.traffic!.latencyMs.p95, wholeRun: report.terminal!.traffic!.wholeRun}))}));
});

test("diagnose-consumer-credit: absent, stale, malformed and mismatched saved evidence cannot pass", () => {
  for (const mutate of [
    (row: typeof rows[number]) => { row.terminalSnapshot = null; },
    (row: typeof rows[number]) => { raw(row).simulatedSeconds--; },
    (row: typeof rows[number]) => { raw(row).metricsTopologyRevision++; },
    (row: typeof rows[number]) => { delete raw(row).metrics.queue; },
    (row: typeof rows[number]) => { delete raw(row).metrics.queue!.queueWork; },
    (row: typeof rows[number]) => { raw(row).metrics.queue!.queueWork!.throughSecond--; },
    (row: typeof rows[number]) => { raw(row).metrics.queue!.queueWork!.acknowledged = -1; },
    (row: typeof rows[number]) => { raw(row).metrics.queue!.queueWork!.ready = 0.5; },
    (row: typeof rows[number]) => { raw(row).metrics.queue!.queueWork!.deliveries = Number.MAX_SAFE_INTEGER + 1; },
    (row: typeof rows[number]) => { raw(row).metrics.queue!.queueWork!.originals++; },
    (row: typeof rows[number]) => { row.runInputs = null; row.liveTopology = null; },
    (row: typeof rows[number]) => { (row.runInputs as ChallengeStarter).resources = (row.runInputs as ChallengeStarter).resources.filter(r => r.id !== "queue"); },
  ]) {
    const bad = structuredClone(rows[1]!); mutate(bad);
    const report = buildRunReport(bad);
    expect(report.challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated");
    expect(report.challenge!.status).not.toBe("met");
  }
  const legacy = structuredClone(rows[1]!); delete raw(legacy).metrics.queue!.queueWork;
  expect(buildRunReport(legacy).terminal).not.toBeNull(); expect(queue(buildRunReport(legacy))).toBeUndefined();
  const mismatched = structuredClone(rows[1]!); mismatched.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(mismatched).challenge!.status).toBe("unavailable");
  const active = {...structuredClone(rows[1]!), status: "running", runtimeActive: true, terminalSnapshot: null};
  expect(buildRunReport(active).challenge!.criteria.find(c => c.id === "work")!.status).toBe("pending");
});

test("diagnose-consumer-credit: captured age reaches the saved report separately from queue-work requirement details", () => {
  const before = raw(rows[0]!).metrics.queue!.asyncQueue!, after = raw(rows[1]!).metrics.queue!.asyncQueue!;
  expect(before.oldestReadyAgeSeconds).toBeGreaterThan(10);
  expect(after.oldestReadyAgeSeconds).toBeNull(); // No ready population means Unknown, not zero age.
  for (const [i, report] of reports.entries()) {
    const persisted = JSON.parse(JSON.stringify(rows[i]!.terminalSnapshot)) as SimulationSnapshot;
    expect(persisted.metrics.queue!.asyncQueue).toEqual(raw(rows[i]!).metrics.queue!.asyncQueue);
    const observation = persisted.metrics.queue!.asyncQueue!;
    expect(report.terminal!.resources.find(r => r.id === "queue")!.asyncQueue).toEqual({
      version: observation.version, readyDepth: observation.readyDepth, oldestReadyAgeSeconds: observation.oldestReadyAgeSeconds});
    expect(report.challenge!.criteria.find(c => c.id === "work")!.detail).not.toContain("age");
  }
});

test("diagnose-consumer-credit: unsupported worker crashes, unavailable background scripts and invalid credit are refused", () => {
  for (const [interventionId, reason] of [["vm-crash", "INTERVENTION_ROLE"], ["consumer-outage", "captured serving path"]]) {
    const scenario = {...d, scenario: {version: 1 as const, visibility: "revealed" as const, steps: [{id: "worker-outage", atSecond: 2,
      request: {interventionId: interventionId!, revision: 1, target: {resourceId: "worker"}, parameters: {duration: 3}}}]}};
    expect(() => recordedScenario(scenario, captureRunInputs(start, d.workload, challengeSeed(d)))).toThrow(reason!);
    expect(preflight(scenario, start).valid).toBe(false);
  }
  for (const credit of [0, 1.5, 65]) {
    const invalid = structuredClone(start); resource(invalid, "worker").asyncWorker!.prefetch = credit;
    expect(preflight(d, invalid).valid).toBe(false);
  }
  expect(() => readPrediction({answers: {health: "credit-starved"}}, d, start.resources.map(r => r.type))).toThrow();
});
