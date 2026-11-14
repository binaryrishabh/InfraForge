import { expect, test } from "bun:test";
import { resolve } from "node:path";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { learningMeasurement } from "@infraforge/contracts/learning";
import { learningContent } from "../learning/content";
import { validateLearningContent } from "../learning/validate";
import { checkLearningAuthoring } from "../learning/authoring";
import { deriveLessonProgress } from "../learning/progress";
import { buildRunReport } from "../reports/report";
import { preflight } from "../challenges/preflight";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const anchors = [
  {id: "choose-data-constraints", track: "data", kind: "reading", answer: "unproven",
    labs: ["move-reads-off-the-writer", "budget-app-database-sessions", "replicas-do-not-take-writes"],
    labels: ["p95", "Primary CPU core-us", "Replica CPU core-us", "Primary committed writes", "Stale reads", "Oldest missed commit age at read", "Connections", "Refused session opens", "Whole run: Failed", "Whole run: p95 bucket"],
    boundary: "no combined cache, pool and replica experiment"},
  {id: "initial-replicas-and-later-limits", track: "scaling", kind: "conceptual-exercise", answer: "initial",
    labs: ["budget-app-database-sessions", "retrying-a-full-pool"],
    labels: ["Connections", "Refused session opens", "p95", "Whole run: Completed", "Whole run: Failed", "Whole run: p95 bucket", "Admitted by backend (attempts)", "Refused by VM (attempts)", "Queued at VM (attempts)", "CPU"],
    boundary: "no combined scaling-and-retry experiment"},
];

test("advanced data and scaling reasoning is discoverable with bounded checks, existing prerequisites and no synthetic progress", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(() => checkLearningAuthoring(learningContent)).not.toThrow();
  for (const anchor of anchors) {
    const lesson = learningContent.lessons.find(l => l.id === anchor.id)!;
    expect(lesson).toMatchObject({trackId: anchor.track, kind: anchor.kind, level: "advanced", experiment: null});
    expect(lesson.check!.correctChoiceId).toBe(anchor.answer);
    expect(lesson.check!.choices.filter(c => c.id === anchor.answer)).toHaveLength(1);
    expect(lesson.check!.explanation.length).toBeGreaterThan(100);
    expect(lesson.limitations.join(" ")).toContain(anchor.boundary);
    expect(deriveLessonProgress("reader", [lesson], [])).toEqual([]);
    const module = learningContent.tracks.find(t => t.id === anchor.track)!.modules.find(m => m.id === lesson.moduleId)!;
    expect(module.lessonIds.filter(id => id === anchor.id)).toHaveLength(1);
    for (const id of lesson.prerequisites) expect(learningContent.lessons.find(l => l.id === id)?.availability).toBe("available");
    for (const id of anchor.labs) {
      const lab = learningContent.lessons.find(l => l.id === id)!;
      expect(lab.kind).toBe("executable-lab");
      expect(lesson.explanation.join(" ")).toContain(`${lab.title} (${id})`);
    }
    for (const label of anchor.labels) {
      expect(lesson.explanation.join(" ")).toContain(label); expect(learningMeasurement(label)).not.toBeNull();
    }
    for (const mutation of ["answer", "prerequisite", "experiment", "result"] as const) {
      const bad = structuredClone(learningContent), l = bad.lessons.find(l => l.id === anchor.id)!;
      if (mutation === "answer") l.check!.correctChoiceId = "missing";
      if (mutation === "prerequisite") l.prerequisites.push("missing");
      if (mutation === "experiment") Object.assign(l, {experiment: {challengeId: anchor.labs[0], prediction: null}});
      if (mutation === "result") l.explanation[0] = "The recorded run shows 999 requests per second.";
      expect(() => checkLearningAuthoring(bad)).toThrow();
    }
  }
  expect(learningContent.lessons.filter(l => l.trackId === "data" && l.level === "advanced").map(l => l.id)).toContain(anchors[0]!.id); // Later lanes add advanced data lessons.
  expect(learningContent.lessons.filter(l => l.trackId === "scaling" && l.level === "advanced").map(l => l.id).slice(0, 2)).toEqual(["retrying-a-full-pool", anchors[1]!.id]); // Later labs may follow these two.
});

