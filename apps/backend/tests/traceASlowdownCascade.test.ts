import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { challengeSeed, specHash } from "../challenges/registry";
import { buildRunReport } from "../reports/report";
import { readFileSync } from "node:fs";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { reviewDesignChanges } from "../challenges/designChanges";
import { preflight } from "../challenges/preflight";
import { recordedScenario } from "../challenges/scenario";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const ID = "trace-a-slowdown-cascade";
test("trace-a-slowdown-cascade: reshaped starter already shares fills across a working set", () => {
  const d = definition(ID);
  expect(d.starter!.resources.find(r => r.id === "cache")!.cachePolicy).toMatchObject({ singleFlight: true, capacityEntries: 1, ttlSeconds: 60 });
  expect(d.starter!.resources.find(r => r.id === "db")!.dataKeyspace).toMatchObject({ count: 16, accessPattern: "uniform" });
});
const edit = (fn: (s: ChallengeStarter) => void) => { const s = structuredClone(definition(ID).starter!); fn(s); return s; };
function variants() {
  const d = definition(ID), starter = d.starter!;
  const near = edit(s => {
    const cache = s.resources.find(r => r.id === "cache")!;
    cache.cachePolicy = { ...cache.cachePolicy, version: 2, capacityEntries: 12 };
  });
  const noRetry = edit(s => { s.resources.find(r => r.id === "lb")!.retry!.maxAttempts = 1; });
  return { d, designs: [starter, REFERENCE[ID]!, near, noRetry] };
}

test("trace-a-slowdown-cascade: capacity preserves reuse with single-flight already on; near miss fails with margin; reports round-trip", () => {
  const { d, designs } = variants();
  expect(validateInfrastructureName(d.title)).toBeNull();
  expect(specHash(d)).toBe(/"trace-a-slowdown-cascade@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!);
  for (const design of designs) expect(preflight(d, design).errors).toEqual([]);
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const i of [1, 2, 3]) expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({ classification: "one-change", count: 1 });
  const rows = designs.map(s => attemptRow(d, s, answers(d, { health: "healthy", database: "healthy", where: "app" }))), reports = rows.map(r => buildRunReport(r));
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met", "not-met"]);
  expect(reports.map(r => r.terminal!.traffic!.wholeRun!.failed)).toEqual([309, 0, 151, 365]);
  expect(reports.map(r => r.terminal!.traffic!.wholeRun!.completed)).toEqual([1690, 2000, 1848, 1634]);
  const callerRule = d.criteria.find(c => c.kind === "caller-outcomes")!;
  if (callerRule.kind !== "caller-outcomes") throw Error("Missing caller rule");
  expect(2000 - callerRule.minCompleted).toBeGreaterThanOrEqual(20);
  expect(callerRule.maxUnsuccessful).toBeGreaterThanOrEqual(20);
  expect(callerRule.minCompleted - 1848).toBeGreaterThanOrEqual(100);
  expect(151 - callerRule.maxUnsuccessful).toBeGreaterThanOrEqual(100);
  expect(reports.map(r => r.challenge!.predictions.find(x => x.id === "where")!.outcome)).toEqual(["different", "matched", "matched", "different"]);
  expect(reports.map(r => r.challenge!.predictions.find(x => x.id === "where")!.actual)).toEqual(["db", "app", "app", "db"]);
  const lb = reports[0]!.terminal!.resources.find(r => r.id === "lb")!;
  expect(lb.lbAccounting!.timedOutDownstream).toBeGreaterThan(300);
  expect(lb.lbAccounting!.rejectedAtLb).toBe(0);
  expect(reports.map(r => r.terminal!.resources.find(x => x.id === "cache")!.cache!.evictions)).toEqual([1471, 0, 397, 1446]);
  expect(reports.map(r => r.terminal!.resources.find(x => x.id === "cache")!.cache!.expirations)).toEqual([0, 0, 0, 0]);
  const helpers = reports.map(r => r.terminal!.resources.find(x => x.id === "app")!.applicationHelpers!.helpers[0]!);
  expect(helpers[0]!.coalescedWaiters).toBeGreaterThan(100);
  expect(helpers[0]!.databaseFetches).toBe(1492);
  expect(helpers[1]!.databaseFetches).toBe(16);
  expect(reports[1]!.terminal!.resources.find(x => x.id === "lb")!.lbAccounting!.timedOutDownstream).toBe(0);
  for (const [i, row] of rows.entries()) {
    const saved = { ...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot)) };
    expect(buildRunReport(saved).terminal).toEqual(reports[i]!.terminal);
    expect(buildRunReport(saved).challenge).toEqual(reports[i]!.challenge);
  }
}, 60000);

