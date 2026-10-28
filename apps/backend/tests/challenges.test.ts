import { describe, expect, test } from "bun:test";
import { resolveWorkload } from "@infraforge/domain/workload";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { PREDICTION_CHOICES, type ChallengeDefinition } from "@infraforge/contracts/challenges";
import { CHALLENGE_VERSIONS } from "../challenges/definitions";
import { buildRegistry, categoryOf, challengeSeed, findChallenge, latestChallenge, listLatestChallenges, specHash } from "../challenges/registry";
import { readPrediction } from "../challenges/prediction";
import { preflight } from "../challenges/preflight";
import { experimentReadiness, recordedExperiment } from "../challenges/experiment";
import { captureRunInputs } from "../deployments/runInputs";
import { WorkloadProfileSchema } from "../zod_schemas/deployment.schema";
import { REFERENCE, answers, attemptReport, definition as current, legacyDefinition as definition, tier } from "./challengeHarness";

// current(): the published Model 2 version, for tests that run the engine. definition(): version 1, still valid
// input where only the rules themselves are checked (predictions, preflight, readiness).

describe("versioned registry", () => {
  const v2 = findChallenge("cache-matters", 2)!.definition;
  // A materially different next version: a tighter budget is a different task.
  const v3: ChallengeDefinition = { ...v2, version: 3, objective: "Same, for $350 a month or less.",
    criteria: v2.criteria.map((c) => c.kind === "monthly-budget" ? { ...c, label: "Monthly estimate is $350 or less", maxUsd: 350 } : c) };
  const registry = buildRegistry([...CHALLENGE_VERSIONS, v3]);

  test("every challenge is listed once, at its latest version, with its category", () => {
    const listed = listLatestChallenges().map((e) => e.definition);
    expect(new Set(listed.map((d) => d.id)).size).toBe(listed.length);
    expect(listed.map((d) => [d.id, categoryOf(d)]).filter(([, c]) => c === "resilience")).toEqual([["lose-an-app-server", "resilience"], ["cache-failure", "resilience"], ["headroom-under-cpu-pressure", "resilience"], ["after-the-cache-returns", "resilience"]]);
    for (const d of listed) {
      expect(validateInfrastructureName(d.title)).toBeNull();
      expect(WorkloadProfileSchema.safeParse(d.workload).success).toBe(true);
      expect(resolveWorkload(d.workload)).toEqual(d.workload);
    }
    expect(registry.latest("cache-matters")?.definition.version).toBe(3);
    expect(registry.listLatest().filter((e) => e.definition.id === "cache-matters").map((e) => e.definition.version)).toEqual([3]);
    expect(registry.find("cache-matters", 2)?.hash).toBe(specHash(v2));
    expect(registry.find("cache-matters", 4)).toBeNull();
    expect(() => buildRegistry([v2, { ...v2 }])).toThrow("Duplicate challenge version cache-matters@2");
  });

  test("seeds are per version, so a new version never reuses an old version's randomness", () => {
    expect(challengeSeed(v2)).toBe("challenge:cache-matters:v2");
    expect(challengeSeed(v3)).toBe("challenge:cache-matters:v3");
    expect(captureRunInputs({ ...v2.starter!, layoutVersion: 3 }, v3.workload, challengeSeed(v3)).seed).toBe("challenge:cache-matters:v3");
  });

  test("a version 2 attempt is judged by version 2 after version 3 becomes latest, and fails safe without it", () => {
    const design = tier(4, { cache: true }), prediction = answers(v2, { database: "healthy", busiest: "Virtual Machine" });
    const historical = attemptReport(v2, design, prediction, { registry });
    expect(historical.challenge).toMatchObject({ version: 2, status: "met", definitionMatches: true });
    expect(historical.challenge?.criteria.find((c) => c.id === "budget")?.label).toBe("Monthly estimate is $400 or less");
    // The same design under version 3's tighter budget is judged only by a version 3 attempt.
    const next = attemptReport(v3, design, prediction, { registry });
    expect(next.challenge).toMatchObject({ version: 3, status: "met" });
    expect(next.challenge?.criteria.find((c) => c.id === "budget")?.label).toBe("Monthly estimate is $350 or less");
    const missing = attemptReport(v2, design, prediction, { registry: buildRegistry([v3]), stopAt: 1 });
    expect(missing.challenge).toMatchObject({ status: "unavailable", definitionMatches: false, criteria: [] });
    const wrongHash = attemptReport(v2, design, prediction, { hash: "0".repeat(64), registry, stopAt: 1 });
    expect(wrongHash.challenge).toMatchObject({ status: "unavailable", definitionMatches: false });
  }, 120000);

  test("an attempt whose recorded experiment differs from its version's plan is not re-judged", () => {
    const d = current("lose-an-app-server"), prediction = answers(d, { baseline: "healthy", survivors: "healthy" });
    const moved = attemptReport(d, REFERENCE[d.id]!, prediction, { plan: { ...recordedExperiment(d)!, atSimulatedSecond: 31 } });
    expect(moved.challenge).toMatchObject({ status: "unavailable", definitionMatches: false });
    const dropped = attemptReport(d, REFERENCE[d.id]!, prediction, { plan: null });
    expect(dropped.challenge?.status).toBe("unavailable");
    const design = current("cache-matters");
    expect(attemptReport(design, REFERENCE[design.id]!, answers(design, { database: "healthy", busiest: "Database" }), { plan: recordedExperiment(d) }).challenge?.status).toBe("unavailable");
  }, 120000);
});