for (const id of [...new Set(anchors.flatMap(a => a.labs))]) test(`${id}: controlled reports ground reasoning, retain tradeoffs and preserve missing evidence`, async () => {
  const d = definition(id), start = d.starter!, fixed = REFERENCE[id]!, restored = structuredClone(fixed), near = structuredClone(start);
  if (id === "move-reads-off-the-writer") {
    restored.resources.find(r => r.id === "db")!.databaseReadRouting!.policy = "primary-only";
    near.resources.find(r => r.id === "db")!.dbConcurrency = {version: 1, queuedQueries: 512};
  } else if (id === "budget-app-database-sessions") {
    restored.resources.find(r => r.id === "lb")!.autoscaling!.minReplicas = 12;
    near.resources.find(r => r.id === "app")!.skuId = "m5.2xlarge";
  } else if (id === "replicas-do-not-take-writes") {
    delete restored.resources.find(r => r.id === "db")!.skuId;
    Object.assign(near.resources.find(r => r.id === "db")!, {
      databaseReplication: {version: 1, enabled: true, replicationDelayMs: 1000, readPolicy: "primary"},
      databaseReadRouting: {version: 1, policy: "replica-preferred"},
    });
  } else {
    restored.resources.find(r => r.id === "lb")!.retry!.maxAttempts = 5;
    near.resources.find(r => r.id === "lb")!.retry!.maxAttempts = 4;
  }
  expect(restored).toEqual(start); // Exactly one supported setting changes in the reference.
  const rows = [start, fixed, near].map(design => {
    expect(preflight(d, design).valid).toBe(true);
    return attemptRow(d, design, answers(d, {"database-health": "healthy", "overall-health": "critical"}));
  });
  const reports = rows.map(row => buildRunReport(row)), [before, after, wrong] = reports;
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  const db = (i: number) => reports[i]!.terminal!.resources.find(r => r.id === "db")!;
  const traffic = (i: number) => reports[i]!.terminal!.traffic!;
  if (id === "move-reads-off-the-writer") {
    expect(traffic(0).latencyMs.p95!).toBeGreaterThan(1000); expect(traffic(1).latencyMs.p95!).toBeLessThan(15);
    expect(db(0).health).toBe("healthy"); expect(db(0).cpu).toBe(50);
    expect(db(1).database!.readRouting!.staleReads).toBeGreaterThan(0);
    expect(db(1).database!.readRouting!.members.primary.consumedCoreUs).toBeLessThan(db(0).database!.readRouting!.members.primary.consumedCoreUs);
    expect(db(1).databaseReplication!.primaryCommittedWrites!).toBeGreaterThan(0);
    expect(db(1).databaseReplication!.replicaCommittedWrites).toBe(0);
  } else if (id === "budget-app-database-sessions") {
    expect(db(0).connections).toBe(85); expect(db(1).connections).toBe(40);
    expect(db(0).database!.sessionRefused).toBe(433); expect(db(1).database!.sessionRefused).toBe(0);
    expect(traffic(1).latencyMs.p95).toBe(traffic(0).latencyMs.p95);
    expect(traffic(1).wholeRun!.failed).toBeLessThan(traffic(0).wholeRun!.failed);
    expect(traffic(1).wholeRun!.failed).toBeGreaterThan(0);
    expect(traffic(1).wholeRun!.percentiles.p95!.lowMs).toBeGreaterThan(traffic(0).wholeRun!.percentiles.p95!.highMs!);
    expect(after!.terminal!.pools!.lb).toMatchObject({currentReplicas: 4, minReplicas: 4, maxReplicas: 12, pending: null});
    expect(d.evaluationSeconds).toBeLessThan(10);
  } else if (id === "replicas-do-not-take-writes") {
    expect(wrong!.terminal!.traffic).toEqual(before!.terminal!.traffic);
    expect(db(2).health).toBe("healthy"); expect(db(2).cpu).toBe(50);
    expect(db(2).databaseReplication!.primaryCommittedWrites).toBe(traffic(2).wholeRun!.completed);
    expect(db(2).databaseReplication!.replicaCommittedWrites).toBe(0);
  } else {
    const lb = (i: number) => reports[i]!.terminal!.resources.find(r => r.id === "lb")!.lbAccounting!;
    expect(lb(1).acceptedByBackend + lb(1).rejectedByVm).toBeLessThan(lb(0).acceptedByBackend + lb(0).rejectedByVm);
    // Fewer retries leave the capacity-bound app completing the same rate. A later challenge version has its own seed, so allow one request/s of rounding.
    expect(Math.abs(traffic(1).completedRps! - traffic(0).completedRps!)).toBeLessThanOrEqual(1);
    expect(after!.terminal!.health).toBe("critical");
    expect(after!.terminal!.resources.find(r => r.id === "app")!.cpu).toBe(before!.terminal!.resources.find(r => r.id === "app")!.cpu);
  }
  // Actual report rendering, including the different whole-run percentile population.
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { ReportMeasurements } from "./src/features/reports/components/ReportMeasurements";
    import { DataDeliveryReadings } from "./src/features/live/DataDeliveryReadings";
    const reports = await Bun.stdin.json();
    console.log(JSON.stringify({reports: reports.map(report => renderToStaticMarkup(createElement(ReportMeasurements,{report,number:1}))),
      unknown: renderToStaticMarkup(createElement(DataDeliveryReadings,{type:"Database"}))}));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify(reports)); child.stdin.end();
  const [out, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({code, errors}).toEqual({code: 0, errors: ""});
  const html = JSON.parse(out) as {reports: string[]; unknown: string};
  expect(html.unknown).toContain("Unknown"); expect(html.unknown).not.toContain("<dd>0</dd>");
  for (const [i, report] of reports.entries()) {
    const markup = html.reports[i]!, whole = traffic(i).wholeRun!;
    expect(markup).toContain(`<dt class="text-xs text-ink-3">Failed</dt><dd>${whole.failed}</dd>`);
    expect(markup).toContain(`${whole.percentiles.p95!.highMs} ms (within 3%)`);
    if (id === "move-reads-off-the-writer") {
      expect(markup).toContain(`Stale reads: ${db(i).database!.readRouting!.staleReads}`);
      expect(markup).toContain(`${db(i).database!.readRouting!.members.primary.consumedCoreUs} core-us`);
    }
    const row = rows[i]!, saved = {...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)),
      terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot)), actions: structuredClone(row.actions)};
    expect(buildRunReport(saved).terminal).toEqual(report.terminal);
    console.info(JSON.stringify({lab: id, variant: ["starter", "reference", "near-miss"][i], status: report.challenge!.status,
      p95: traffic(i).latencyMs.p95, wholeRun: whole, database: id === "retrying-a-full-pool" ? undefined : db(i),
      lb: report.terminal!.resources.find(r => r.id === "lb")!.lbAccounting, pools: report.terminal!.pools}));
  }
  const missing = structuredClone(rows[1]!); missing.terminalSnapshot = null;
  expect(buildRunReport(missing).terminal).toBeNull(); expect(buildRunReport(missing).challenge!.status).not.toBe("met");
  const old = structuredClone(rows[1]!), snapshot = old.terminalSnapshot as SimulationSnapshot;
  delete snapshot.traffic!.wholeRun;
  expect(buildRunReport(old).terminal!.traffic!.wholeRun).toBeUndefined();
  if (id === "retrying-a-full-pool") expect(buildRunReport(old).challenge!.status).toBe("not-evaluated");
  // Old latency/session criteria do not score these contextual whole-run counters.
  else expect(buildRunReport(old).challenge!.status).toBe("met");
  if (id === "move-reads-off-the-writer") {
    delete snapshot.metrics.db!.database; delete snapshot.metrics.db!.databaseReplication;
    const report = buildRunReport(old);
    expect(db(1).database!.readRouting).toBeDefined();
    expect(report.terminal!.resources.find(r => r.id === "db")!.database).toBeUndefined();
    expect(report.challenge!.status).toBe("met"); // A p95 pass supplies no missing routing/freshness proof.
  }
  if (id === "budget-app-database-sessions") {
    const noReceipts = structuredClone(rows[1]!); noReceipts.actions = [];
    expect(buildRunReport(noReceipts).challenge!.status).toBe("not-evaluated");
    const absent = structuredClone(rows[1]!); delete (absent.terminalSnapshot as SimulationSnapshot).metrics.db!.connections;
    expect(buildRunReport(absent).challenge!.criteria.find(c => c.id === "connections")!.status).toBe("not-evaluated");
  }
}, 120000);
