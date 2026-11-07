import { expect, test } from "bun:test";
import { resolve } from "node:path";
import type { RunReport } from "@infraforge/contracts/reports";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { learningMeasurement } from "@infraforge/contracts/learning";
import { learningContent } from "../learning/content";
import { checkLearningAuthoring } from "../learning/authoring";
import { validateLearningContent } from "../learning/validate";
import { LEARNING_REGISTRY } from "../learning/registry";
import { deriveLessonProgress } from "../learning/progress";
import { buildRunReport } from "../reports/report";
import { captureRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { answers, attemptRow, definition, REFERENCE } from "./challengeHarness";

const anchors = [
  {id: "compare-designs-honestly", track: "architecture", level: "intermediate", kind: "reading", answer: "window",
    labs: ["cache-or-database", "limit-or-capacity", "one-vm-or-a-pool", "split-the-capacity-budget"],
    labels: ["CPU", "p95", "Whole run: Completed", "Whole run: Failed", "Whole run: In-flight", "Overall health", "Route throttles (429)", "Upstream failures (502)", "Monthly estimate (CostEstimate gate)"]},
  {id: "passing-designs-and-budget", track: "architecture", level: "advanced", kind: "conceptual-exercise", answer: "both",
    labs: ["split-the-capacity-budget"], labels: ["Monthly resource price line items", "Remaining monthly budget", "Monthly estimate (CostEstimate gate)", "p95", "CPU", "Overall health", "Whole run: Completed", "Whole run: Failed", "Whole run: In-flight"]},
  {id: "read-before-changing", track: "diagnosis", level: "beginner", kind: "reading", answer: "unknown",
    labs: ["where-does-the-time-go", "waiting-with-spare-cpu", "diagnose-query-admission", "fit-a-request-in-memory", "diagnose-consumer-credit"],
    labels: ["Offered requests/s", "Completed requests/s", "Whole run: Completed", "Whole run: Failed", "Whole run: In-flight", "Deadline exceeded", "Abandoned", "p95", "CPU", "Health", "Serving queries", "Queued queries", "Queries waiting for locks", "Connections", "Refused session opens", "Connection acquisition wait", "VM memory: Resident", "VM memory: Limit", "VM memory: Headroom", "VM memory: Refused allocations", "Queue: acknowledged", "Queue: ready", "Queue: in flight"]},
];

test("reasoning lessons are reachable, bounded, checked and refuse fabricated results or dependencies", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(() => checkLearningAuthoring(learningContent)).not.toThrow();
  for (const anchor of anchors) {
    const lesson = LEARNING_REGISTRY.findLesson(anchor.id)!;
    expect(lesson).toMatchObject({trackId: anchor.track, level: anchor.level, kind: anchor.kind, experiment: null, availability: "available"});
    expect(lesson.check!.correctChoiceId).toBe(anchor.answer);
    expect(lesson.check!.choices.filter(c => c.id === anchor.answer)).toHaveLength(1);
    expect(lesson.check!.explanation.length).toBeGreaterThan(100);
    expect(lesson.limitations.length).toBeGreaterThan(1);
    expect(deriveLessonProgress("reader", [lesson], [])).toEqual([]);
    expect(LEARNING_REGISTRY.findModule(anchor.track, lesson.moduleId)!.lessonIds.filter(id => id === anchor.id)).toHaveLength(1);
    for (const id of lesson.prerequisites) expect(LEARNING_REGISTRY.findLesson(id)?.availability).toBe("available");
    if (anchor.level === "beginner") expect(lesson.prerequisites.every(id => LEARNING_REGISTRY.findLesson(id)?.level === "beginner")).toBe(true);
    for (const id of anchor.labs) {
      const lab = LEARNING_REGISTRY.findLesson(id)!;
      expect(lab.kind).toBe("executable-lab");
      expect(lesson.explanation.join(" ")).toContain(`${lab.title} (${id})`);
    }
    expect(anchor.labs.some(id => lesson.followUp!.includes(`(${id})`))).toBe(true);
    for (const label of anchor.labels) {
      expect(lesson.explanation.join(" ")).toContain(label);
      expect(learningMeasurement(label)).not.toBeNull();
    }
    for (const mutation of ["check", "prerequisite", "experiment", "result", "limitation"] as const) {
      const bad = structuredClone(learningContent), l = bad.lessons.find(l => l.id === lesson.id)!;
      if (mutation === "check") l.check!.correctChoiceId = "absent";
      if (mutation === "prerequisite") l.prerequisites.push("absent");
      if (mutation === "experiment") Object.assign(l, {experiment: {challengeId: anchor.labs[0], prediction: null}});
      if (mutation === "result") l.explanation[0] = "The recorded run shows p95 of 999 ms.";
      if (mutation === "limitation") l.limitations = [];
      expect(() => checkLearningAuthoring(bad)).toThrow();
    }
  }
  // Appended modules preserve the original lab ordering and published lessons.
  expect(LEARNING_REGISTRY.findTrack("architecture")!.modules.map(m => m.id)).toEqual(["cross-resource-choices", "capacity-budgets", "design-reasoning"]);
  expect(LEARNING_REGISTRY.findTrack("diagnosis")!.modules.map(m => m.id)).toEqual(["admission-diagnosis", "memory-admission", "async-and-dependencies", "report-first"]);
});

