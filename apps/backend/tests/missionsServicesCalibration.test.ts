import { expect, test } from "bun:test";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { buildRunReport } from "../reports/report";
import { captureRunInputs } from "../deployments/runInputs";
import { challengeSeed, findChallenge } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { definition, REFERENCE, attemptRow, answers } from "./challengeHarness";

const resource = (s: ChallengeStarter, id: string) => s.resources.find(r => r.id === id)!;
const metric = (r: ReturnType<typeof buildRunReport>, id: string) => r.terminal!.resources.find(r => r.id === id)!;
const queue = (r: ReturnType<typeof buildRunReport>) => metric(r, "queue").queueWork!;
const snapshot = (r: ReturnType<typeof attemptRow>) => r.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number};
const differingLeaves = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a && b && typeof a === "object" && typeof b === "object") return [...new Set([...Object.keys(a), ...Object.keys(b)])].reduce((n, k) => n + differingLeaves((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]), 0);
  return 1;
};
// Every variant is the starter or the reference with exactly one saved setting changed.
function variant(base: ChallengeStarter, change: (s: ChallengeStarter) => void) { const s = structuredClone(base); change(s); return s; }
const report = (d: ReturnType<typeof definition>, design: ChallengeStarter, stopAt?: number) => {
  return buildRunReport(attemptRow(d, design, answers(d, {"overall-health": "healthy"}), stopAt ? {stopAt} : {}));
};
const log = (mission: string, name: string, r: ReturnType<typeof buildRunReport>) =>
  console.info(JSON.stringify({mission, variant: name, status: r.challenge!.status, health: r.terminal!.health, failed: r.terminal!.traffic!.wholeRun!.failed, completed: r.terminal!.traffic!.wholeRun!.completed, queue: queue(r), workerCpu: metric(r, "worker").cpu}));

function malformedEvidenceStaysUnknown(d: ReturnType<typeof definition>) {
  const row = attemptRow(d, REFERENCE[d.id]!, answers(d, {"overall-health": "healthy"}));
  for (const mutate of [
    (r: typeof row) => { r.terminalSnapshot = null; },
    (r: typeof row) => { snapshot(r).simulatedSeconds--; },
    (r: typeof row) => { delete snapshot(r).metrics.queue!.queueWork; },
    (r: typeof row) => { snapshot(r).metrics.queue!.queueWork!.throughSecond--; },
    (r: typeof row) => { snapshot(r).metrics.queue!.queueWork!.acknowledged = -1; },
    (r: typeof row) => { delete snapshot(r).metrics.queue; },
  ]) {
    const missing = structuredClone(row); mutate(missing);
    const rebuilt = buildRunReport(missing);
    expect(rebuilt.challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated");
    expect(rebuilt.challenge!.status).not.toBe("met");
  }
  const mismatch = structuredClone(row); mismatch.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(mismatch).challenge!.status).toBe("unavailable");
  const running = structuredClone(row); running.status = "running"; running.runtimeActive = true; running.terminalSnapshot = null;
  expect(buildRunReport(running).challenge!.criteria.find(c => c.id === "work")!.status).toBe("pending");
}

test("notification-retry-storm@1: a lower delivery limit stops bad requests starving good ones; capacity alone only repeats the waste", () => {
  // Preserve this exact v1 calibration. The v2 production seed and verdict bands are checked in olderLabDefinitionCorrections.test.ts.
  const id = "notification-retry-storm", d = findChallenge(id, 1)!.definition, start = d.starter!, fixed = REFERENCE[id]!;
  const limit = (s: ChallengeStarter, n: number) => { resource(s, "queue").asyncQueue!.maxReceives = n; };
  const designs = {
    starter: start, reference: fixed,
    limitFive: variant(start, s => limit(s, 5)),
    biggerWorker: variant(start, s => { (resource(s, "worker") as {size?: string}).size = "large"; }),
  };
  expect(differingLeaves(start, fixed)).toBe(1);
  expect(differingLeaves(start, designs.limitFive)).toBe(1); expect(differingLeaves(start, designs.biggerWorker)).toBe(1);
  expect(variant(fixed, s => limit(s, 10))).toEqual(start);
  for (const design of Object.values(designs)) {
    expect(preflight(d, design).valid).toBe(true);
    expect(captureRunInputs(design, d.workload, challengeSeed(d)).workloadProfile).toEqual(captureRunInputs(start, d.workload, challengeSeed(d)).workloadProfile);
  }
  const r = Object.fromEntries(Object.entries(designs).map(([k, s]) => [k, report(d, s)])) as Record<keyof typeof designs, ReturnType<typeof report>>;
  for (const [k, v] of Object.entries(r)) { log(id, k, v); expect(v.terminal!.simulatedSeconds).toBe(d.evaluationSeconds); expect(v.challenge!.predictions.every(p => p.actual !== null)).toBe(true); }
  const work = (v: typeof r.starter) => v.challenge!.criteria.find(c => c.id === "work")!.status;
  // The requirement is met only by the reference.
  expect(r.reference.challenge!.status).toBe("met"); expect(r.reference.challenge!.criteria.every(c => c.status === "met")).toBe(true);
  for (const k of ["starter", "limitFive", "biggerWorker"] as const) expect(r[k].challenge!.status).toBe("not-met");
  // Starter: bad requests repeat up to the limit and hold the worker, so good work is stuck waiting.
  expect(queue(r.starter).acknowledged).toBeLessThan(350);
  expect(queue(r.starter).ready + queue(r.starter).inFlight).toBeGreaterThan(100);
  expect(metric(r.starter, "worker").health).toBe("saturated"); expect(r.starter.terminal!.health).not.toBe("healthy");
  // Reference: every good request acknowledged, bad ones dead-lettered after fewer deliveries.
  expect(queue(r.reference).acknowledged).toBeGreaterThanOrEqual(350); expect(queue(r.reference).ready + queue(r.reference).inFlight).toBe(0);
  expect(queue(r.reference).deadLettered).toBeGreaterThan(queue(r.starter).deadLettered);
  expect(queue(r.reference).deliveries).toBeLessThan(queue(r.starter).deliveries);
  expect(queue(r.reference).acknowledged + queue(r.reference).deadLettered).toBe(queue(r.reference).originals);
  expect(r.reference.terminal!.traffic!.wholeRun!.failed).toBe(0); expect(r.starter.terminal!.traffic!.wholeRun!.failed).toBe(0);
  // Near miss: five deliveries still leave too much repeated work.
  expect(work(r.limitFive)).toBe("not-met"); expect(queue(r.limitFive).acknowledged).toBeLessThan(350);
  // Near miss: a bigger worker clears the backlog but repeats failed work far past the authored budget.
  expect(queue(r.biggerWorker).acknowledged).toBeGreaterThanOrEqual(350); expect(queue(r.biggerWorker).ready + queue(r.biggerWorker).inFlight).toBeLessThanOrEqual(10);
  expect(queue(r.biggerWorker).redeliveries).toBeGreaterThan(250); expect(queue(r.reference).redeliveries).toBeLessThanOrEqual(250);
  expect(work(r.biggerWorker)).toBe("not-met");
  malformedEvidenceStaysUnknown(d);
  const invalid = variant(start, s => limit(s, 0)); expect(preflight(d, invalid).valid).toBe(false);
}, 600000);

