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
import { evaluateCdnOriginLoad } from "../challenges/cdnCriterion";
import { recordedScenario } from "../challenges/scenario";
import { preflight } from "../challenges/preflight";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const ID = "share-one-origin-fetch";
test("share-one-origin-fetch: the constrained-origin case must expose caller harm", () => {
  const d = definition(ID);
  expect(d.evaluationSeconds).toBe(30);
  expect(d.criteria.find(c => c.kind === "caller-outcomes")).toMatchObject({ minCompleted: 10500, maxUnsuccessful: 50 });
  expect(d.scenario?.steps[0]?.request).toMatchObject({ interventionId: "bandwidth", target: { edgeId: "cdn-store", direction: "response" }, parameters: { bandwidth: 2000000, duration: 28 } });
});

function variants() {
  const d = definition(ID), starter = d.starter!, near = structuredClone(starter);
  near.resources.find(r => r.id === "cdn")!.cdnCachePolicy = { version: 2, ttlSeconds: 2, coalesce: false };
  return { d, designs: [starter, REFERENCE[ID]!, near] };
}

test("share-one-origin-fetch: coalescing alone reduces caller harm and origin load; TTL two is a near miss; reports round-trip", () => {
  const { d, designs } = variants();
  expect(validateInfrastructureName(d.title)).toBeNull();
  expect(specHash(d)).toBe(/"share-one-origin-fetch@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!);
  for (const design of designs) expect(preflight(d, design).errors).toEqual([]);
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const i of [1, 2]) expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({ classification: "one-change", count: 1 });
  const rows = designs.map(s => attemptRow(d, s, answers(d, { health: "healthy" }))), reports = rows.map(r => buildRunReport(r));
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  const cdn = reports.map(r => r.terminal!.resources.find(x => x.id === "cdn")!.cdn!);
  expect(cdn.map(c => [c.originRequests, c.coalesced])).toEqual([[245, 0], [27, 376], [162, 0]]);
  expect(reports.map(r => [r.terminal!.traffic!.wholeRun!.completed, r.terminal!.traffic!.wholeRun!.failed])).toEqual([[11856, 135], [11987, 4], [11910, 81]]);
  expect(reports[0]!.challenge!.criteria.filter(c => c.status === "not-met").map(c => c.id)).toEqual(["origin", "callers"]);
  expect(reports[1]!.terminal!.traffic!.wholeRun!.completed - 10500).toBeGreaterThan(1400);
  expect(50 - reports[1]!.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(40);
  expect(reports[1]!.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(0); // no perfect-run ceiling
  expect(cdn[0]!.originRequests! - cdn[0]!.fills!).toBe(135);
  expect(reports[1]!.terminal!.traffic!.wholeRun!.percentiles.p95!.lowMs).toBeGreaterThan(reports[0]!.terminal!.traffic!.wholeRun!.percentiles.p95!.highMs);
  for (const row of rows) {
    expect(row.actions).toHaveLength(1);
    expect(row.actions![0]!.status).toBe("completed");
    expect(row.actions![0]!.outcome).toMatchObject({ intervention: { interventionId: "bandwidth", atUs: 1000001, endUs: 29000001 } });
  }
  for (const [i, row] of rows.entries()) {
    const saved = { ...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot)), challengeScenario: JSON.parse(JSON.stringify(row.challengeScenario)), actions: row.actions?.map(action => ({ ...action, parameters: JSON.parse(JSON.stringify(action.parameters)), outcome: JSON.parse(JSON.stringify(action.outcome)) })) };
    expect(buildRunReport(saved).terminal).toEqual(reports[i]!.terminal);
    expect(buildRunReport(saved).challenge).toEqual(reports[i]!.challenge);
  }
}, 120000);