describe("design challenge evaluation", () => {
  test("a failed challenge can still hold a correct prediction, kept separate from the result", () => {
    const c = current("cache-matters");
    const report = attemptReport(c, c.starter!, answers(c, { database: "degraded", busiest: "Virtual Machine" }));
    expect(report.challenge?.status).toBe("not-met");
    expect(report.challenge?.predictions.map((p) => p.outcome)).toEqual(["matched", "matched"]);
    expect(report.challenge?.criteria.find((r) => r.id === "database")).toMatchObject({ status: "not-met", sources: ["terminalSnapshot.metrics"] });
    expect(report.challenge?.experiment).toBeNull();
  }, 60000);

  test("a passed challenge can hold a wrong prediction", () => {
    const c = current("first-production-api");
    const report = attemptReport(c, REFERENCE[c.id]!, answers(c, { health: "degraded", busiest: "Database" }));
    expect(report.challenge?.status).toBe("met");
    expect(report.challenge?.predictions).toMatchObject([
      { id: "health", predicted: "degraded", actual: "healthy", outcome: "different" },
      { id: "busiest", predicted: "Database", actual: "Virtual Machine", outcome: "different" },
    ]);
  }, 60000);

  test("scale-out prediction reads the autoscaled pool, counting replicas as app servers", () => {
    const c = current("scale-out-safely");
    // The starter with its load balancer's autoscaling switched on: its saturated servers make the pool grow.
    const pooled = { ...c.starter!, resources: c.starter!.resources.map((r) => r.id === "lb" ? { ...r, autoscaling: { enabled: true, minReplicas: 3, maxReplicas: 6, targetCpu: 60 } } : r) };
    const report = attemptReport(c, pooled, answers(c, { scale: "yes", database: "healthy" }));
    expect(report.challenge?.predictions.map((p) => [p.actual, p.outcome])).toEqual([["yes", "matched"], ["healthy", "matched"]]);
    expect(report.terminal?.pools?.lb?.currentReplicas).toBeGreaterThan(3);
    const fixed = attemptReport(c, c.starter!, answers(c, { scale: "yes", database: "healthy" }));
    expect(fixed.challenge?.predictions.map((p) => [p.actual, p.outcome])).toEqual([["no", "different"], ["healthy", "matched"]]);
  }, 120000);

  test("an attempt stopped before the evaluation second is not judged on runtime requirements", () => {
    const c = current("first-production-api");
    const report = attemptReport(c, REFERENCE[c.id]!, answers(c, { health: "healthy", busiest: "Virtual Machine" }), { stopAt: 50 });
    expect(report.challenge?.status).toBe("not-evaluated");
    expect(report.challenge?.criteria.find((r) => r.id === "health")).toMatchObject({ status: "not-evaluated" });
    expect(report.challenge?.criteria.find((r) => r.id === "health")?.detail).toContain("stopped at second 50");
    expect(report.challenge?.predictions.every((p) => p.outcome === "unknown")).toBe(true);
    expect(report.challenge?.criteria.find((r) => r.id === "budget")?.status).toBe("met");
  }, 60000);

  test("a running attempt is in progress; static failures are visible but not final", () => {
    const c = current("first-production-api");
    const report = attemptReport(c, tier(1), answers(c, { health: "healthy", busiest: "Database" }), { status: "live", runtimeActive: true, stopAt: 10 });
    expect(report.challenge?.status).toBe("in-progress");
    expect(report.challenge?.criteria.find((r) => r.id === "servers")?.status).toBe("not-met");
    expect(report.challenge?.criteria.find((r) => r.id === "health")?.status).toBe("pending");
  });
});

