import { expect, test } from "bun:test";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { learningMeasurement } from "@infraforge/contracts/learning";
import { learningContent } from "../learning/content";
import { validateLearningContent } from "../learning/validate";
import { checkLearningAuthoring } from "../learning/authoring";
import { buildRunReport } from "../reports/report";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const anchors = [
  {id: "parallelism-and-shared-capacity", labs: ["parallel-jobs-for-a-burst", "keep-up-with-the-queue"], labels: ["CPU", "Acknowledged messages", "Ready messages", "Queue: in flight"], answer: "waiting", boundary: "downstream saturation is not demonstrated"},
  {id: "duplicate-effects-and-ownership", labs: ["leave-time-to-acknowledge"], labels: ["Queue: originals", "Queue: deliveries", "Queue: completed object effects", "Queue: acknowledged", "Queue: redeliveries"], answer: "repeat", boundary: "Conceptual only for operation identity"},
  {id: "retry-ownership-across-layers", labs: ["choose-a-retry-mitigation"], labels: ["Admitted by backend (attempts)", "Queued at VM (attempts)", "p95", "Whole run: Completed", "Whole run: Failed"], answer: "six", boundary: "Conceptual only for layered retry multiplication"},
  {id: "health-checks-and-failure-scope", labs: ["check-the-missing-server", "find-the-denying-rule"], labels: ["Whole run: Completed", "Whole run: Failed", "Overall health", "Resolved targets:", "Denied by rule", "Backend deliveries"], answer: "scope", boundary: "not an executed health-check intervention on the firewall lab"},
];

test("advanced reasoning is discoverable once, with real prerequisites, audited lab anchors and bounded conceptual checks", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(() => checkLearningAuthoring(learningContent)).not.toThrow();
  for (const anchor of anchors) {
    const lesson = learningContent.lessons.find(l => l.id === anchor.id)!;
    expect(lesson.level).toBe("advanced"); expect(lesson.experiment).toBeNull();
    expect(lesson.kind).toBe(anchor.id.startsWith("parallelism") || anchor.id.startsWith("retry-") ? "reading" : "conceptual-exercise");
    expect(lesson.check!.correctChoiceId).toBe(anchor.answer);
    expect(lesson.check!.choices.filter(c => c.id === anchor.answer)).toHaveLength(1);
    expect(lesson.check!.explanation.length).toBeGreaterThan(70);
    expect(lesson.limitations.join(" ")).toContain(anchor.boundary);
    expect(lesson.prerequisites.length).toBeGreaterThan(1);
    for (const prerequisite of lesson.prerequisites) expect(learningContent.lessons.some(l => l.id === prerequisite && l.availability === "available")).toBe(true);
    const module = learningContent.tracks.find(t => t.id === lesson.trackId)!.modules.find(m => m.id === lesson.moduleId)!;
    expect(module.lessonIds.filter(id => id === lesson.id)).toHaveLength(1);
    for (const labId of anchor.labs) {
      expect(lesson.explanation.join(" ")).toContain(labId);
      expect(learningContent.lessons.find(l => l.id === labId)!.kind).toBe("executable-lab");
    }
    for (const label of anchor.labels) { expect(lesson.explanation.join(" ")).toContain(label); expect(learningMeasurement(label)).not.toBeNull(); }
  }
  for (const track of ["async", "failures"]) {
    const counts = ["beginner", "intermediate", "advanced"].map(level => [level, ...["reading", "conceptual-exercise", "executable-lab"].map(kind => learningContent.lessons.filter(l => l.trackId === track && l.level === level && l.kind === kind).length)]);
    expect(counts.at(-1)).toEqual(["advanced", 1, 1, 1]);
    console.info(JSON.stringify({track, columns: ["level", "reading", "conceptual-exercise", "executable-lab"], counts}));
  }
});

test("reasoning checks cannot omit their answer or invent a prerequisite or an experiment", () => {
  for (const anchor of anchors) for (const mutation of ["answer", "prerequisite", "experiment"] as const) {
    const content = structuredClone(learningContent), lesson = content.lessons.find(l => l.id === anchor.id)!;
    if (mutation === "answer") lesson.check!.correctChoiceId = "unavailable-answer";
    if (mutation === "prerequisite") lesson.prerequisites.push("nonexistent-prerequisite");
    if (mutation === "experiment") Object.assign(lesson, {experiment: {challengeId: "nonexistent-lab", prediction: null}});
    expect(validateLearningContent(content).length).toBeGreaterThan(0);
  }
});

