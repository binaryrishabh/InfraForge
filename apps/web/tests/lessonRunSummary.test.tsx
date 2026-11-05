import { beforeAll, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import type { LearningLessonDetail } from "@infraforge/contracts/learning";
import type { RunReport } from "@infraforge/contracts/reports";
import { LessonRunSummary } from "../src/features/learning/LessonRunSummary";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";
import { reading } from "./learningFixtures";

let source: RunReport, improved: RunReport, detail: LearningLessonDetail;
beforeAll(async () => {
  // Outcomes come from the production Model 2 engine and report builder.
  const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("../../backend/tests/fixtures/learningLoop.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  const proof = JSON.parse(stdout);
  source = proof.sourceReport; improved = proof.improvedReport; detail = proof.detail;
}, 180000);
const render = (report: RunReport, lesson = detail.lesson) => renderToStaticMarkup(<LessonRunSummary report={report} lesson={lesson} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("summary shows only this server report's requirement statuses, named measurements and authored limits", () => {
  for (const report of [source, improved]) {
    const html = text(render(report)), result = report.challenge!;
    expect(html).toContain("What did my run show?");
    expect(html).toContain(`Run ${report.run.id} · challenge version ${result.version}`);
    expect(html).toContain(`${result.metCount} of ${result.total} met`);
    for (const criterion of result.criteria) expect(html).toContain(criterion.label);
    for (const limit of detail.lesson.limitations) expect(html.replaceAll("&#x27;", "'")).toContain(limit);
    const rows = lessonRunMeasurements(report, detail.lesson.experiment!.evidenceToInspect!);
    expect(rows.find(row => row.label === "p95")?.value).toBe(`${report.terminal!.traffic!.latencyMs.p95} ms`);
    expect(rows.find(row => row.label === "Completed requests/s")?.value).toBe(String(report.terminal!.traffic!.completedRps));
    for (const resource of report.terminal!.resources) expect(rows.find(row => row.label === "CPU")?.value).toContain(`${resource.id}: ${resource.cpu} %`);
    expect(html).not.toContain("Monthly estimate"); // It was not named by this lesson.
    expect(html).not.toContain("caused");
  }
  expect(text(render(source))).toContain("Not met");
  expect(text(render(improved))).toContain("Requirements: Met");
});

test("missing terminal, traffic, optional measurements and unknown labels stay Unknown; checkpoints never fill them", () => {
  const missing = structuredClone(source);
  missing.checkpoint = source.terminal;
  missing.terminal = null;
  const html = text(render(missing));
  expect(html).toContain("Exact terminal snapshot: Unknown");
  expect(html).toContain("p95 Unknown");
  expect(html).toContain("Completed requests/s Unknown");
  expect(html).toContain("app: Unknown");
  expect(html).not.toContain(`${source.terminal!.traffic!.latencyMs.p95} ms`);
  const partial = structuredClone(source);
  partial.terminal!.traffic!.latencyMs.p95 = null;
  partial.terminal!.traffic!.completedRps = 0;
  delete partial.terminal!.resources.find(r => r.id === "app")!.cpu;
  const rows = lessonRunMeasurements(partial, ["p95; Completed requests/s; CPU; Queue: acknowledged; Cache hits"]);
  expect(rows.find(row => row.label === "p95")?.value).toBe("Unknown");
  expect(rows.find(row => row.label === "Completed requests/s")?.value).toBe("0");
  expect(rows.find(row => row.label === "CPU")?.value).toContain("app: Unknown");
  expect(rows.find(row => row.label === "Queue: acknowledged")?.value).toBe("Unknown");
  expect(rows.find(row => row.label === "Cache hits")?.value).toBe("Unknown");
});

test("whole-run and last-second values remain separate and unavailable verdicts never become met", () => {
  const report = structuredClone(source);
  const w = report.terminal!.traffic!.wholeRun!;
  const rows = lessonRunMeasurements(report, ["Whole run: Completed; Whole run: Failed; Whole run: In-flight; Whole run: p95 bucket; p95"]);
  expect(rows[0]!.value).toBe(String(w.completed));
  expect(rows[1]!.value).toBe(String(w.failed));
  expect(rows[2]!.value).toBe(String(w.inFlight));
  expect(rows[3]!.value).toBe(w.percentiles.p95 ? `${w.percentiles.p95.lowMs}–${w.percentiles.p95.highMs} ms` : "Unknown");
  for (const status of ["in-progress", "not-evaluated", "unavailable"] as const) {
    report.challenge!.status = status;
    const html = text(render(report));
    expect(html).not.toContain("Requirements: Met");
    expect(html).toContain(status === "in-progress" ? "In progress" : status === "unavailable" ? "Not judged" : "Not evaluated");
  }
});

test("a non-lab or report for another challenge cannot render a lesson summary", () => {
  expect(render(source, reading)).toBe("");
  const wrong = { ...source, challenge: { ...source.challenge!, challengeId: "another-lab" } };
  expect(render(wrong)).toBe("");
});

test("optional queue, security and subscription rows project recorded counters without merging populations", () => {
  // Presentation-only field mutations: no engine behavior or causal claim is
  // established by these values. The real engine/report journey is above.
  const report = structuredClone(source);
  report.terminal!.resources.push({ id: "queue", queueWork: { version: 1, throughSecond: 12,
    originals: 9, deliveries: 11, effects: 8, acknowledged: 5, ready: 2, inFlight: 1, scheduled: 1,
    redeliveries: 2, deadLettered: 0, discarded: 0, expired: 0 } });
  const queue = lessonRunMeasurements(report, ["Queue: originals; Queue: deliveries; Queue: completed object effects; Queue: acknowledged; Queue: redeliveries"]);
  expect(queue.map(row => row.value)).toEqual(["queue: 9", "queue: 11", "queue: 8", "queue: 5", "queue: 2"]);
  const db = report.terminal!.resources.find(resource => resource.id === "db")!;
  const security = { version: 1, evidence: "complete", edges: [{ path: "app-db", source: "app", target: "db",
    denied: 4, noListener: 0, backendDeliveries: 2, policyDenied: { "fw:ingress:quarantine-db": 4 } }] };
  Object.assign(db, { security });
  const denied = lessonRunMeasurements(report, ["Denied admissions; No listener; Backend deliveries; Denied by rule"]);
  expect(denied.map(row => row.value)).toEqual(["db / app-db: 4", "db / app-db: 0", "db / app-db: 2", "db / app-db / fw:ingress:quarantine-db: 4"]);
  Object.assign(db, { security: { ...security, evidence: "omitted", edges: [] } });
  expect(lessonRunMeasurements(report, ["Denied admissions"])[0]!.value).toBe("db: Unknown");
  const bus = { id: "bus", eventBus: { accepted: 10, subscriptions: [
    { id: "first", delivered: 6, retried: 3, deliveryAccounting: { failedAttempts: 3, exhausted: 1 } },
    { id: "second", delivered: 10, retried: 0 },
  ] } };
  report.terminal!.resources.push({ id: bus.id });
  Object.assign(report.terminal!.resources.at(-1)!, bus);
  const subscriptions = lessonRunMeasurements(report, ["Published events; Delivered to queue; Failed attempts; Exhausted deliveries"]);
  expect(subscriptions[0]!.value).toBe("bus: 10");
  expect(subscriptions[1]!.value).toBe("bus / first: 6; bus / second: 10");
  expect(subscriptions[2]!.value).toBe("bus / first: 3; bus / second: Unknown");
  expect(subscriptions[3]!.value).toBe("bus / first: 1; bus / second: Unknown");
  expect(lessonRunMeasurements(report, ["Monthly estimate (CostEstimate gate)"])[0]!.value).toBe(
    `${report.stages.findLast(stage => stage.monthlyEstimateUsd !== undefined)!.monthlyEstimateUsd} USD`);
});