test("trace-a-slowdown-cascade: browser-target bundle and default server replay agree every second for all variants", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/slowdown-cascade-${process.pid}.ts`), out = entry.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entry), { recursive: true });
  try {
    await writeFile(entry, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entry, "--target=browser", "--outfile", out], { stdout: "ignore", stderr: "pipe" });
    const diagnostic = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostic);
    const module = await import(pathToFileURL(out).href);
    const browserRun: typeof createModel2Run = module.createModel2Run, browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs;
    const { d, designs } = variants();
    for (const design of designs) {
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(design, d.workload, challengeSeed(d)))));
      
      expect(browserContract(input, 10)).toEqual(buildContractFromRunInputs(input, 10));
      const browser = browserRun(input, 10), server = createModel2Engine(input, 10), plan = recordedScenario(d, input)!;
      for (let second = 1; second <= 10; second++) {
        browser.advance(); server.advance();
        for (const step of plan.steps.filter(s => s.atSecond === second)) {
          const action = { kind: "intervention" as const, parameters: step.request };
          const a = browser.apply(action), b = server.apply(action);
          expect(a).toEqual(b); expect(a.outcome.intervention).toEqual(plan.receipts[0]!);
          while (browser.catchingUp) browser.catchUp(10);
          while (server.catchingUp) server.catchUp(10);
        }
        expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
        if (second === 4 && design === designs[0]) {
          const metrics = server.view().metrics, db = server.evidence().data.databases.find(x => x.id === "db")!;
          expect(metrics.cache!.cache!.expirations).toBe(0);
          expect(metrics.cache!.cache!.evictions).toBeGreaterThan(300);
          expect(metrics.app!.applicationHelpers!.helpers[0]!.coalescedWaiters).toBeGreaterThan(0);
          expect(metrics.db!.database!.serving).toBe(10); expect(metrics.db!.database!.queued).toBe(0);
          expect(db.cpu.contended).toBe(true); expect(db.reasons["statement-timeout"]).toBeGreaterThan(0);
          expect(metrics.lb!.lbAccounting!.timedOutDownstream).toBeGreaterThan(100);
        }
      }
      expect(server.view().traffic.wholeRun!.failed).toBe([309, 0, 151, 365][designs.indexOf(design)]!);
    }
    console.info("slowdown-cascade-browser-target-server-parity", JSON.stringify({ cases: 4, secondsPerCase: 10 }));
  } finally { for (const path of [entry, out]) if (await Bun.file(path).exists()) await unlink(path); }
}, 240000);

test("trace-a-slowdown-cascade: lesson requires ordered attribution and explains passing alternatives", async () => {
  const { d } = variants();
  const { findLearningLesson } = await import("../learning/registry");
  const { learningContent } = await import("../learning/content"), { validateLearningContent } = await import("../learning/validate");
  const { checkLearningAuthoring } = await import("../learning/authoring");
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(checkLearningAuthoring(learningContent).labs).toBeGreaterThan(0);
  const lesson = findLearningLesson(ID)!, text = [d.summary, ...d.debrief, ...lesson.problem, ...lesson.explanation].join(" ");
  expect(lesson.explanation[0]).toContain("balancer counters first");
  expect(lesson.explanation[1]).toContain("database serving queries with the scenario's reduced CPU budget");
  expect(text).toContain("Single-flight is already on");
  expect(text).toContain("fourteen and fifteen also pass");
  expect(text).toContain("keyspace to one also passes");
  expect(text).not.toMatch(/long after it ends|keep failing until the end|longer TTL also meets/);
});

test("trace-a-slowdown-cascade: absent or stale caller evidence and missing scenario receipts never pass", () => {
  const { d, designs } = variants(), row = attemptRow(d, designs[1]!, answers(d, { health: "healthy", database: "healthy", where: "app" }));
  const missing = structuredClone(row.terminalSnapshot) as any;
  delete missing.traffic.wholeRun;
  expect(buildRunReport({ ...row, terminalSnapshot: missing }).challenge!.criteria.find(c => c.id === "callers")!.status).toBe("not-evaluated");
  const stale = structuredClone(row.terminalSnapshot) as any;
  stale.traffic.wholeRun.throughSecond = 9;
  expect(buildRunReport({ ...row, terminalSnapshot: stale }).challenge!.criteria.find(c => c.id === "callers")!.status).toBe("not-evaluated");
  expect(buildRunReport({ ...row, actions: [] }).challenge!.status).not.toBe("met");
  expect(buildRunReport({ ...row, challengeSpecHash: "0".repeat(64) }).challenge!.status).not.toBe("met");
});

test("trace-a-slowdown-cascade: eviction loses callers only under the slowdown; terminal health hides earlier loss", () => {
  const { d, designs } = variants();
  const engine = createModel2Engine(captureRunInputs(designs[0]!, d.workload, challengeSeed(d)), 10);
  for (let second = 1; second <= 10; second++) engine.advance();
  expect(engine.view().traffic.wholeRun).toMatchObject({ completed: 1999, failed: 0, inFlight: 1 });
  expect(engine.view().metrics.cache!.cache!.evictions).toBeGreaterThan(1800);
  const at6 = buildRunReport(attemptRow(d, designs[0]!, answers(d, {}), { stopAt: 6 })).terminal!;
  const at10 = buildRunReport(attemptRow(d, designs[0]!, answers(d, {}))).terminal!;
  expect(at6.traffic!.wholeRun!.failed).toBe(at10.traffic!.wholeRun!.failed);
  expect(at10.traffic!.wholeRun!.completed - at6.traffic!.wholeRun!.completed).toBeGreaterThanOrEqual(600);
  expect(at10.resources.every(r => r.health === "healthy")).toBe(true);
}, 60000);
