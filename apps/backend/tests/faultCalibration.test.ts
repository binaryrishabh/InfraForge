import { expect, test } from "bun:test";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { FAULT_DURATIONS } from "../simulator/faults";
import { buildRegistry } from "../challenges/registry";
import { answers, attemptReport, legacyDefinition as definition, REFERENCE } from "./challengeHarness";

// Research fixtures, not published challenges. Keep the real model and fixed seed;
// compare the same design with/without the fault to isolate its modeled operation.
for (const fault of [DeploymentChaosNames.CpuSpike, DeploymentChaosNames.MemoryLeak, DeploymentChaosNames.NetworkDelay, DeploymentChaosNames.DiskFailure]) {
  test(`model-1 calibration: ${fault}`, () => {
    const original = definition("lose-an-app-server");
    const d: ChallengeDefinition = { ...original, id: `calibration-${fault}`, experiment: { ...original.experiment!, fault },
      evaluationSeconds: 60 + FAULT_DURATIONS[fault],
      criteria: [{ id: "pressure", kind: "no-saturation", label: "No resource saturated or failed" }] };
    const registry = buildRegistry([d]);
    const prediction = answers(d, { "baseline-health": "healthy", "survivor-health": "degraded", "scale-out": "no" });
    const measured = attemptReport(d, d.starter!, prediction, { registry });
    const control = attemptReport(d, d.starter!, prediction, { registry, skipExperiment: true });
    const reference = attemptReport(d, REFERENCE[original.id]!, prediction, { registry });
    const points = measured.experimentTrace!.points;
    // Model 1 always records CPU and memory as numbers.
    const target = (second: number, report = measured) => report.experimentTrace!.points.find((p) => p.simulatedSeconds === second)!.resources.find((r) => r.id === "app-2")! as { cpu: number; memory: number; health: string };
    expect(measured.experimentTrace?.status).toBe("complete");
    expect(points).toHaveLength(31 + FAULT_DURATIONS[fault]);
    expect(target(60)).toEqual(target(60, control));
    const first = target(61), steady = target(61, control), last = target(d.evaluationSeconds);
    // The model adds 45 before applying jitter and rounding the measurement.
    if (fault === "cpu-spike") { expect(first.cpu - steady.cpu).toBeGreaterThan(44); expect(first.cpu - steady.cpu).toBeLessThan(46); }
    if (fault === "memory-leak") { expect(first.memory).toBe(steady.memory); expect(last.memory).toBeGreaterThan(steady.memory); }
    if (fault === "network-delay") expect(first.cpu).toBeGreaterThan(steady.cpu);
    // Disk failure sets CPU to 100 before jitter; it does not set the Crash flag.
    if (fault === "disk-failure") { expect(first.cpu).toBeGreaterThanOrEqual(98); expect(first.health).toBe("saturated"); }
    console.info("Fault calibration:", JSON.stringify({ fault, duration: FAULT_DURATIONS[fault], first, last,
      starter: measured.challenge?.status, reference: reference.challenge?.status,
      peak: measured.experimentTrace?.resourceFacts.find((r) => r.id === "app-2")?.highestCpu }));
  });
}
