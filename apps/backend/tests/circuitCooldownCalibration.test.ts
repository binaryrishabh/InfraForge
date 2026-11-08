import { expect, test } from "bun:test";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { buildRegistry } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { buildRunReport } from "../reports/report";
import { resilienceCases } from "./lbResilienceReport.fixture";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

test("test-a-circuit-again: cooldown alone changes real probe admission and callers; a closed-state near miss still fails", () => {
  const d = definition("test-a-circuit-again"), restored = structuredClone(REFERENCE[d.id]!);
  restored.resources.find(r => r.id === "lb")!.circuitBreaker!.cooldownMs = 60000;
  expect(restored).toEqual(d.starter!); expect(validateInfrastructureName(d.title)).toBeNull();
  const {circuits} = resilienceCases();
  const [before, after, near] = circuits.map(c => c.report);
  expect(circuits.map(c => c.report.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  for (const c of circuits) {
    expect(preflight(d, c.input).valid).toBe(true);
    expect(c.input.workloadProfile).toEqual(circuits[0]!.input.workloadProfile);
    expect(c.input.seed).toBe(circuits[0]!.input.seed);
    expect(c.report.challenge!.predictions[0]!.actual).not.toBeNull();
    expect(c.report.actions[0]).toMatchObject({status: "completed", appliedSimulatedSeconds: 2, completedSimulatedSeconds: 6});
  }
  const whole = (r: NonNullable<typeof before>) => r.terminal!.traffic!.wholeRun!;
  const path = (r: NonNullable<typeof before>) => r.terminal!.resources.find(r => r.id === "lb")!.circuitBreaker!.paths[0]!;
  expect(whole(after!).completed).toBeGreaterThanOrEqual(175); // at least 25 above the requirement
  expect(whole(after!).failed).toBeLessThanOrEqual(65); // at least 25 below the requirement
  expect(whole(before!).completed).toBeLessThan(60);
  expect(whole(near!).completed).toBeLessThan(130);
  expect(path(before!).state).toBe("open"); expect(path(before!).probes.started).toBe(0);
  expect(path(after!).state).toBe("closed"); expect(path(after!).probes.succeeded).toBe(1);
  expect(path(after!).transitions).toEqual({"closed->open": 1, "open->half-open": 1, "half-open->closed": 1});
  expect(path(near!).state).toBe("closed"); expect(path(near!).probes.succeeded).toBe(1);
  // Identical no-crash control proves the long cooldown does not itself prevent
  // ordinary healthy calls. This is a controlled engine run, not a prose claim.
  const {scenario: _scenario, ...control} = d;
  const controlReport = buildRunReport(attemptRow(control, d.starter!, answers(control, {"overall-health": "healthy"})), buildRegistry([control]));
  expect(whole(controlReport).completed).toBe(240); expect(whole(controlReport).failed).toBe(0);
  expect(path(controlReport).state).toBe("closed"); expect(path(controlReport).probes.started).toBe(0);
  for (const c of circuits) console.info(JSON.stringify({lab: d.id, cooldown: c.input.resources.find(r => r.id === "lb")!.circuitBreaker!.cooldownMs,
    whole: whole(c.report), circuit: path(c.report), verdict: c.report.challenge!.status}));
  for (const mutate of [
    (row: typeof circuits[number]["row"]) => { row.terminalSnapshot = null; },
    (row: typeof circuits[number]["row"]) => { (row.terminalSnapshot as SimulationSnapshot).traffic!.wholeRun = undefined; },
    (row: typeof circuits[number]["row"]) => { (row.terminalSnapshot as SimulationSnapshot).traffic!.wholeRun!.throughSecond--; },
    (row: typeof circuits[number]["row"]) => { row.actions = []; },
    (row: typeof circuits[number]["row"]) => { (row.terminalSnapshot as SimulationSnapshot).simulatedSeconds--; },
    (row: typeof circuits[number]["row"]) => { (row.terminalSnapshot as SimulationSnapshot).topologyRevision = 1; },
  ]) {
    const row = structuredClone(circuits[1]!.row); mutate(row);
    expect(buildRunReport(row).challenge!.criteria.find(c => c.id === "callers")!.status).toBe("not-evaluated");
  }
  const wrongIdentity = structuredClone(circuits[1]!.row); wrongIdentity.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(wrongIdentity).challenge!.status).toBe("unavailable");
}, 120000);