describe("resilience challenge evaluation", () => {
  const d = current("lose-an-app-server");
  const prediction = answers(d, { baseline: "healthy", survivors: "saturated" });

  test("the starter's survivor saturates while app-2 is down; predictions are judged from the fault's own evidence", () => {
    const report = attemptReport(d, d.starter!, prediction);
    expect(report.challenge?.status).toBe("not-met");
    expect(report.challenge?.criteria.find((c) => c.id === "survivors")).toMatchObject({ status: "not-met", sources: ["terminalSnapshot.metrics", "RunAction.parameters"] });
    expect(report.challenge?.criteria.find((c) => c.id === "survivors")?.detail).toMatch(/^Besides app-2, at second 60: app-1 \(saturated/);
    expect(report.challenge?.predictions.map((p) => [p.id, p.actual, p.outcome])).toEqual([["baseline", "healthy", "matched"], ["survivors", "saturated", "matched"]]);
    expect(report.challenge?.predictions[0]?.sources).toEqual(["RunAction.outcome.baselineOverallHealth"]);
    expect(report.challenge?.experiment).toMatchObject({ fault: "crash", targetResourceId: "app-2", atSimulatedSecond: 30, durationSimulatedSeconds: 30,
      state: "ended", appliedSimulatedSeconds: 30, endedSimulatedSeconds: 60, targetHealthAtEvaluation: "failed" });
    expect(report.challenge?.experiment?.detail).toContain("A fault ending is not the same as recovery.");
    const fault = report.actions.find((a) => a.kind === "chaos")!;
    expect(fault).toMatchObject({ parameters: { type: "crash", resourceId: "app-2", trigger: "challenge-experiment" }, status: "completed",
      appliedSimulatedSeconds: 30, completedSimulatedSeconds: 60, outcome: { durationSimulatedSeconds: 30, faultEnded: true, baselineOverallHealth: "healthy" } });
  }, 60000);

  test("redundancy passes; the target's own failure is the experiment, not a failed requirement", () => {
    const report = attemptReport(d, REFERENCE[d.id]!, answers(d, { baseline: "healthy", survivors: "healthy" }));
    expect(report.challenge?.status).toBe("met");
    expect(report.challenge?.predictions.every((p) => p.outcome === "matched")).toBe(true);
    expect(report.terminal?.resources.find((r) => r.id === "app-2")?.health).toBe("failed");
  }, 60000);

  test("a fault that never happened leaves the attempt unjudged rather than pretending", () => {
    const missing = attemptReport(d, REFERENCE[d.id]!, prediction, { skipExperiment: true });
    expect(missing.challenge).toMatchObject({ status: "not-evaluated", experiment: { state: "not-applied" } });
    expect(missing.challenge?.criteria.find((c) => c.id === "survivors")).toMatchObject({ status: "not-evaluated" });
    expect(missing.challenge?.predictions.every((p) => p.outcome === "unknown")).toBe(true);
    const early = attemptReport(d, REFERENCE[d.id]!, prediction, { stopAt: 20 });
    expect(early.challenge?.experiment).toMatchObject({ state: "not-applied" });
    expect(early.challenge?.experiment?.detail).toContain("stopped at second 20, before the fault was due");
    expect(early.challenge?.status).toBe("not-evaluated");
  }, 60000);

  test("a live attempt shows the fault as scheduled, then active", () => {
    const before = attemptReport(d, REFERENCE[d.id]!, prediction, { stopAt: 20, status: "live", runtimeActive: true });
    expect(before.challenge).toMatchObject({ status: "in-progress", experiment: { state: "scheduled", appliedSimulatedSeconds: null } });
    const during = attemptReport(d, REFERENCE[d.id]!, prediction, { stopAt: 45, status: "live", runtimeActive: true });
    expect(during.challenge).toMatchObject({ status: "in-progress", experiment: { state: "active", appliedSimulatedSeconds: 30, baselineOverallHealth: "healthy" } });
  }, 60000);

  test("the target must stay in the serving path, behind a pool, or the experiment cannot run", () => {
    const e = d.experiment!;
    const without = { ...d.starter!, resources: d.starter!.resources.filter((r) => r.id !== "app-2"), connectionLines: d.starter!.connectionLines.filter((l) => l.sourceId !== "app-2" && l.targetId !== "app-2") };
    expect(experimentReadiness(e, without)).toMatchObject({ ready: false });
    expect(experimentReadiness(e, without).detail).toContain("no longer in this design");
    const unpooled = { ...d.starter!, resources: d.starter!.resources.map((r) => r.id === "lb" ? { ...r, autoscaling: { enabled: false } } : r) };
    expect(experimentReadiness(e, unpooled).detail).toContain("only a pool sends requests away from a crashed server");
    const sidelined = { ...d.starter!, connectionLines: d.starter!.connectionLines.filter((l) => l.targetId !== "app-2") };
    expect(experimentReadiness(e, sidelined).detail).toContain("must stay connected to traffic");
    expect(preflight(d, without)).toMatchObject({ valid: false, experiment: { ready: false } });
    expect(preflight(d, d.starter!)).toMatchObject({ valid: true, experiment: { ready: true } });
  });
});

describe("predictions", () => {
  const c = definition("peak-traffic");
  const types = ["DNS", "Load Balancer", "Virtual Machine", "Cache", "Database"];
  const complete = { answers: { health: "degraded", scale: "no", busiest: "Virtual Machine" }, reasoning: "  Bursts outpace scaling.  " };
  test("accepts a complete answer set and trims reasoning", () => {
    expect(readPrediction(complete, c, types)).toEqual({ answers: { health: "degraded", scale: "no", busiest: "Virtual Machine" }, reasoning: "Bursts outpace scaling." });
    expect(readPrediction({ answers: complete.answers }, c, types).reasoning).toBeNull();
  });
  test("rejects missing, extra, unknown or out-of-design answers and oversized reasoning", () => {
    for (const bad of [
      { answers: { health: "degraded", scale: "no" } },
      { answers: { ...complete.answers, extra: "yes" } },
      { answers: { ...complete.answers, health: "fine" } },
      { answers: { ...complete.answers, busiest: "CDN" } },
      { answers: { ...complete.answers, busiest: "__proto__" } },
      { answers: complete.answers, reasoning: "x".repeat(501) },
      { answers: complete.answers, criteria: [] },
      null,
    ]) expect(() => readPrediction(bad, c, types)).toThrow();
  });
  test("fixed choice sets cover every non-design question kind, including the experiment's", () => {
    expect(Object.keys(PREDICTION_CHOICES).sort()).toEqual(["baseline-health", "database-health", "overall-health", "scale-out", "security-clean", "survivor-health", "target-health"]);
    const r = definition("lose-an-app-server");
    expect(readPrediction({ answers: { baseline: "healthy", survivors: "failed", scale: "no" } }, r, types).answers.survivors).toBe("failed");
    expect(() => readPrediction({ answers: { baseline: "failed", survivors: "failed", scale: "no" } }, r, types)).toThrow();
  });
});

describe("preflight", () => {
  test("reports static requirements and never pre-announces runtime or security outcomes", () => {
    const c = definition("secure-the-edge");
    const result = preflight(c, c.starter!);
    expect(result.valid).toBe(true);
    expect(result.experiment).toBeNull();
    expect(result.checks.map((check) => [check.id, check.status])).toEqual([["checks", "ok"], ["security", "during-run"], ["capacity", "during-run"]]);
    expect(JSON.stringify(result)).not.toContain("SSH");
    const sizes = preflight(definition("write-heavy"), definition("write-heavy").starter!);
    expect(sizes.checks.find((check) => check.id === "sizes")).toMatchObject({ status: "problem" });
    expect(sizes.checks.find((check) => check.id === "budget")).toMatchObject({ status: "ok" });
    expect(latestChallenge("not-a-challenge")).toBeNull();
  });
});
