import { expect, test } from "bun:test";
import { answers, attemptReport, attemptRow, definition as currentDefinition, legacyDefinition as definition, tier } from "./challengeHarness";
import { reviewDesignChanges } from "../challenges/designChanges";
import { improvementSource } from "../challenges/improvements";
import { captureRunInputs } from "../deployments/runInputs";
import { buildRunReport } from "../reports/report";

test("guided facts deterministically prioritize failed requirements and mismatched predictions with evaluator sources", () => {
  const d = definition("first-production-api"), row = attemptRow(d, tier(1), answers(d, { "overall-health": "critical", "busiest-type": "Database" }));
  const a = buildRunReport(row), b = buildRunReport(row), cues = a.guidedReview!.cues;
  expect(a.guidedReview).toEqual(b.guidedReview);
  expect(cues.length).toBeGreaterThanOrEqual(3); expect(cues.length).toBeLessThanOrEqual(6);
  const failed = a.challenge!.criteria.find((c) => c.status === "not-met")!;
  expect(cues[0]).toMatchObject({ id: `requirement:${failed.id}`, statement: failed.detail, sources: failed.sources });
  const mismatch = a.challenge!.predictions.find((p) => p.outcome === "different")!;
  expect(cues.find((c) => c.id === `prediction:${mismatch.id}`)?.statement).toContain(`You predicted ${mismatch.predicted}`);
  expect(cues.some((c) => c.kind === "measurement" && c.sources[0]?.startsWith("terminalSnapshot.metrics."))).toBe(true);
  expect(cues.at(-1)?.kind).toBe("unknown");
}, 60000);

test("resilience cues use actual fault-boundary samples and never infer recovery or causal solutions", () => {
  // The CPU spike starts at second 30: the cues read the seconds on either side of it.
  const d = currentDefinition("headroom-under-cpu-pressure"), r = attemptReport(d, d.starter!, answers(d, { "baseline-health": "healthy", "overall-health": "healthy", "target-health": "healthy", "scale-out": "no" }));
  const cues = r.guidedReview!.cues, facts = cues.filter((c) => c.id.startsWith("trace:"));
  expect(facts.map((c) => c.simulatedSecond)).toEqual([30, 31]);
  expect(facts[0]!.statement).toContain("55.1% CPU"); expect(facts[1]!.statement).toContain("96.4% CPU");
  expect(facts.every((c) => c.resourceId === "app-2" && c.sources[0]?.startsWith("RunEvidenceSample["))).toBe(true);
  expect(JSON.stringify(cues)).not.toMatch(/caused|will solve|upgrade.*c5|production ready/i);
  expect(cues.at(-1)?.statement).toContain("recovery");
}, 60000);

test("missing and legacy evidence stays unknown rather than reconstructing a series", () => {
  const d = definition("headroom-under-cpu-pressure"), row = attemptRow(d, d.starter!, answers(d, {}));
  const r = buildRunReport({ ...row, terminalSnapshot: null, evidenceSamples: [], runInputs: null });
  expect(r.guidedReview?.cues.some((c) => c.kind === "unknown")).toBe(true);
  expect(r.guidedReview?.cues.some((c) => c.kind === "measurement")).toBe(false);
  expect(r.guidedReview?.canImprove).toBe(false);
  const unavailable = buildRunReport({ ...row, challengeSpecHash: "0".repeat(64) });
  expect(unavailable.guidedReview?.cues).toHaveLength(1);
  expect(unavailable.guidedReview?.cues[0]?.statement).toContain("cannot be verified");
}, 60000);

test("one-change accounting reuses canonical diff and ignores only visual facts", () => {
  const a = captureRunInputs(tier(2), undefined, "fixed");
  const changed = () => structuredClone(a);
  expect(reviewDesignChanges(a, a)).toMatchObject({ classification: "no-change", count: 0 });
  const visual = changed(); visual.resources[0]!.name = "Renamed"; visual.resources[0]!.x += 10;
  expect(reviewDesignChanges(a, visual).count).toBe(0);
  const field = changed(); field.resources[2]!.skuId = "c5.xlarge";
  expect(reviewDesignChanges(a, field)).toMatchObject({ classification: "one-change", count: 1 });
  const add = changed(); add.resources.push({ ...add.resources[2]!, id: "new" });
  expect(reviewDesignChanges(a, add).count).toBe(1);
  const edge = changed(); edge.connectionLines.pop();
  expect(reviewDesignChanges(a, edge).count).toBe(1);
  const many = changed(); many.resources[2]!.encryption = true; many.resources[3]!.encryption = true;
  expect(reviewDesignChanges(a, many)).toMatchObject({ classification: "several-changes", count: 2 });
  const reorder = changed(); reorder.resources.reverse();
  expect(reviewDesignChanges(a, reorder).count).toBe(1);
  // Positional starting-jitter alignment is a Model 1 idea; Model 2 pairs never claim it.
  expect(reviewDesignChanges(a, reorder).starting.alignment.code).toBe("unknown");
  const connections = changed(); connections.connectionLines.reverse();
  expect(reviewDesignChanges(a, connections).count).toBe(1);
  const workload = changed(); workload.workloadProfile.targetThroughput++;
  expect(reviewDesignChanges(a, workload).classification).toBe("unavailable");
}, 60000);

test("improvement source refuses altered fixed conditions, active runs, another challenge and unavailable versions", () => {
  const d = currentDefinition("first-production-api"), row = attemptRow(d, tier(1), answers(d, { health: "healthy", busiest: "Database" }));
  expect(improvementSource(row, d.id).input.seed).toBe(`challenge:${d.id}:v2`);
  const legacy = definition("first-production-api");
  expect(() => improvementSource(attemptRow(legacy, tier(1), answers(legacy, { health: "healthy", busiest: "Database" })), legacy.id)).toThrow("retired Model 1");
  for (const patch of [{ runtimeActive: true }, { challengeVersion: 999 }, { challengeSpecHash: "0".repeat(64) },
    { evaluationStopAtSimulatedSeconds: 1 }, { challengeExperiment: {} }, { runInputs: { ...row.runInputs as object, seed: "different" } }]) {
    expect(() => improvementSource({ ...row, ...patch }, d.id)).toThrow();
  }
  expect(() => improvementSource(row, "write-heavy")).toThrow();
}, 60000);
