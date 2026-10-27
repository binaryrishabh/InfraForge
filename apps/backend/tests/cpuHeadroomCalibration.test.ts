import { expect, test } from "bun:test";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { buildRegistry } from "../challenges/registry";
import { answers, attemptReport, legacyDefinition as definition, REFERENCE } from "./challengeHarness";

test("CPU headroom candidate separates a starter from spare capacity under a fixed model-1 seed", () => {
  const original = definition("lose-an-app-server");
  const d: ChallengeDefinition = { ...original, id: "headroom-under-cpu-pressure", workload: { ...original.workload, targetThroughput: 514_800 },
    starter: { ...original.starter!, resources: original.starter!.resources.map((r) => r.id === "lb" ?
      { ...r, autoscaling: { enabled: true, minReplicas: 2, maxReplicas: 4, targetCpu: 60 } } : r) },
    experiment: { ...original.experiment!, fault: DeploymentChaosNames.CpuSpike }, evaluationSeconds: 80,
    criteria: [{ id: "pressure", kind: "no-saturation", label: "No saturated or failed resource at evaluation" }] };
  const registry = buildRegistry([d]);
  const prediction = answers(d, { "baseline-health": "healthy", "survivor-health": "healthy", "scale-out": "no" });
  const starter = attemptReport(d, d.starter!, prediction, { registry });
  const reference = attemptReport(d, { ...d.starter!, resources: d.starter!.resources.map((r) => r.id === "app-2" ? { ...r, skuId: "c5.xlarge" } : r) }, prediction, { registry });
  console.info("CPU headroom candidate:", JSON.stringify({ starter: starter.challenge?.status, reference: reference.challenge?.status,
    starterMetrics: starter.terminal?.resources, referenceMetrics: reference.terminal?.resources, pools: starter.terminal?.pools }));
  expect(starter.challenge?.status).toBe("not-met"); expect(reference.challenge?.status).toBe("met");
  expect(starter.challenge?.experiment?.baselineOverallHealth).toBe("healthy");
  expect(reference.challenge?.experiment?.baselineOverallHealth).toBe("healthy");
});

test("published CPU-pressure challenge calibrates every criterion and evaluates target-health predictions", () => {
  const d = definition("headroom-under-cpu-pressure");
  const prediction = answers(d, { "baseline-health": "healthy", "target-health": "saturated", "overall-health": "saturated", "scale-out": "no" });
  const starter = attemptReport(d, d.starter!, prediction);
  const reference = attemptReport(d, REFERENCE[d.id]!, answers(d, { "baseline-health": "healthy", "target-health": "healthy", "overall-health": "healthy", "scale-out": "no" }));
  expect(starter.challenge?.status).toBe("not-met"); expect(reference.challenge?.status).toBe("met");
  expect(starter.challenge?.predictions.map((p) => p.outcome)).toEqual(["matched", "matched", "matched", "matched"]);
  expect(reference.challenge?.predictions.map((p) => p.outcome)).toEqual(["matched", "matched", "matched", "matched"]);
  expect(starter.experimentTrace?.sampleCount).toBe(51);
  expect(starter.experimentTrace?.points.find((p) => p.simulatedSeconds === 60)?.resources.find((r) => r.id === "app-2")?.health).toBe("healthy");
  expect(starter.experimentTrace?.points.find((p) => p.simulatedSeconds === 61)?.resources.find((r) => r.id === "app-2")?.cpu).toBeGreaterThan(90);
});
