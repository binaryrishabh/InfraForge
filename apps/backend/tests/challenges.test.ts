import { describe, expect, test } from "bun:test";
import { resolveWorkload } from "@infraforge/domain/workload";
import { validateConnection, validateDeploymentReadiness, validateInfrastructureName } from "@infraforge/domain/validation";
import { PREDICTION_CHOICES } from "@infraforge/contracts/challenges";
import type { ResourceType } from "@infraforge/domain/resource";
import { CHALLENGES } from "../challenges/definitions";
import { challengeSeed, findChallenge, specHash } from "../challenges/registry";
import { readPrediction } from "../challenges/prediction";
import { preflight } from "../challenges/preflight";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { WorkloadProfileSchema } from "../zod_schemas/deployment.schema";
import { REFERENCE, answers, attemptReport, definition, tier } from "./challengeHarness";

// Changing any authored field changes its hash. Bump the version, then update the pin.
const PINNED: Record<string, string> = {
  "first-production-api@1": "515c84a6da8a78c5b4c30269e0c20dff5f934e8f98608fbac572f3782dd33888",
  "secure-the-edge@1": "4166582eef18e35bee1b554c764a1debbf6d324c28cc87f5d56c7f0e02b50849",
  "cache-matters@1": "848a196cdcfe6f368690575f46384a4123e7e96af9eedc6469f442db6707c4b1",
  "write-heavy@1": "728d1ad3cf9b44b324fad21dad4e480679c495d0c1968f89ee383eed9905c292",
  "scale-out-safely@1": "718049a66d5f3147f9319f765726c5aaf687e9c254058159bacb47e19f991c23",
  "peak-traffic@1": "07bbee27be116c2f4ec0cac8382bddd1ca51aca0dde44794135e05eb5d6c5388",
};

describe("challenge definitions", () => {
  test("are well-formed, unique and use only valid, deployable starters", () => {
    expect(CHALLENGES.length).toBeGreaterThanOrEqual(4);
    expect(CHALLENGES.length).toBeLessThanOrEqual(6);
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
    for (const c of CHALLENGES) {
      expect(c.id).toMatch(/^[a-z0-9-]{1,64}$/);
      expect(Number.isInteger(c.version) && c.version > 0).toBe(true);
      expect(validateInfrastructureName(c.title)).toBeNull();
      expect(WorkloadProfileSchema.safeParse(c.workload).success).toBe(true);
      expect(resolveWorkload(c.workload)).toEqual(c.workload);
      expect(Number.isInteger(c.evaluationSeconds) && c.evaluationSeconds > 60 && c.evaluationSeconds <= 3600).toBe(true);
      expect(new Set(c.criteria.map((r) => r.id)).size).toBe(c.criteria.length);
      expect(c.criteria[0]?.kind).toBe("deployment-checks");
      expect(c.predictions.length).toBeGreaterThanOrEqual(1);
      expect(c.predictions.length).toBeLessThanOrEqual(3);
      expect(new Set(c.predictions.map((p) => p.id)).size).toBe(c.predictions.length);
      expect(c.hints.length).toBeGreaterThanOrEqual(2);
      expect(c.debrief.length).toBeGreaterThanOrEqual(2);
      if (c.starter) {
        expect(LayoutSchema.safeParse(c.starter).success).toBe(true);
        expect(validateDeploymentReadiness(c.starter.resources, c.starter.connectionLines).valid).toBe(true);
        for (const line of c.starter.connectionLines) expect(validateConnection(line.sourceType as ResourceType, line.targetType as ResourceType).valid).toBe(true);
      }
    }
  });

  test("spec hashes are stable and pinned to their versions", () => {
    for (const c of CHALLENGES) {
      expect(specHash(c)).toBe(specHash(structuredClone(c)));
      expect(specHash(c)).toBe(findChallenge(c.id)!.hash);
      expect({ id: c.id, version: c.version, hash: specHash(c) }).toEqual({ id: c.id, version: c.version, hash: PINNED[`${c.id}@${c.version}`]! });
    }
    const changed = { ...CHALLENGES[0]!, criteria: CHALLENGES[0]!.criteria.map((r) => r.kind === "monthly-budget" ? { ...r, maxUsd: r.maxUsd + 1 } : r) };
    expect(specHash(changed)).not.toBe(specHash(CHALLENGES[0]!));
    expect(challengeSeed(CHALLENGES[0]!)).toBe(`challenge:${CHALLENGES[0]!.id}:v${CHALLENGES[0]!.version}`);
  });
});