test("analytics-burst-buffer: waiting room that fits the burst keeps every event; too little loses events while health stays Healthy", () => {
  const id = "analytics-burst-buffer", d = definition(id), start = d.starter!, fixed = REFERENCE[id]!;
  const room = (s: ChallengeStarter, n: number) => { resource(s, "queue").asyncQueue!.capacityMessages = n; };
  const cpu = (s: ChallengeStarter, ms: number) => { resource(s, "worker").asyncWorker!.cpuMsPerJob = ms; };
  const designs = {
    starter: start, reference: fixed,
    littleMoreRoom: variant(start, s => room(s, 150)),
    roomButSlowWorker: variant(fixed, s => cpu(s, 120)),
    fasterWorker: variant(start, s => cpu(s, 40)),
  };
  expect(differingLeaves(start, fixed)).toBe(1); expect(differingLeaves(fixed, designs.roomButSlowWorker)).toBe(1);
  expect(differingLeaves(start, designs.littleMoreRoom)).toBe(1); expect(differingLeaves(start, designs.fasterWorker)).toBe(1);
  expect(variant(fixed, s => room(s, 50))).toEqual(start);
  for (const design of Object.values(designs)) {
    expect(preflight(d, design).valid).toBe(true);
    expect(captureRunInputs(design, d.workload, challengeSeed(d)).workloadProfile).toEqual(captureRunInputs(start, d.workload, challengeSeed(d)).workloadProfile);
  }
  const r = Object.fromEntries(Object.entries(designs).map(([k, s]) => [k, report(d, s)])) as Record<keyof typeof designs, ReturnType<typeof report>>;
  for (const [k, v] of Object.entries(r)) { log(id, k, v); expect(v.terminal!.simulatedSeconds).toBe(d.evaluationSeconds); expect(v.challenge!.predictions.every(p => p.actual !== null)).toBe(true); }
  const failed = (v: typeof r.starter) => v.terminal!.traffic!.wholeRun!.failed;
  expect(r.reference.challenge!.status).toBe("met"); expect(r.reference.challenge!.criteria.every(c => c.status === "met")).toBe(true);
  for (const k of ["starter", "littleMoreRoom", "roomButSlowWorker"] as const) expect(r[k].challenge!.status).toBe("not-met");
  // Starter: events are refused at the producer although everything accepted was processed and health is Healthy.
  expect(failed(r.starter)).toBeGreaterThan(50); expect(queue(r.starter).originals).toBeLessThan(1150);
  expect(queue(r.starter).acknowledged).toBe(queue(r.starter).originals); expect(r.starter.terminal!.health).toBe("healthy");
  expect(r.starter.challenge!.predictions[0]!.actual).toBe("healthy");
  // Reference: nothing refused, every event acknowledged, and the burst really used more than the starter's room.
  expect(failed(r.reference)).toBe(0); expect(queue(r.reference)).toMatchObject({originals: 1150, acknowledged: 1150, ready: 0, inFlight: 0, redeliveries: 0});
  const peak = report(d, fixed, 140);
  expect(queue(peak).ready + queue(peak).inFlight).toBeGreaterThan(50);
  console.info(JSON.stringify({mission: id, measuredAt140: queue(peak)}));
  // Near misses: a little more room still loses some events; plenty of room with a slow worker leaves a backlog instead.
  expect(failed(r.littleMoreRoom)).toBeGreaterThan(0); expect(failed(r.littleMoreRoom)).toBeLessThan(failed(r.starter));
  expect(failed(r.roomButSlowWorker)).toBe(0); expect(queue(r.roomButSlowWorker).ready + queue(r.roomButSlowWorker).inFlight).toBeGreaterThan(10);
  // A faster worker is a second supported answer: it removes the excess instead of storing it.
  expect(r.fasterWorker.challenge!.status).toBe("met"); expect(failed(r.fasterWorker)).toBe(0);
  malformedEvidenceStaysUnknown(d);
  const invalid = variant(start, s => room(s, 0)); expect(preflight(d, invalid).valid).toBe(false);
}, 900000);