test("share-one-origin-fetch: missing counters or a dropped TTL are not evaluated, never met", () => {
  const { d, designs } = variants(), row: any = attemptRow(d, designs[1]!, answers(d, { health: "healthy" }));
  const stripped = JSON.parse(JSON.stringify(row.terminalSnapshot)); delete stripped.metrics.cdn.cdn;
  expect(buildRunReport({ ...row, terminalSnapshot: stripped }).challenge!.criteria[1]!.status).toBe("not-evaluated");
  const noTtl = JSON.parse(JSON.stringify(row.runInputs)); delete noTtl.resources.find((r: any) => r.id === "cdn").cdnCachePolicy.ttlSeconds;
  expect(buildRunReport({ ...row, runInputs: noTtl }).challenge).toMatchObject({ definitionMatches: false, status: "unavailable", criteria: [] }); // the retained scenario no longer matches these altered inputs
  const criterion = d.criteria.find(c => c.kind === "cdn-origin-load")!;
  if (criterion.kind !== "cdn-origin-load") throw Error("Missing origin criterion");
  expect(evaluateCdnOriginLoad(criterion, noTtl, buildRunReport(row).terminal!, d.evaluationSeconds, false).met).toBeUndefined();
  const noTraffic = JSON.parse(JSON.stringify(row.terminalSnapshot)); delete noTraffic.traffic.wholeRun;
  expect(buildRunReport({ ...row, terminalSnapshot: noTraffic }).challenge!.criteria[2]!.status).toBe("not-evaluated");
  expect(buildRunReport({ ...row, actions: [] }).challenge!.criteria.every(c => c.status === "not-evaluated")).toBe(true);
  expect(buildRunReport({ ...row, challengeSpecHash: "0".repeat(64) }).challenge!.definitionMatches).toBe(false);
});

test("share-one-origin-fetch: browser-target bundle and default server replay agree every second for all three variants", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/share-origin-${process.pid}.ts`), out = entry.replace(/\.ts$/, ".mjs");
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
      
      expect(browserContract(input, d.evaluationSeconds)).toEqual(buildContractFromRunInputs(input, d.evaluationSeconds));
      const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds), plan = recordedScenario(d, input)!;
      for (let second = 1; second <= d.evaluationSeconds; second++) {
        browser.advance(); server.advance();
        for (const step of plan.steps.filter(s => s.atSecond === second)) {
          const action = { kind: "intervention" as const, parameters: step.request };
          expect(browser.apply(action)).toEqual(server.apply(action));
          while (browser.catchingUp) browser.catchUp(10);
          while (server.catchingUp) server.catchUp(10);
        }
        expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
        if (second === 10) {
          const link = server.evidence().network.links.find(l => l.from === "store" && l.to === "cdn")!;
          expect(link.bandwidthBytesPerSecond).toBe(2000000);
          console.info("share-origin-link-mechanism", JSON.stringify({variant: designs.indexOf(design), link}));
        }
      }
    }
    console.info("share-origin-browser-target-server-parity", JSON.stringify({ cases: 3, secondsPerCase: 30 }));
  } finally { for (const path of [entry, out]) if (await Bun.file(path).exists()) await unlink(path); }
}, 240000);

test("share-one-origin-fetch: lesson and hints teach the measured transport tradeoff without promising perfect callers", async () => {
  const { findLearningLesson } = await import("../learning/registry");
  const { learningContent } = await import("../learning/content");
  const { validateLearningContent } = await import("../learning/validate");
  const { checkLearningAuthoring } = await import("../learning/authoring");
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(checkLearningAuthoring(learningContent).labs).toBeGreaterThan(0);
  const lesson = findLearningLesson(ID)!, d = definition(ID);
  expect(lesson.summary).toContain("failed callers");
  expect(lesson.explanation.join(" ")).toContain("whole-run p95 buckets");
  expect(lesson.explanation.join(" ")).toContain("reference still loses some callers");
  expect(lesson.limitations.join(" ")).toContain("stored object size differs");
  expect(lesson.limitations.join(" ")).toContain("older TTL-only policy also shares fills by default");
  expect(lesson.limitations.join(" ")).toContain("Unknown");
  expect(lesson.experiment!.evidenceToInspect).toContain("Whole run: Failed");
  expect(d.hints.join(" ")).not.toMatch(/turn on|enable coalescing/i);
  expect(d.debrief.join(" ")).not.toContain("Callers are served in every variant");
});
