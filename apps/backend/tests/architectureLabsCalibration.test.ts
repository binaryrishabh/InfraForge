import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ChallengeDefinition, ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { buildRunReport } from "../reports/report";
import { buildRegistry, challengeSeed, findChallenge, specHash } from "../challenges/registry";
import { validateChallengeVersions } from "../challenges/validate";
import { preflight } from "../challenges/preflight";
import { captureRunInputs } from "../deployments/runInputs";
import { definition, REFERENCE, attemptRow, answers } from "./challengeHarness";

const ids = ["cache-or-database", "one-vm-or-a-pool", "limit-or-capacity"];
const alternatives = ["capacity", "small", "workers"];
const resource = (s: ChallengeStarter, id: string) => s.resources.find(r => r.id === id)!;
const metric = (r: ReturnType<typeof buildRunReport>, id: string) => r.terminal!.resources.find(r => r.id === id)!;
const raw = (r: ReturnType<typeof attemptRow>) => r.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number};
const prediction = (d: ChallengeDefinition) => answers(d, {"busiest-type": "Database", "overall-health": "healthy"});
const cost = (r: ReturnType<typeof buildRunReport>) => r.stages.find(s => s.name === "CostEstimate")!.monthlyEstimateUsd!;

for (const [index, id] of ids.entries()) test(`${id}: two valid architectures, controlled causal runs, near miss and report refusal`, () => {
  const d = definition(id), start = d.starter!, fixed = REFERENCE[id]!, alternative = REFERENCE[`${id}-${alternatives[index]}`]!;
  const near = structuredClone(start);
  if (index === 0) resource(near, "app").skuId = "m5.2xlarge";
  else if (index === 1) {
    Object.assign(near, structuredClone(REFERENCE[`${id}-small`]!));
    near.resources = near.resources.filter(r => r.id !== "peer2"); near.connectionLines = near.connectionLines.filter(e => e.sourceId !== "peer2" && e.targetId !== "peer2");
  } else resource(near, "readApp").vmExecution!.workers = 2;
  const published = readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8");
  const versions = Array.from({length: d.version}, (_, i) => findChallenge(id, i + 1)!.definition);
  const pins = Object.fromEntries(versions.map(version => {
    const key = `${id}@${version.version}`;
    return [key, new RegExp(`"${key}": "([a-f0-9]{64})"`).exec(published)?.[1]!];
  }));
  const pin = pins[`${id}@${d.version}`]; expect(pin).toBeDefined();
  expect(specHash(d)).toBe(pin!); expect(validateChallengeVersions(versions, pins)).toEqual([]);
  expect(validateInfrastructureName(d.title)).toBeNull(); expect(d.difficulty).toBe("core");
  const designs = [start, fixed, alternative, near];
  const input = captureRunInputs(start, d.workload, challengeSeed(d));
  for (const s of designs) {
    expect(preflight(d, s).errors).toEqual([]);
    const captured = captureRunInputs(s, d.workload, challengeSeed(d));
    expect(captured.workloadProfile).toEqual(input.workloadProfile); expect(captured.seed).toBe(input.seed);
    expect(captured.catalogSnapshot).toBe(input.catalogSnapshot);
  }
  // Control the architecture change: restore exactly the original tier or path.
  if (index === 0) {
    expect(fixed.resources.filter(r => r.id !== "cache")).toEqual(start.resources);
    expect({...fixed, resources: fixed.resources.filter(r => r.id !== "cache"), connectionLines: start.connectionLines}).toEqual(start);
    expect(alternative.resources.filter(r => r.id !== "db")).toEqual(start.resources.filter(r => r.id !== "db"));
    expect({...resource(alternative, "db"), skuId: undefined}).toEqual({...resource(start, "db"), skuId: undefined});
    expect(alternative.connectionLines).toEqual(start.connectionLines);
  } else if (index === 1) {
    expect(resource(fixed, "lb")).toEqual(resource(start, "lb")); expect(resource(fixed, "db")).toEqual(resource(start, "db"));
    const restored = structuredClone(fixed); restored.resources = restored.resources.filter(r => r.id !== "peer1");
    restored.connectionLines = restored.connectionLines.filter(e => e.sourceId !== "peer1" && e.targetId !== "peer1"); resource(restored, "app").skuId = "c5.xlarge";
    expect(restored).toEqual(start); // One four-core app versus two two-core apps; fixed total catalog CPU.
  } else {
    const restored = structuredClone(fixed); resource(restored, "gateway").apiGateway!.routes![0]!.burstRequests = 10000; expect(restored).toEqual(start);
    const restoredWorkers = structuredClone(alternative); resource(restoredWorkers, "readApp").vmExecution!.workers = 1; expect(restoredWorkers).toEqual(start);
  }
  const rows = designs.map(s => attemptRow(d, s, prediction(d))), reports = rows.map(row => buildRunReport(row));
  const [before, after, other, wrong] = reports as [typeof reports[number], typeof reports[number], typeof reports[number], typeof reports[number]];
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "met", "not-met"]);
  for (const [i, r] of reports.entries()) {
    expect(r.terminal!.simulatedSeconds).toBe(d.evaluationSeconds); expect(r.challenge!.predictions.every(p => p.actual !== null)).toBe(true);
    const saved = {...rows[i]!, runInputs: JSON.parse(JSON.stringify(rows[i]!.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(rows[i]!.terminalSnapshot)), actions: structuredClone(rows[i]!.actions)};
    expect(buildRunReport(saved).terminal).toEqual(r.terminal); expect(buildRunReport(saved).challenge).toEqual(r.challenge);
  }
  if (index === 0) {
    expect(metric(before,"db").cpu).toBe(100); expect(before.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(200);
    expect(after.terminal!.traffic!.latencyMs.p95!).toBeLessThan(10); expect(other.terminal!.traffic!.latencyMs.p95!).toBeLessThan(10);
    expect(metric(after,"db").cpu!).toBeLessThan(metric(other,"db").cpu!);
    expect(cost(after)).toBeGreaterThan(cost(other));
    expect(after.terminal!.traffic!.wholeRun!.failed).toBe(0); expect(other.terminal!.traffic!.wholeRun!.failed).toBe(0);
    expect(wrong.challenge!.criteria.find(c => c.id === "latency")!.status).toBe("not-met");
  } else if (index === 1) {
    expect(before.terminal!.traffic!.latencyMs.p95!).toBeLessThan(10); expect(before.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(900);
    expect(before.challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-met");
    for (const r of [after, other]) { expect(r.terminal!.traffic!.wholeRun!.failed).toBe(0); expect(r.terminal!.traffic!.wholeRun!.completed).toBeGreaterThan(2400); }
    expect(cost(other)).toBeLessThan(cost(after)); expect(other.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(after.terminal!.traffic!.latencyMs.p95!);
    expect(metric(wrong,"peer1").cpu).toBe(100); expect(wrong.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(200);
    const {scenario: _scenario, ...control} = d;
    const noCrash = buildRunReport(attemptRow(control, start, prediction(control)),buildRegistry([control]));
    expect(noCrash.terminal!.traffic!.wholeRun!.failed).toBe(0);
    for (const r of reports) expect(r.actions[0]!.outcome!.intervention).toMatchObject({resolvedTargets: ["app"], atUs: 2_000_001, endUs: 4_000_001});
    for (const mutate of [
      (r: typeof rows[number]) => { r.actions = []; },
      (r: typeof rows[number]) => { r.actions![0]!.completedAt = null; },
      (r: typeof rows[number]) => { r.actions![0]!.appliedSimulatedSeconds!++; },
      (r: typeof rows[number]) => { (r.actions![0]!.outcome as {interventionEnded: boolean}).interventionEnded = false; },
      (r: typeof rows[number]) => { (r.actions![0]!.outcome as {intervention: {resolvedTargets: string[]}}).intervention.resolvedTargets = ["peer1"]; },
    ]) { const bad = structuredClone(rows[1]!); mutate(bad); expect(buildRunReport(bad).challenge!.status).toBe("not-evaluated"); }
    expect(buildRunReport(attemptRow(d, fixed, prediction(d), {skipExperiment: true})).challenge!.status).toBe("not-evaluated");
    const absent = structuredClone(fixed); absent.resources = absent.resources.filter(r => r.id !== "app"); absent.connectionLines = absent.connectionLines.filter(e => e.sourceId !== "app" && e.targetId !== "app");
    expect(preflight(d, absent).valid).toBe(false);
  } else {
    const read = (r: typeof after) => metric(r,"gateway").gateway!.routes.find(r => r.id === "read")!;
    const write = (r: typeof after) => metric(r,"gateway").gateway!.routes.find(r => r.id === "write")!;
    expect(read(before).outcomes!.upstreamFailed).toBeGreaterThan(1000);
    expect(read(after).outcomes!.completed).toBe(2); expect(read(other).outcomes!.completed).toBeGreaterThan(1900);
    expect(read(after).rejected).toBeGreaterThan(read(other).rejected);
    expect(metric(after,"readApp").cpu!).toBeLessThan(metric(other,"readApp").cpu!);
    expect(write(after).outcomes!.completed).toBe(write(other).outcomes!.completed);
    for (const r of [after, other]) expect(read(r).outcomes!.upstreamFailed).toBe(0);
    expect(wrong.challenge!.criteria.find(c => c.id === "reads")!.status).toBe("not-met");
    expect(after.stages.find(s => s.name === "CostEstimate")!.monthlyEstimateUsd).toBeUndefined();
  }
  const requirement = index === 0 ? "latency" : index === 1 ? "work" : "reads";
  for (const mutate of [
    (r: typeof rows[number]) => { r.terminalSnapshot = null; },
    (r: typeof rows[number]) => { raw(r).simulatedSeconds--; },
    (r: typeof rows[number]) => { raw(r).metricsTopologyRevision++; },
    (r: typeof rows[number]) => { if (index === 0) raw(r).traffic!.latencyMs.p95 = null; else if (index === 1) delete raw(r).traffic!.wholeRun; else delete raw(r).metrics.gateway!.gateway; },
  ]) { const bad = structuredClone(rows[1]!); mutate(bad); expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === requirement)!.status).toBe("not-evaluated"); }
  const mismatch = structuredClone(rows[1]!); mismatch.challengeSpecHash = "0".repeat(64); expect(buildRunReport(mismatch).challenge!.status).toBe("unavailable");
  const noInput = structuredClone(rows[1]!); noInput.runInputs = null; noInput.liveTopology = null; expect(buildRunReport(noInput).challenge!.status).not.toBe("met");
  const noChecks = structuredClone(rows[1]!); noChecks.stages = []; expect(buildRunReport(noChecks).challenge!.status).not.toBe("met");
  if (index === 1) for (const mutate of [
    (w: NonNullable<NonNullable<SimulationSnapshot["traffic"]>["wholeRun"]>) => { w.throughSecond--; },
    (w: NonNullable<NonNullable<SimulationSnapshot["traffic"]>["wholeRun"]>) => { w.completed = -1; },
    (w: NonNullable<NonNullable<SimulationSnapshot["traffic"]>["wholeRun"]>) => { w.failed = Number.MAX_SAFE_INTEGER + 1; },
    (w: NonNullable<NonNullable<SimulationSnapshot["traffic"]>["wholeRun"]>) => { w.completed = Number.MAX_SAFE_INTEGER; w.failed = 1; },
  ]) { const bad = structuredClone(rows[1]!); mutate(raw(bad).traffic!.wholeRun!); expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated"); }
  if (index === 1) {
    for (const key of ["failed", "deadlineExceeded", "abandoned"] as const) {
      const bad = structuredClone(rows[1]!); raw(bad).traffic!.wholeRun![key] = 31;
      expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-met");
    }
    const zero = structuredClone(rows[1]!); Object.assign(raw(zero).traffic!.wholeRun!, {completed: 0, failed: 0, deadlineExceeded: 0, abandoned: 0, inFlight: 2500});
    expect(buildRunReport(zero).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-met");
    const active = structuredClone(rows[1]!); active.status = "running"; active.runtimeActive = true; active.terminalSnapshot = null;
    expect(buildRunReport(active).challenge!.criteria.find(c => c.id === "work")!.status).toBe("pending");
    const work = d.criteria.find(c => c.kind === "caller-outcomes")!;
    for (const patch of [{minCompleted: 0}, {minCompleted: Number.MAX_SAFE_INTEGER + 1}, {maxUnsuccessful: -1}, {maxUnsuccessful: 0.5}]) {
      const bad = {...d, criteria: [{...work, ...patch}]};
      expect(validateChallengeVersions([bad], {[`${d.id}@${d.version}`]: specHash(bad)}).some(p => p.includes("caller-outcomes"))).toBe(true);
    }
  }
  console.info(JSON.stringify({lab: id, variants: reports.map((r,i) => ({variant: ["starter", "reference", "alternative", "near-miss"][i], status: r.challenge!.status,
    cost: r.stages.find(s => s.name === "CostEstimate")!.monthlyEstimateUsd ?? "Unknown", p95: r.terminal!.traffic!.latencyMs.p95,
    wholeRun: r.terminal!.traffic!.wholeRun, resources: r.terminal!.resources.map(m => ({id: m.id, cpu: m.cpu, health: m.health, gateway: m.gateway})), criteria: r.challenge!.criteria}))}));
}, 120000);

test("pool expansion: adding only a peer changes failed callers under the identical VM crash", () => {
  const d = definition("one-vm-or-a-pool"), fixed = REFERENCE[d.id]!, single = structuredClone(fixed);
  single.resources = single.resources.filter(r => r.id !== "peer1");
  single.connectionLines = single.connectionLines.filter(e => e.sourceId !== "peer1" && e.targetId !== "peer1");
  expect(resource(single,"app")).toEqual(resource(fixed,"app"));
  expect(resource(single,"lb")).toEqual(resource(fixed,"lb")); expect(resource(single,"db")).toEqual(resource(fixed,"db"));
  expect(fixed.resources.filter(r => r.id !== "peer1")).toEqual(single.resources);
  const before = buildRunReport(attemptRow(d,single,prediction(d))), after = buildRunReport(attemptRow(d,fixed,prediction(d)));
  expect(before.challenge!.status).toBe("not-met"); expect(after.challenge!.status).toBe("met");
  expect(before.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(900); expect(after.terminal!.traffic!.wholeRun!.failed).toBe(0);
  console.info(JSON.stringify({lab: d.id, controlledChange: "Add peer1 with its two serving edges; every existing resource and edge unchanged",
    before: before.terminal!.traffic!.wholeRun, after: after.terminal!.traffic!.wholeRun}));
}, 120000);
