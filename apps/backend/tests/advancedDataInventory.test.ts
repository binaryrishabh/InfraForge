import { expect, test } from "bun:test";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { learningContent } from "../learning/content";
import { buildRunReport } from "../reports/report";
import { buildRegistry } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { starter } from "../challenges/starter";
import { definition, REFERENCE, attemptRow, answers } from "./challengeHarness";

test("data and scaling level by kind inventory uses registered canonical content", () => {
  // Same count pattern as beginnerOnrampsCalibration; no separate curriculum source.
  for (const track of ["data", "scaling"]) console.info(JSON.stringify({track,
    columns: ["level", "reading", "conceptual-exercise", "executable-lab"],
    counts: ["beginner", "intermediate", "advanced"].map(level => [level,
      ...["reading", "conceptual-exercise", "executable-lab"].map(kind =>
        learningContent.lessons.filter(l => l.trackId === track && l.level === level && l.kind === kind).length)]),
  }));
});

test("screening cache plus pools plus replica does not invent a failing starter or a binding budget", () => {
  const base = definition("move-reads-off-the-writer");
  const d: ChallengeDefinition = {...base, criteria: [...base.criteria,
    {id: "budget", kind: "monthly-budget", label: "Exploration budget", maxUsd: 200}]};
  const start = starter([
    ["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60}}],
    ["app", "Virtual Machine", 1, 0, {size: "large", autoscaling: {enabled: true, minReplicas: 4, maxReplicas: 4, targetCpu: 80}}],
    ["cache", "Cache", 2, 1, {cachePolicy: {version: 2, capacityEntries: 100}}],
    ["db", "Database", 3, 0, {dataKeyspace: {version: 1, count: 100, accessPattern: "uniform"},
      databaseReplication: {version: 1, enabled: true, replicationDelayMs: 1000, readPolicy: "primary"},
      databaseReadRouting: {version: 1, policy: "primary-only"}}],
  ], [["lb", "app"], ["app", "cache"], ["app", "db"]]);
  const routed = structuredClone(start), tier = structuredClone(start);
  routed.resources.find(r => r.id === "db")!.databaseReadRouting!.policy = "replica-preferred";
  tier.resources.find(r => r.id === "db")!.skuId = "db.t3.micro";
  for (const [variant, design] of [["start", start], ["read-routing", routed], ["database-tier", tier]] as const) {
    expect(preflight(d, design).valid).toBe(true);
    const r = buildRunReport(attemptRow(d, design, answers(d, {"database-health": "healthy"})), buildRegistry([d]));
    const db = r.terminal!.resources.find(r => r.id === "db")!;
    const cost = r.stages.find(s => s.name === "CostEstimate")!.monthlyEstimateUsd!;
    expect(r.challenge!.status).toBe("met");
    expect(r.terminal!.traffic!.latencyMs.p95!).toBeLessThan(15);
    expect(cost).toBeLessThan(110); expect(db.database!.sessionRefused).toBe(0);
    if (variant === "read-routing") expect(db.database!.readRouting!.staleReads).toBeGreaterThan(1000);
    console.info(JSON.stringify({candidate: "cache-pool-replica", variant, status: r.challenge!.status,
      p95: r.terminal!.traffic!.latencyMs.p95, estimate: cost, connections: db.connections,
      refused: db.database!.sessionRefused, staleReads: db.database!.readRouting!.staleReads}));
  }
  // This is a rejected candidate, deliberately absent from the published registry.
  expect(definition(d.id)).toBe(base);
}, 120000);

test("screening workload mixes retains the existing session mechanism and initial-count tradeoff", () => {
  const base = definition("budget-app-database-sessions");
  for (const mix of [1, 0.5, 0]) {
    const d = {...base, workload: {...base.workload, readWriteRatio: mix}};
    const r = buildRunReport(attemptRow(d, d.starter!, answers(d, {"database-health": "healthy"})), buildRegistry([d]));
    const db = r.terminal!.resources.find(r => r.id === "db")!;
    expect(r.challenge!.status).toBe("not-met"); expect(db.connections).toBe(85);
    expect(db.database!.sessionRefused!).toBeGreaterThan(400);
    expect(db.cpu!).toBeLessThan(35); expect(db.health).toBe("healthy");
    expect(r.terminal!.pools!.lb!.currentReplicas).toBe(12);
    console.info(JSON.stringify({candidate: "read-write-mix", mix, connections: db.connections,
      cpu: db.cpu, refused: db.database!.sessionRefused, p95: r.terminal!.traffic!.latencyMs.p95}));
  }
  const eight = structuredClone(REFERENCE[base.id]!);
  eight.resources.find(r => r.id === "lb")!.autoscaling!.minReplicas = 8;
  const r = buildRunReport(attemptRow(base, eight, answers(base, {"database-health": "healthy"})));
  expect(r.challenge!.status).toBe("met");
  expect(r.terminal!.resources.find(r => r.id === "db")!.connections).toBe(80);
  expect(r.terminal!.pools!.lb!.currentReplicas).toBe(8);
  expect(r.terminal!.pools!.lb!.pending).toBeNull();
  console.info(JSON.stringify({candidate: "initial-count", count: 8, status: r.challenge!.status,
    wholeRun: r.terminal!.traffic!.wholeRun, connections: 80}));
  // Second six precedes the first reconcile. This cannot be sold as scale-out.
  expect(base.evaluationSeconds).toBeLessThan(10);
}, 120000);
