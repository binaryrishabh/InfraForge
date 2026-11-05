import { expect, test } from "bun:test";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { buildRunReport } from "../reports/report";
import { QueueWorkSchema } from "../reports/queueWorkSchema";
import { preflight } from "../challenges/preflight";
import { challengeSeed, specHash } from "../challenges/registry";
import { validateChallengeVersions } from "../challenges/validate";
import { captureRunInputs } from "../deployments/runInputs";
import { definition, REFERENCE, attemptRow, answers } from "./challengeHarness";

const ids = ["keep-up-with-the-queue", "leave-time-to-acknowledge", "open-one-subscriber"];
const queue = (r: ReturnType<typeof buildRunReport>, id = "queue") => r.terminal!.resources.find(r => r.id === id)!.queueWork!;
const bus = (r: ReturnType<typeof buildRunReport>) => r.terminal!.resources.find(r => r.id === "bus")!.eventBus!;

for (const id of ids) test(`${id}: controlled one-change reference passes; plausible near miss fails`, () => {
  const d = definition(id), start = d.starter!, fixed = REFERENCE[id]!, restored = structuredClone(fixed), near = structuredClone(start);
  const resource = (s: ChallengeStarter, id: string) => s.resources.find(r => r.id === id)!;
  if (id === ids[0]) {
    resource(restored, "worker").asyncWorker!.cpuMsPerJob = 250;
    resource(near, "queue").asyncQueue!.capacityMessages = 5000;
  } else if (id === ids[1]) {
    resource(restored, "queue").asyncQueue!.visibilityTimeoutSeconds = 1;
    resource(near, "queue").asyncQueue!.maxReceives = 5;
  } else {
    resource(restored, "queue").listenerSettings!.ports = [];
    resource(near, "bus").eventBus!.maxAttempts = 5;
  }
  expect(restored).toEqual(start);
  expect(captureRunInputs(start, d.workload, challengeSeed(d)).workloadProfile).toEqual(captureRunInputs(fixed, d.workload, challengeSeed(d)).workloadProfile);
  for (const design of [start, fixed, near]) expect(preflight(d, design).valid).toBe(true);
  const run = (design: ChallengeStarter) => attemptRow(d, design, answers(d, {"overall-health": "healthy"}));
  const beforeRow = run(start), afterRow = run(fixed), nearRow = run(near);
  const before = buildRunReport(beforeRow), after = buildRunReport(afterRow), wrong = buildRunReport(nearRow);
  expect(before.challenge!.status).toBe("not-met"); expect(after.challenge!.status).toBe("met"); expect(wrong.challenge!.status).toBe("not-met");
  expect(after.challenge!.criteria.every(c => c.status === "met")).toBe(true);
  for (const r of [before, after, wrong]) expect(r.challenge!.predictions.every(p => p.actual !== null)).toBe(true);
  for (const row of [beforeRow, afterRow, nearRow]) {
    const report = buildRunReport(row), raw = row.terminalSnapshot as SimulationSnapshot;
    for (const resource of report.terminal!.resources.filter(r => r.queueWork)) expect(resource.queueWork).toEqual(raw.metrics[resource.id]!.queueWork);
  }
  if (id === ids[0]) {
    expect(queue(before)).toMatchObject({originals: 96, acknowledged: 46, ready: 49, inFlight: 1});
    expect(queue(after)).toMatchObject({originals: 96, acknowledged: 96, ready: 0, inFlight: 0});
    expect(queue(wrong)).toEqual(queue(before));
    expect(before.terminal!.traffic).toEqual(after.terminal!.traffic); // Producer success hides consumer backlog.
    const earlierRow = attemptRow(d, start, answers(d, {"overall-health": "saturated"}), {stopAt: 4});
    const earlier = buildRunReport(earlierRow);
    expect(queue(earlier).ready).toBe(16); expect(queue(before).ready).toBeGreaterThan(queue(earlier).ready);
    expect(earlier.challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated");
  } else if (id === ids[1]) {
    expect((afterRow.runInputs as {adapterProfiles: string[]}).adapterProfiles).toContain("queue-ack-delay/1");
    expect(queue(before)).toMatchObject({originals: 3, deliveries: 7, effects: 7, acknowledged: 0, redeliveries: 4, deadLettered: 2});
    expect(queue(after)).toMatchObject({originals: 3, deliveries: 3, effects: 3, acknowledged: 3, redeliveries: 0, deadLettered: 0});
    expect(queue(wrong).acknowledged).toBe(0); expect(queue(wrong).redeliveries).toBeGreaterThan(0);
    expect(before.terminal!.traffic).toEqual(after.terminal!.traffic);
  } else {
    expect(queue(before)).toMatchObject({originals: 0, acknowledged: 0, effects: 0});
    expect(queue(after)).toMatchObject({originals: 24, acknowledged: 24, effects: 24});
    expect(queue(before, "queue2")).toEqual(queue(after, "queue2"));
    expect(queue(before, "queue2").acknowledged).toBe(24);
    expect(bus(before).accepted).toBe(24); expect(bus(after).accepted).toBe(24);
    expect(bus(before).subscriptions[0]).toMatchObject({delivered: 0, retried: 48, deadLettered: 24, deliveryAccounting: {attempts: 72, failedAttempts: 72, exhausted: 24}});
    expect(bus(after).subscriptions[0]).toMatchObject({delivered: 24, retried: 0, deadLettered: 0});
    expect(bus(before).subscriptions[1]).toEqual(bus(after).subscriptions[1]);
    expect(bus(wrong).subscriptions[0]!.retried).toBeGreaterThan(bus(before).subscriptions[0]!.retried);
    expect(queue(wrong, "queue2").acknowledged).toBe(24);
  }
  console.info(JSON.stringify({lab: id, before: queue(before), after: queue(after), nearMiss: queue(wrong), busBefore: id === ids[2] ? bus(before) : undefined}));

  for (const mutate of [
    (row: typeof afterRow) => { row.terminalSnapshot = null; },
    (row: typeof afterRow) => { (row.terminalSnapshot as SimulationSnapshot).simulatedSeconds--; },
    (row: typeof afterRow) => { delete (row.terminalSnapshot as SimulationSnapshot).metrics.queue!.queueWork; },
    (row: typeof afterRow) => { (row.terminalSnapshot as SimulationSnapshot).metrics.queue!.queueWork!.throughSecond--; },
    (row: typeof afterRow) => { (row.terminalSnapshot as {metricsTopologyRevision: number}).metricsTopologyRevision++; },
    (row: typeof afterRow) => { delete (row.terminalSnapshot as SimulationSnapshot).metrics.queue; },
    (row: typeof afterRow) => { const s = row.terminalSnapshot as SimulationSnapshot; s.metrics.renamed = s.metrics.queue!; delete s.metrics.queue; },
    (row: typeof afterRow) => { (row.runInputs as ChallengeStarter).resources = (row.runInputs as ChallengeStarter).resources.filter(r => r.id !== "queue"); },
  ]) {
    const row = structuredClone(afterRow); mutate(row);
    expect(buildRunReport(row).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated");
  }
  const mismatch = structuredClone(afterRow); mismatch.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(mismatch).challenge!.status).toBe("unavailable");
  const active = attemptRow(d, fixed, answers(d, {"overall-health": "healthy"}), {runtimeActive: true, status: "running"});
  expect(buildRunReport(active).challenge!.criteria.find(c => c.id === "work")!.status).toBe("pending");
}, 120000);

test("queue-work refuses malformed or incomplete populations, keeps legacy absence Unknown, and validates authored limits", () => {
  const d = definition(ids[1]!), row = attemptRow(d, REFERENCE[d.id]!, answers(d, {"overall-health": "healthy"}));
  const raw = (r: typeof row) => (r.terminalSnapshot as SimulationSnapshot).metrics.queue!.queueWork!;
  const legacy = structuredClone(row); delete (legacy.terminalSnapshot as SimulationSnapshot).metrics.queue!.queueWork;
  expect(buildRunReport(legacy).terminal).not.toBeNull(); expect(queue(buildRunReport(legacy))).toBeUndefined();
  expect(buildRunReport(legacy).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated");
  for (const key of Object.keys(raw(row))) for (const bad of [null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "unknown", undefined]) {
    const corrupt = structuredClone(row), q = raw(corrupt) as unknown as Record<string, unknown>; q[key] = bad;
    expect(QueueWorkSchema.safeParse(q).success).toBe(false);
    expect(buildRunReport(corrupt).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated");
  }
  for (const patch of [{acknowledged: 4}, {originals: 4}, {effects: 4}, {redeliveries: 4}, {deliveries: 4}, {ready: 1}]) {
    const corrupt = structuredClone(row); Object.assign(raw(corrupt), patch);
    expect(QueueWorkSchema.safeParse(raw(corrupt)).success).toBe(false);
    expect(buildRunReport(corrupt).terminal).toBeNull();
  }
  for (const patch of [{minAcknowledged: 0}, {maxOutstanding: -1}, {maxRedeliveries: 0.5}, {resourceId: "missing"}]) {
    const edited = structuredClone(d); Object.assign(edited.criteria[1]!, patch);
    expect(validateChallengeVersions([edited], {[`${d.id}@1`]: specHash(edited)}).some(p => p.includes("queue-work"))).toBe(true);
  }
  // A recorded zero population is real evidence of failing the positive acknowledgement minimum.
  const empty = structuredClone(row), q = raw(empty);
  for (const key of Object.keys(q).filter(k => !["version", "throughSecond"].includes(k))) (q as unknown as Record<string, unknown>)[key] = 0;
  expect(QueueWorkSchema.safeParse(q).success).toBe(true);
  expect(buildRunReport(empty).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-met");
  const notM2 = {...d, engine: undefined};
  expect(validateChallengeVersions([notM2], {[`${d.id}@1`]: specHash(notM2)}).some(p => p.includes("queue-work"))).toBe(true);
});
