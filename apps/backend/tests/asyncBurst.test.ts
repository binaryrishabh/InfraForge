import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { buildRegistry, challengeSeed, specHash } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { validateChallengeVersions } from "../challenges/validate";
import { buildRunReport } from "../reports/report";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const d = definition("parallel-jobs-for-a-burst"), start = d.starter!, fixed = REFERENCE[d.id]!;
const near = structuredClone(start); near.resources.find(r => r.id === "worker")!.asyncWorker!.prefetch = 64;
const designs = [start, fixed, near];
const rows = designs.map(design => attemptRow(d, design, answers(d, {"overall-health": "healthy"})));
const reports = rows.map(row => buildRunReport(row));
const raw = (row: typeof rows[number]) => row.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number};
const queue = (report: typeof reports[number]) => report.terminal!.resources.find(r => r.id === "queue")!;
const ageResult = (row: typeof rows[number]) => buildRunReport(row).challenge!.criteria.find(c => c.id === "age")!;

test("parallel burst: one supported setting uses spare CPU; leasing more jobs hides age but fails useful work", () => {
  expect(validateInfrastructureName(d.title)).toBeNull();
  expect(validateChallengeVersions([d], {[`${d.id}@1`]: specHash(d)})).toEqual([]);
  const restored = structuredClone(fixed); restored.resources.find(r => r.id === "worker")!.asyncWorker!.concurrency = 1;
  expect(restored).toEqual(start);
  const undoNear = structuredClone(near); undoNear.resources.find(r => r.id === "worker")!.asyncWorker!.prefetch = 8;
  expect(undoNear).toEqual(start);
  for (const design of designs) {
    expect(preflight(d, design).valid).toBe(true);
    expect(captureRunInputs(design, d.workload, challengeSeed(d)).workloadProfile).toEqual(captureRunInputs(start, d.workload, challengeSeed(d)).workloadProfile);
  }
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  expect(reports[1]!.challenge!.criteria.every(c => c.status === "met")).toBe(true);
  expect(queue(reports[0]!).queueWork).toMatchObject({originals: 360, acknowledged: 319, ready: 33, inFlight: 8, redeliveries: 0, expired: 0});
  expect(queue(reports[0]!).asyncQueue).toEqual({version: 2, readyDepth: 33, oldestReadyAgeSeconds: 5.496246});
  expect(queue(reports[1]!).queueWork).toMatchObject({originals: 360, acknowledged: 359, ready: 0, inFlight: 1, redeliveries: 0, expired: 0});
  expect(queue(reports[2]!).queueWork).toMatchObject({originals: 360, acknowledged: 319, ready: 0, inFlight: 41});
  expect(ageResult(rows[0]!).status).toBe("not-met");
  for (const index of [1, 2]) {
    expect(queue(reports[index]!).asyncQueue).toEqual({version: 2, readyDepth: 0, oldestReadyAgeSeconds: null});
    expect(ageResult(rows[index]!).status).toBe("met"); expect(ageResult(rows[index]!).detail).toContain("Unknown");
  }
  expect(reports[2]!.challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-met");
  expect(reports[0]!.terminal!.resources.find(r => r.id === "worker")!.cpu).toBeLessThan(51);
  expect(reports[1]!.terminal!.resources.find(r => r.id === "worker")!.cpu).toBe(75);
  for (const [i, report] of reports.entries()) {
    expect(report.terminal!.traffic).toEqual(reports[0]!.terminal!.traffic);
    expect(report.challenge!.predictions.every(p => p.actual !== null)).toBe(true);
    expect(queue(report).asyncQueue!.readyDepth).toBe(raw(rows[i]!).metrics.queue!.asyncQueue!.readyDepth);
    expect(queue(report).asyncQueue!.oldestReadyAgeSeconds).toBe(raw(rows[i]!).metrics.queue!.asyncQueue!.oldestReadyAgeSeconds);
    console.info(JSON.stringify({lab: d.id, variant: ["starter", "reference", "near-miss"][i], queue: queue(report), workerCpu: report.terminal!.resources.find(r => r.id === "worker")!.cpu, wholeRun: report.terminal!.traffic!.wholeRun}));
  }
});

test("queue ready-age refuses absent, stale, mismatched, inconsistent and malformed evidence; boundary is inclusive", () => {
  const mutations: Array<(row: typeof rows[number]) => void> = [
    row => { row.terminalSnapshot = null; },
    row => { raw(row).simulatedSeconds--; },
    row => { raw(row).metricsTopologyRevision++; },
    row => { delete raw(row).metrics.queue; },
    row => { delete raw(row).metrics.queue!.asyncQueue; },
    row => { delete raw(row).metrics.queue!.queueWork; },
    row => { raw(row).metrics.queue!.queueWork!.throughSecond--; },
    row => { raw(row).metrics.queue!.asyncQueue!.readyDepth = null; },
    row => { raw(row).metrics.queue!.asyncQueue!.readyDepth = 1; },
    row => { raw(row).metrics.queue!.asyncQueue!.oldestReadyAgeSeconds = 0; },
    row => { const input = row.runInputs as {resources: typeof start.resources}; input.resources.find(r => r.id === "queue")!.asyncQueue!.enabled = false; },
    row => { const input = row.runInputs as {resources: typeof start.resources}; input.resources = input.resources.filter(r => r.id !== "queue"); },
    row => { row.runInputs = null; row.liveTopology = null; },
  ];
  for (const mutation of mutations) {
    const row = structuredClone(rows[1]!); mutation(row);
    expect(ageResult(row).status).toBe("not-evaluated");
    expect(buildRunReport(row).challenge!.status).not.toBe("met");
  }
  for (const key of ["readyDepth", "oldestReadyAgeSeconds"] as const) for (const bad of [-1, NaN, Infinity, "unknown", undefined]) {
    const row = structuredClone(rows[0]!);
    (raw(row).metrics.queue!.asyncQueue as unknown as Record<string, unknown>)[key] = bad;
    expect(ageResult(row).status).toBe("not-evaluated");
  }
  for (const age of [null, 141]) {
    const row = structuredClone(rows[0]!); raw(row).metrics.queue!.asyncQueue!.oldestReadyAgeSeconds = age;
    expect(ageResult(row).status).toBe("not-evaluated");
  }
  const active = structuredClone(rows[1]!); active.runtimeActive = true; active.status = "running"; active.terminalSnapshot = null;
  expect(ageResult(active).status).toBe("pending");
  const wrongHash = structuredClone(rows[1]!); wrongHash.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(wrongHash).challenge!.status).toBe("unavailable");
  // Re-evaluate a real nonempty observation with an exactly equal authored limit.
  const boundary = structuredClone(d); const criterion = boundary.criteria.find(c => c.kind === "queue-ready-age")!;
  if (criterion.kind !== "queue-ready-age") throw Error("missing age criterion");
  criterion.maxAgeSeconds = queue(reports[0]!).asyncQueue!.oldestReadyAgeSeconds!;
  const row = structuredClone(rows[0]!); row.challengeSpecHash = specHash(boundary);
  expect(buildRunReport(row, buildRegistry([boundary])).challenge!.criteria.find(c => c.id === "age")!.status).toBe("met");
  for (const patch of [{maxAgeSeconds: -1}, {maxAgeSeconds: Infinity}, {resourceId: "absent"}]) {
    const edited = structuredClone(d); Object.assign(edited.criteria.find(c => c.kind === "queue-ready-age")!, patch);
    expect(validateChallengeVersions([edited], {[`${d.id}@1`]: specHash(edited)}).some(p => p.includes("queue-ready-age"))).toBe(true);
  }
  const wrongEngine = {...d, engine: undefined};
  expect(validateChallengeVersions([wrongEngine], {[`${d.id}@1`]: specHash(wrongEngine)}).some(p => p.includes("queue-ready-age"))).toBe(true);
});