describe("evaluation against the real engine", () => {
  for (const c of CHALLENGES) {
    test(`${c.id}: the reference design meets every requirement`, () => {
      const report = attemptReport(c, REFERENCE[c.id]!, answers(c, { "overall-health": "healthy", "database-health": "healthy", "busiest-type": "Database", "security-clean": "yes", "scale-out": "no" }));
      expect(report.challenge?.criteria.filter((r) => r.status !== "met")).toEqual([]);
      expect(report.challenge?.status).toBe("met");
      expect(report.run.challenge).toEqual({ id: c.id, version: c.version, title: c.title, status: "met", metCount: c.criteria.length, total: c.criteria.length });
      expect(report.terminal?.simulatedSeconds).toBe(c.evaluationSeconds);
    });
    test(`${c.id}: the starting point does not`, () => {
      const start = c.starter ?? tier(1);
      const report = attemptReport(c, start, answers(c, { "overall-health": "healthy", "database-health": "healthy", "busiest-type": "Virtual Machine", "security-clean": "yes", "scale-out": "no" }));
      expect(report.challenge?.status).toBe("not-met");
      expect(report.challenge!.metCount).toBeLessThan(report.challenge!.total);
    });
  }

  test("a failed challenge can still hold a correct prediction, kept separate from the result", () => {
    const c = definition("cache-matters");
    const report = attemptReport(c, c.starter!, answers(c, { database: "saturated", busiest: "Database" }));
    expect(report.challenge?.status).toBe("not-met");
    expect(report.challenge?.predictions.map((p) => p.outcome)).toEqual(["matched", "matched"]);
    expect(report.challenge?.criteria.find((r) => r.id === "database")).toMatchObject({ status: "not-met", sources: ["terminalSnapshot.metrics"] });
  });

  test("a passed challenge can hold a wrong prediction", () => {
    const c = definition("first-production-api");
    const report = attemptReport(c, REFERENCE[c.id]!, answers(c, { health: "degraded", busiest: "Virtual Machine" }));
    expect(report.challenge?.status).toBe("met");
    expect(report.challenge?.predictions).toMatchObject([
      { id: "health", predicted: "degraded", actual: "healthy", outcome: "different" },
      { id: "busiest", predicted: "Virtual Machine", actual: "Database", outcome: "different" },
    ]);
  });

  test("scale-out prediction reads the autoscaled pool, counting replicas as app servers", () => {
    const c = definition("scale-out-safely");
    const report = attemptReport(c, c.starter!, answers(c, { scale: "yes", database: "saturated" }));
    expect(report.challenge?.predictions.map((p) => [p.actual, p.outcome])).toEqual([["yes", "matched"], ["saturated", "matched"]]);
    expect(report.challenge?.criteria.find((r) => r.id === "connections")).toMatchObject({ status: "not-met" });
  });

  test("an attempt stopped before the evaluation second is not judged on runtime requirements", () => {
    const c = definition("first-production-api");
    const report = attemptReport(c, REFERENCE[c.id]!, answers(c, { health: "healthy", busiest: "Database" }), { stopAt: 90 });
    expect(report.challenge?.status).toBe("not-evaluated");
    expect(report.challenge?.criteria.find((r) => r.id === "health")).toMatchObject({ status: "not-evaluated" });
    expect(report.challenge?.criteria.find((r) => r.id === "health")?.detail).toContain("stopped at second 90");
    expect(report.challenge?.predictions.every((p) => p.outcome === "unknown")).toBe(true);
    expect(report.challenge?.criteria.find((r) => r.id === "budget")?.status).toBe("met");
  });

  test("a running attempt is in progress; static failures are visible but not final", () => {
    const c = definition("first-production-api");
    const report = attemptReport(c, tier(1), answers(c, { health: "healthy", busiest: "Database" }), { status: "live", runtimeActive: true });
    expect(report.challenge?.status).toBe("in-progress");
    expect(report.challenge?.criteria.find((r) => r.id === "servers")?.status).toBe("not-met");
    expect(report.challenge?.criteria.find((r) => r.id === "health")?.status).toBe("pending");
  });

  test("attempts recorded under different rules are not re-judged", () => {
    const c = definition("first-production-api");
    const report = attemptReport(c, REFERENCE[c.id]!, answers(c, { health: "healthy", busiest: "Database" }), { hash: "0".repeat(64) });
    expect(report.challenge).toMatchObject({ status: "unavailable", definitionMatches: false, criteria: [], predictions: [] });
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
  test("fixed choice sets cover every non-design question kind", () => {
    expect(Object.keys(PREDICTION_CHOICES).sort()).toEqual(["database-health", "overall-health", "scale-out", "security-clean"]);
  });
});

describe("preflight", () => {
  test("reports static requirements and never pre-announces runtime or security outcomes", () => {
    const c = definition("secure-the-edge");
    const result = preflight(c, c.starter!);
    expect(result.valid).toBe(true);
    expect(result.checks.map((check) => [check.id, check.status])).toEqual([["checks", "ok"], ["security", "during-run"], ["capacity", "during-run"]]);
    expect(JSON.stringify(result)).not.toContain("SSH");
    const sizes = preflight(definition("write-heavy"), definition("write-heavy").starter!);
    expect(sizes.checks.find((check) => check.id === "sizes")).toMatchObject({ status: "problem" });
    expect(sizes.checks.find((check) => check.id === "budget")).toMatchObject({ status: "ok" });
  });
});