async function renderReports(reports: RunReport[]) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import { createElement as h } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { MemoryRouter } from "react-router-dom";
    import { ReportMeasurements } from "./src/features/reports/components/ReportMeasurements";
    import { ChallengeDebrief } from "./src/features/challenges/components/ChallengeDebrief";
    const reports = await Bun.stdin.json();
    console.log(JSON.stringify(reports.map(r => renderToStaticMarkup(h(MemoryRouter, {},
      h(ReportMeasurements, {report:r, number:1}), h(ChallengeDebrief, {evaluation:r.challenge, brief:null}))))));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify(reports)); child.stdin.end();
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({code, stderr}).toEqual({code: 0, stderr: ""});
  return JSON.parse(stdout) as string[];
}

const metric = (r: RunReport, id: string) => r.terminal!.resources.find(m => m.id === id)!;
const cost = (r: RunReport) => r.stages.find(s => s.name === "CostEstimate")?.monthlyEstimateUsd;
const p95 = (r: RunReport) => r.terminal!.traffic!.latencyMs.p95;

for (const id of [...new Set(anchors.flatMap(a => a.labs))]) test(`${id}: reasoning points to real rendered report populations, and absent evidence stays unproven`, async () => {
  const d = definition(id), start = d.starter!, fixed = REFERENCE[id]!;
  const input = captureRunInputs(start, d.workload, challengeSeed(d));
  const captured = captureRunInputs(fixed, d.workload, challengeSeed(d));
  expect(captured.workloadProfile).toEqual(input.workloadProfile);
  expect(captured.seed).toBe(input.seed); expect(captured.catalogSnapshot).toBe(input.catalogSnapshot);
  expect(preflight(d, start).valid).toBe(true); expect(preflight(d, fixed).valid).toBe(true);
  const prediction = answers(d, {"busiest-type": "Database", "overall-health": "healthy", "database-health": "healthy"});
  // Undo only the tested control; the remaining saved design must be identical.
  const restored = structuredClone(fixed), originalApp = start.resources.find(r => r.id === "app");
  if (id === "where-does-the-time-go") {
    const app = restored.resources.find(r => r.id === "app")!;
    if (originalApp!.skuId === undefined) delete app.skuId; else app.skuId = originalApp!.skuId;
  } else if (id === "waiting-with-spare-cpu") restored.resources.find(r => r.id === "app")!.vmExecution = originalApp!.vmExecution;
  else if (id === "fit-a-request-in-memory") restored.resources.find(r => r.id === "app")!.size = originalApp!.size;
  else if (id === "diagnose-query-admission") restored.resources.find(r => r.id === "db")!.dbConcurrency = start.resources.find(r => r.id === "db")!.dbConcurrency;
  else if (id === "diagnose-consumer-credit") restored.resources.find(r => r.id === "worker")!.asyncWorker = start.resources.find(r => r.id === "worker")!.asyncWorker;
  else if (id === "limit-or-capacity") restored.resources.find(r => r.id === "gateway")!.apiGateway = start.resources.find(r => r.id === "gateway")!.apiGateway;
  if (!["cache-or-database", "one-vm-or-a-pool", "split-the-capacity-budget"].includes(id)) expect(restored).toEqual(start);
  const rows = [start, fixed].map(s => attemptRow(d, s, prediction));
  const reports = rows.map(r => buildRunReport(r)), [before, after] = reports as [RunReport, RunReport];
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met"]);
  if (id === "cache-or-database") {
    expect(metric(before, "db").cpu).toBe(100);
    expect(metric(after, "db").cpu!).toBeLessThan(metric(before, "db").cpu!);
    expect(p95(after)!).toBeLessThan(p95(before)!);
  } else if (id === "limit-or-capacity") {
    const route = (r: RunReport) => metric(r, "gateway").gateway!.routes.find(r => r.id === "read")!;
    expect(route(before).outcomes!.upstreamFailed).toBeGreaterThan(1000);
    expect(route(after).outcomes!.completed).toBe(2); expect(route(after).outcomes!.upstreamFailed).toBe(0);
    expect(route(after).rejected).toBeGreaterThan(route(before).rejected);
    expect(cost(after)).toBeUndefined();
  } else if (id === "one-vm-or-a-pool") {
    expect(p95(before)!).toBeLessThan(10);
    expect(before.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(900);
    expect(after.terminal!.traffic!.wholeRun!.failed).toBe(0);
    expect(after.actions[0]!.outcome!.intervention).toMatchObject({resolvedTargets: ["app"], atUs: 2_000_001, endUs: 4_000_001});
    const cheaper = buildRunReport(attemptRow(d, REFERENCE[`${id}-small`]!, prediction));
    expect(cheaper.challenge!.status).toBe("met"); expect(cost(cheaper)!).toBeLessThan(cost(after)!);
    expect(p95(cheaper)!).toBeGreaterThan(p95(after)!);
    reports.push(cheaper);
  } else if (id === "split-the-capacity-budget") {
    const extra = REFERENCE[`${id}-app-headroom`]!, db = REFERENCE[`${id}-db-headroom`]!;
    const over = {...extra, resources: extra.resources.map(r => r.id === "db" ? db.resources.find(r => r.id === "db")! : r)};
    const undo = structuredClone(extra); undo.resources.find(r => r.id === "app")!.skuId = fixed.resources.find(r => r.id === "app")!.skuId;
    expect(undo).toEqual(fixed);
    const larger = buildRunReport(attemptRow(d, extra, prediction));
    const excess = buildRunReport(attemptRow(d, over, prediction));
    expect(larger.challenge!.status).toBe("met"); expect(cost(larger)!).toBeGreaterThan(cost(after)!);
    expect(metric(larger, "app").cpu!).toBeLessThan(metric(after, "app").cpu!);
    expect(p95(larger)).toBe(p95(after));
    expect(larger.terminal!.traffic!.wholeRun!.completed).toBe(after.terminal!.traffic!.wholeRun!.completed);
    expect(excess.challenge!.criteria.filter(c => c.status !== "met").map(c => c.id)).toEqual(["budget"]);
    expect(excess.monthlyBudgets![0]!.remainingUsd!).toBeLessThan(0);
    for (const r of [after, larger, excess]) {
      const stage = r.stages.find(s => s.name === "CostEstimate")!;
      expect(stage.lineItems!.reduce((sum, item) => sum + item.monthlyUsd, 0)).toBe(cost(r)!);
      expect(r.monthlyBudgets![0]!.remainingUsd).toBe(r.monthlyBudgets![0]!.limitUsd - cost(r)!);
    }
    reports.push(larger, excess);
  } else if (id === "where-does-the-time-go" || id === "waiting-with-spare-cpu") {
    expect(p95(after)!).toBeLessThan(p95(before)!);
    expect(before.terminal!.traffic!.latency!.typical!.categories.applicationQueue!.meanMs).toBeGreaterThan(0);
    if (id === "where-does-the-time-go") expect(metric(before, "app").cpu).toBe(100);
    else expect(metric(before, "app").cpu!).toBeLessThan(80);
  } else if (id === "diagnose-query-admission") {
    expect(metric(before, "db")).toMatchObject({cpu: 50, health: "healthy", connections: 10,
      database: {serving: 1, queued: 9, waiting: 0, sessionRefused: 0}});
    expect(metric(after, "db").database!.queued).toBe(0);
    expect(before.terminal!.traffic!.latency!.typical!.categories.connectionWait!.meanMs).toBe(0);
  } else if (id === "fit-a-request-in-memory") {
    expect(p95(before)).toBeNull(); expect(metric(before, "app").cpu).toBe(0);
    expect(metric(before, "app").vmMemory!.resources[0]!.allocationRejected!).toBeGreaterThan(0);
    expect(before.terminal!.traffic!.wholeRun!.completed).toBe(0);
    expect(after.terminal!.traffic!.wholeRun!.completed).toBe(600);
  } else {
    expect(metric(before, "queue").queueWork).toMatchObject({acknowledged: 7, ready: 88, inFlight: 1});
    expect(metric(after, "queue").queueWork).toMatchObject({acknowledged: 84, ready: 0, inFlight: 12});
    expect(after.terminal!.traffic!.wholeRun).toEqual(before.terminal!.traffic!.wholeRun);
  }
  const missing = structuredClone(rows[1]!); missing.terminalSnapshot = null;
  const absent = buildRunReport(missing);
  expect(absent.terminal).toBeNull(); expect(absent.challenge!.status).not.toBe("met");
  const incomplete = structuredClone(rows[1]!);
  if (id === "split-the-capacity-budget") incomplete.stages = (incomplete.stages as {name: string}[]).filter(s => s.name !== "CostEstimate");
  else delete (incomplete.terminalSnapshot as SimulationSnapshot).traffic!.wholeRun;
  const unknown = buildRunReport(incomplete);
  if (id === "split-the-capacity-budget") {
    expect(unknown.monthlyBudgets![0]!.remainingUsd).toBeUndefined();
    expect(unknown.challenge!.criteria.find(c => c.id === "budget")!.status).toBe("not-evaluated");
  } else expect(unknown.terminal!.traffic!.wholeRun).toBeUndefined();
  const html = await renderReports([...reports, unknown]);
  for (const [i, r] of reports.entries()) {
    const markup = html[i]!;
    expect(markup).toContain("Last measured second before the run stopped");
    expect(markup).toContain("Whole run");
    const latency = p95(r);
    expect(markup).toContain(latency === null ? "Unknown" : `${latency!.toFixed(3).replace(/\.?0+$/, "")} ms`);
    if (id === "split-the-capacity-budget") for (const label of ["Monthly resource price line items", "Remaining monthly budget", `$${Math.abs(r.monthlyBudgets![0]!.remainingUsd!).toFixed(2)}`]) expect(markup).toContain(label);
    if (id === "diagnose-query-admission") for (const label of ["Serving queries", "Queued queries", "Queries waiting for locks", "Refused session opens"]) expect(markup).toContain(label);
    if (["where-does-the-time-go", "waiting-with-spare-cpu"].includes(id)) for (const label of ["Application queue wait", "Downstream / dependency time", "Connection acquisition wait"]) expect(markup).toContain(label);
    if (id === "fit-a-request-in-memory") for (const label of ["Resident", "Limit", "Headroom", "Refused allocations"]) expect(markup).toContain(label);
    if (id === "diagnose-consumer-credit") expect(markup).toContain(`${metric(r, "queue").queueWork!.acknowledged} acknowledged`);
    console.info(JSON.stringify({lab: id, variant: i, status: r.challenge!.status, p95: latency, cost: cost(r) ?? "Unknown",
      remaining: r.monthlyBudgets, wholeRun: r.terminal!.traffic!.wholeRun,
      resources: r.terminal!.resources.map(m => ({id: m.id, cpu: m.cpu, health: m.health, database: m.database, queue: m.queueWork}))}));
  }
  if (id === "split-the-capacity-budget") expect(html.at(-1)).toMatch(/Remaining monthly budget<\/dt><dd[^>]*>Unknown/);
}, 120000);