// Re-run existing mechanisms through the real report path. These do not add
// causal claims for the explicitly hypothetical cross-layer extensions.
for (const id of [...new Set(anchors.flatMap(a => a.labs))]) test(`${id}: retained reports ground advanced reasoning and refuse absent measurements`, () => {
  const d = definition(id), fixed = REFERENCE[id]!;
  const rows = [d.starter!, fixed].map(design => attemptRow(d, design, answers(d, {"overall-health": "healthy", "database-admission": "policy-denied", "security-clean": "yes", "busiest-type": "Virtual Machine"})));
  const reports = rows.map(row => buildRunReport(row)), [before, after] = reports;
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met"]);
  const queue = (index: number) => reports[index]!.terminal!.resources.find(r => r.id === "queue")!.queueWork!;
  if (id === "parallel-jobs-for-a-burst") {
    expect(queue(0)).toMatchObject({acknowledged: 319, ready: 33, inFlight: 8});
    expect(queue(1)).toMatchObject({acknowledged: 359, ready: 0, inFlight: 1});
    const near = structuredClone(d.starter!); near.resources.find(r => r.id === "worker")!.asyncWorker!.prefetch = 64;
    const r = buildRunReport(attemptRow(d, near, answers(d, {"overall-health": "healthy"})));
    expect(r.challenge!.status).toBe("not-met");
    expect(r.terminal!.resources.find(r => r.id === "queue")!.queueWork).toMatchObject({acknowledged: 319, ready: 0, inFlight: 41});
    expect(r.terminal!.resources.find(r => r.id === "queue")!.asyncQueue!.oldestReadyAgeSeconds).toBeNull();
  } else if (id === "keep-up-with-the-queue") {
    expect(queue(0).acknowledged).toBe(46); expect(queue(1).acknowledged).toBe(96);
  } else if (id === "leave-time-to-acknowledge") {
    expect(queue(0)).toMatchObject({originals: 3, effects: 7, acknowledged: 0, redeliveries: 4});
    expect(queue(1)).toMatchObject({originals: 3, effects: 3, acknowledged: 3, redeliveries: 0});
  } else if (id === "check-the-missing-server") {
    expect(before!.terminal!.traffic!.wholeRun).toMatchObject({completed: 800, failed: 400});
    expect(after!.terminal!.traffic!.wholeRun).toMatchObject({completed: 1150, failed: 50});
    expect(before!.terminal!.health).toBe("healthy"); expect(after!.terminal!.health).toBe("healthy");
  } else if (id === "find-the-denying-rule") {
    expect(before!.terminal!.resources.find(r => r.id === "db")!.security!.edges[0]).toMatchObject({backendDeliveries: 0, denied: 2});
    expect(before!.terminal!.traffic!.wholeRun).toMatchObject({completed: 0, failed: 32});
    expect(after!.terminal!.traffic!.wholeRun).toMatchObject({completed: 32, failed: 0});
  } else {
    const lb = (index: number) => reports[index]!.terminal!.resources.find(r => r.id === "lb")!.lbAccounting!;
    expect(lb(1).acceptedByBackend).toBeLessThan(lb(0).acceptedByBackend);
    expect(lb(1).queuedAtVm).toBeLessThan(lb(0).queuedAtVm);
    expect(after!.terminal!.traffic!.latencyMs.p95!).toBeLessThan(before!.terminal!.traffic!.latencyMs.p95!);
    expect(after!.terminal!.traffic!.wholeRun!.completed).toBeLessThan(before!.terminal!.traffic!.wholeRun!.completed);
    expect(after!.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(before!.terminal!.traffic!.wholeRun!.failed);
  }
  for (const [index, report] of reports.entries()) console.info(JSON.stringify({lab: id, variant: index ? "reference" : "starter", resources: report.terminal!.resources, wholeRun: report.terminal!.traffic!.wholeRun, p95: report.terminal!.traffic!.latencyMs.p95}));
  const missing = structuredClone(rows[1]!); missing.terminalSnapshot = null;
  expect(buildRunReport(missing).terminal).toBeNull(); expect(buildRunReport(missing).challenge!.status).not.toBe("met");
  const old = structuredClone(rows[1]!); const snapshot = old.terminalSnapshot as SimulationSnapshot;
  if (id.includes("queue") || id.includes("acknowledge") || id.includes("burst")) {
    delete snapshot.metrics.queue!.queueWork;
    expect(buildRunReport(old).terminal!.resources.find(r => r.id === "queue")!.queueWork).toBeUndefined();
  } else { delete snapshot.traffic!.wholeRun; expect(buildRunReport(old).terminal!.traffic!.wholeRun).toBeUndefined(); }
  // Whole-run outcomes are context rather than a scored criterion in the
  // retry and firewall labs; their absence must not be treated as zero.
  if (id !== "choose-a-retry-mitigation" && id !== "find-the-denying-rule") expect(buildRunReport(old).challenge!.status).not.toBe("met");
}, 120000);