test("parallel burst: browser bundle and server replay agree every second, including ready age and broker ownership", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/async-burst-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const [index, design] of designs.entries()) {
      const captured = captureRunInputs(design, d.workload, challengeSeed(d)), input = readRunInputs(JSON.parse(JSON.stringify(captured)));
      expect(input).toEqual(captured);
      const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds, buildModel2Contract);
      for (let second = 1; second <= d.evaluationSeconds; second++) {
        browser.advance(); server.advance();
        expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
        const q = server.evidence().asynchronous.brokers.find(q => q.id === "queue")!, work = server.view().metrics.queue!.queueWork!;
        expect(work).toMatchObject({throughSecond: second, originals: q.accepted, ready: q.ready, inFlight: q.inFlight, acknowledged: q.acknowledged});
        if (second === 120) expect(work.acknowledged).toBeGreaterThanOrEqual(239);
      }
      expect(server.view().metrics.queue!.queueWork).toEqual(queue(reports[index]!).queueWork);
      const observation = server.view().metrics.queue!.asyncQueue!;
      expect({version: observation.version, readyDepth: observation.readyDepth, oldestReadyAgeSeconds: observation.oldestReadyAgeSeconds}).toEqual(queue(reports[index]!).asyncQueue!);
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 120000);

test("parallel burst saved report renders real age, generic requirements and Unknown; supported control survives undo and reload", async () => {
  const legacy = structuredClone(rows[1]!); delete raw(legacy).metrics.queue!.asyncQueue;
  const unknown = structuredClone(rows[0]!); raw(unknown).metrics.queue!.asyncQueue!.oldestReadyAgeSeconds = null;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import {createElement as h} from "react";
    import {renderToStaticMarkup as render} from "react-dom/server";
    import {MemoryRouter} from "react-router-dom";
    import {ChallengeDebrief} from "./src/features/challenges/components/ChallengeDebrief";
    import {RequirementList} from "./src/features/challenges/components/RequirementList";
    import {ReportMeasurements} from "./src/features/reports/components/ReportMeasurements";
    import {Inspector} from "./src/features/canvas/components/inspector/Inspector";
    import {updateResource} from "./src/features/canvas/actions";
    import {useCanvasStore} from "./src/features/canvas/store/canvasStore";
    import {undo,redo} from "./src/features/canvas/history";
    const {reports,start,patch,criteria,checks}=await Bun.stdin.json(),get=useCanvasStore.getState;
    get().loadLayout(start.resources,start.connectionLines,"parallel-burst","Parallel burst");
    const inspector=render(h(Inspector,{resource:get().resources.find(r=>r.id==="worker")}));
    updateResource("worker",patch); const changed=structuredClone(get().resources);
    undo(); const undone=structuredClone(get().resources); redo(); const redone=structuredClone(get().resources);
    get().loadLayout(JSON.parse(JSON.stringify(redone)),start.connectionLines,"parallel-burst","Parallel burst");
    console.log(JSON.stringify({inspector,changed,undone,redone,reloaded:get().resources,
      requirements:render(h(RequirementList,{criteria,checks})),reports:reports.map(report=>({
        debrief:render(h(MemoryRouter,null,h(ChallengeDebrief,{evaluation:report.challenge,brief:null}))),
        measurements:render(h(ReportMeasurements,{report,number:1}))}))}));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  const all = [...reports, buildRunReport(legacy), buildRunReport(unknown)];
  child.stdin.write(JSON.stringify({reports: all, start, patch: {asyncWorker: fixed.resources.find(r => r.id === "worker")!.asyncWorker}, criteria: d.criteria, checks: preflight(d, start).checks})); child.stdin.end();
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (await child.exited !== 0) throw Error(stderr);
  const result = JSON.parse(stdout) as {inspector: string; changed: unknown; undone: unknown; redone: unknown; reloaded: unknown; requirements: string; reports: Array<{debrief: string; measurements: string}>};
  expect(result.inspector).toContain("Jobs in parallel"); expect(result.inspector).toContain("Prefetch credit (leased jobs)");
  expect(result.changed).toEqual(fixed.resources); expect(result.undone).toEqual(start.resources);
  expect(result.redone).toEqual(fixed.resources); expect(result.reloaded).toEqual(fixed.resources);
  for (const c of d.criteria) expect(result.requirements).toContain(c.label);
  for (const [index, report] of all.entries()) for (const c of report.challenge!.criteria) expect(result.reports[index]!.debrief).toContain(c.detail);
  expect(result.reports[0]!.measurements).toContain("Oldest ready message age (seconds)</dt><dd>5.496246");
  for (const index of [1, 2, 3, 4]) expect(result.reports[index]!.measurements).toContain("Oldest ready message age (seconds)</dt><dd>Unknown");
  expect(result.reports[2]!.debrief).toContain("41 outstanding (0 ready + 41 in flight");
  for (const index of [3, 4]) expect(all[index]!.challenge!.criteria.find(c => c.id === "age")!.status).toBe("not-evaluated");
}, 120000);
