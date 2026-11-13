import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { challengeSeed, specHash } from "../challenges/registry";
import { buildRunReport } from "../reports/report";
import { reviewDesignChanges } from "../challenges/designChanges";
import { preflight } from "../challenges/preflight";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const ID = "refresh-after-a-write";
const d = definition(ID), STARTER = d.starter!, REF = REFERENCE[ID]!;
type Policy = { ttlSeconds?: number; capacityEntries?: number; invalidateOnWrite?: unknown; [key: string]: unknown };
const edit = (base: ChallengeStarter, fn: (s: ChallengeStarter) => void) => { const s = structuredClone(base); fn(s); return s; };
const policy = (s: ChallengeStarter) => s.resources.find(r => r.id === "cache")!.cachePolicy as Policy;
const nearMiss = edit(STARTER, s => { policy(s).ttlSeconds = 2; });
const run = (design: ChallengeStarter) => {
  const row = attemptRow(d, design, answers(d, { health: "healthy" })), report = buildRunReport(row);
  const terminal = report.terminal!, cache = terminal.resources.find(r => r.id === "cache")!, helper = terminal.resources.flatMap(x => x.applicationHelpers?.helpers ?? [])[0]!;
  return { row, report, status: report.challenge!.status, criteria: report.challenge!.criteria.map(c => c.status), failed: terminal.traffic!.wholeRun!.failed, completed: terminal.traffic!.wholeRun!.completed,
    hits: cache.cache!.hits!, misses: cache.cache!.misses!, behind: cache.cache!.outdatedHits, gap: cache.cache!.maxVersionsBehind, dbReads: helper.databaseFetches! };
};
const T = 240000;

test("refresh-after-a-write: turning invalidation on removes the outdated hits; a shorter TTL, a bigger database and a bigger app do not; reports round-trip", () => {
  expect(validateInfrastructureName(d.title)).toBeNull();
  expect(specHash(d)).toBe(/"refresh-after-a-write@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!);
  const bigDb = edit(STARTER, s => { s.resources.find(r => r.id === "db")!.size = "large"; });
  const bigApp = edit(STARTER, s => { s.resources.find(r => r.id === "app")!.skuId = "c5.xlarge"; });
  const designs = [STARTER, REF, nearMiss, bigDb, bigApp];
  for (const design of designs) expect(preflight(d, design).errors).toEqual([]);
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const i of [1, 2, 3, 4]) expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({ classification: "one-change", count: 1 });
  for (const input of inputs) expect(input.adapterProfiles).toContain("cache-invalidation/1"); // both values are marked, so the pair shares one adapter selection
  const r = designs.map(run);
  expect(r.map(x => x.status)).toEqual(["not-met", "met", "not-met", "not-met", "not-met"]);
  expect(r.map(x => x.criteria)).toEqual([["met", "met", "not-met"], ["met", "met", "met"], ["met", "met", "not-met"], ["met", "met", "not-met"], ["met", "met", "not-met"]]);
  // [hits, misses, hits behind the database, most versions behind, database fetches]; the requirement is at most 100 behind and at least 4000 hits.
  expect(r.map(x => [x.hits, x.misses, x.behind, x.gap, x.dbReads])).toEqual([[6699, 50, 6541, 60, 2300], [4999, 1750, 0, 0, 4000], [6058, 691, 4130, 9, 2941], [6699, 50, 6541, 60, 2300], [6699, 50, 6541, 60, 2300]]);
  expect(r[0]!.behind! - 100).toBeGreaterThan(6000); expect(r[1]!.hits - 4000).toBeGreaterThan(900); // starter over the bound by 65x, reference above the hit floor by a fifth
  expect(r[2]!.behind!).toBeGreaterThan(4000); expect(r[2]!.dbReads).toBeGreaterThan(r[0]!.dbReads); // the TTL near miss is still thousands behind and adds database work
  expect(r[1]!.dbReads).toBeGreaterThan(r[0]!.dbReads); // invalidation is not free
  for (const x of r) { expect(x.failed).toBe(0); expect(x.completed).toBeGreaterThan(8900); } // every variant keeps its callers: only freshness differs
  for (const x of r) {
    const saved = { ...x.row, runInputs: JSON.parse(JSON.stringify(x.row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(x.row.terminalSnapshot)) };
    expect(buildRunReport(saved).terminal).toEqual(x.report.terminal); expect(buildRunReport(saved).challenge).toEqual(x.report.challenge);
  }
}, T);

test("refresh-after-a-write: plausible edits. With invalidation off no edit passes; a tiny cache avoids old rows only by rarely hitting; with it on, other settings still pass", () => {
  const off = (fn: (p: Policy) => void) => edit(STARTER, s => fn(policy(s)));
  const on = (fn: (p: Policy) => void, db?: "large") => edit(STARTER, s => { policy(s).invalidateOnWrite = true; fn(policy(s)); if (db) s.resources.find(r => r.id === "db")!.size = db; });
  const rows = Object.fromEntries(Object.entries({
    ttl1: off(p => { p.ttlSeconds = 1; }), ttl10: off(p => { p.ttlSeconds = 10; }), cap10: off(p => { p.capacityEntries = 10; }),
    onTtl1: on(p => { p.ttlSeconds = 1; }), onBigDb: on(() => {}, "large"), onCap10: on(p => { p.capacityEntries = 10; }),
  }).map(([name, design]) => [name, run(design)]));
  const line = (x: ReturnType<typeof run>) => [x.status, x.hits, x.behind, x.gap];
  expect(line(rows.ttl1!)).toEqual(["not-met", 5511, 2655, 5]); expect(line(rows.ttl10!)).toEqual(["not-met", 6599, 6150, 29]);
  expect(line(rows.cap10!)).toEqual(["not-met", 1319, 79, 2]); // fewer than 100 behind, but 1319 hits is far under the 4000 floor
  expect(line(rows.onTtl1!)).toEqual(["met", 4677, 0, 0]); expect(line(rows.onBigDb!)).toEqual(["met", 4999, 0, 0]);
  expect(line(rows.onCap10!)).toEqual(["not-met", 1293, 0, 0]); // invalidation on, but the cache is too small to be useful
  expect(rows.ttl1!.behind!).toBeGreaterThan(2000); expect(4000 - rows.cap10!.hits).toBeGreaterThan(2500);
}, T);

test("refresh-after-a-write: an unmarked cache keeps today's behaviour, bytes and evidence; marked values are strictly validated", () => {
  const unmarked = edit(STARTER, s => { delete policy(s).invalidateOnWrite; });
  const input = captureRunInputs(unmarked, d.workload, challengeSeed(d));
  expect(input.adapterProfiles ?? []).not.toContain("cache-invalidation/1");
  const contract = JSON.stringify(buildContractFromRunInputs(input, 30));
  expect(contract).not.toContain("trackFreshness"); expect(contract).not.toContain("cache-invalidation");
  expect(JSON.stringify(buildContractFromRunInputs(captureRunInputs(STARTER, d.workload, challengeSeed(d)), 30))).toContain("trackFreshness");
  const x = run(unmarked); // same behaviour as an explicit true, with no freshness evidence at all
  expect([x.hits, x.misses, x.dbReads]).toEqual([4999, 1750, 4000]); expect(x.behind).toBeUndefined(); expect(x.gap).toBeUndefined();
  expect(x.criteria[2]).toBe("not-evaluated");
  for (const bad of ["yes", 0, 1, null, [], {}]) expect(() => captureRunInputs(edit(STARTER, s => { policy(s).invalidateOnWrite = bad; }), d.workload, "x")).toThrow();
  expect(() => captureRunInputs(edit(STARTER, s => { policy(s).invalidate = true; }), d.workload, "x")).toThrow();
}, T);

test("refresh-after-a-write: missing, malformed or contradictory evidence is never met; a replicated database and a stripped profile are refused", () => {
  const ref = run(REF), row = ref.row as unknown as { terminalSnapshot: { metrics: Record<string, { cache: Record<string, unknown> }> }; runInputs: { resources: Array<{ id: string; cachePolicy?: Record<string, unknown> }> } };
  const verdict = (patch: (cache: Record<string, unknown>) => void, inputs?: (r: typeof row.runInputs) => void) => {
    const terminal = JSON.parse(JSON.stringify(row.terminalSnapshot)), runInputs = JSON.parse(JSON.stringify(row.runInputs));
    patch(terminal.metrics.cache!.cache); inputs?.(runInputs);
    return buildRunReport({ ...(ref.row as object), terminalSnapshot: terminal, runInputs } as never).challenge!.criteria[2]!.status;
  };
  expect(verdict(() => {})).toBe("met");
  expect(verdict(c => { delete c.outdatedHits; })).toBe("not-evaluated");
  expect(verdict(c => { c.outdatedHits = null; })).toBe("not-evaluated");
  expect(verdict(c => { c.outdatedHits = -1; })).toBe("not-evaluated");
  expect(verdict(c => { c.outdatedHits = 1.5; })).toBe("not-evaluated");
  expect(verdict(c => { c.outdatedHits = 5; c.maxVersionsBehind = null; })).toBe("not-evaluated"); // outdated hits need a recorded gap
  expect(verdict(c => { c.outdatedHits = (c.hits as number) + 1; c.maxVersionsBehind = 2; })).toBe("not-evaluated"); // more outdated hits than hits is a contradiction
  expect(verdict(c => { c.hits = null; })).toBe("not-evaluated");
  expect(verdict(c => { c.outdatedHits = 101; c.maxVersionsBehind = 1; })).toBe("not-met");
  expect(verdict(c => { c.hits = 0; c.outdatedHits = 0; })).toBe("not-met"); // no hits is not a pass
  expect(verdict(c => { c.hits = 3999; })).toBe("not-met");
  expect(verdict(() => {}, r => { delete r.resources.find(x => x.id === "cache")!.cachePolicy!.invalidateOnWrite; })).toBe("not-evaluated"); // the saved policy must be retained
  expect(verdict(() => {}, r => { r.resources = r.resources.filter(x => x.id !== "cache"); })).toBe("not-evaluated");
  const input = JSON.parse(JSON.stringify(captureRunInputs(REF, d.workload, "x")));
  input.adapterProfiles = input.adapterProfiles.filter((p: string) => p !== "cache-invalidation/1");
  expect(() => createModel2Engine(readRunInputs(input), 30)).toThrow("cache-invalidation");
  const replicated = edit(REF, s => { s.resources.find(r => r.id === "db")!.databaseReplication = { version: 1, enabled: true, replicationDelayMs: 100, readPolicy: "primary" }; });
  expect(() => createModel2Engine(readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(replicated, d.workload, "x")))), 30)).toThrow("without replication");
}, T);

test("refresh-after-a-write: lesson, module, review record and reviewed hash are registered", async () => {
  const { findLearningLesson, LEARNING_REGISTRY } = await import("../learning/registry");
  const { learningContent } = await import("../learning/content"), { validateLearningContent } = await import("../learning/validate");
  const { checkLessonClaims } = await import("../learning/claims"), { REVIEWED_CHALLENGES } = await import("../learning/reviewedChallenges");
  const lesson = findLearningLesson(ID)!;
  expect(lesson).toMatchObject({ kind: "executable-lab", trackId: "data", moduleId: "cache-freshness", experiment: { challengeId: ID }, check: null, prerequisites: ["cache-hits-and-misses", "reuse-before-expiry", "fit-the-working-set"] });
  expect(LEARNING_REGISTRY.findModule("data", "cache-freshness")!.lessonIds).toEqual([ID]);
  expect(REVIEWED_CHALLENGES[`${ID}@1`]).toEqual({ challengeId: ID, version: 1, hash: specHash(d) });
  expect(validateLearningContent(learningContent)).toEqual([]); expect(checkLessonClaims(lesson, d)).toEqual([]);
  expect(lesson.limitations.join(" ")).toContain("not application correctness"); expect(lesson.explanation.join(" ")).toContain("Valid alternatives exist");
});

test("refresh-after-a-write: the lesson says what the engine does with a replicated database (refused before the run) and how many hits the gap counted (none)", async () => {
  const { findLearningLesson } = await import("../learning/registry"), lesson = findLearningLesson(ID)!;
  const replicated = edit(STARTER, s => { s.resources.find(r => r.id === "db")!.databaseReplication = { version: 1, enabled: true, replicationDelayMs: 100, readPolicy: "primary" }; });
  expect(preflight(d, replicated).errors.join(" ")).toContain("needs a database without replication or read routing"); // a refusal, not an Unknown reading
  const limits = lesson.limitations.join(" ");
  expect(limits).toContain("refused"); expect(limits).not.toContain("stays Unknown");
  expect(lesson.explanation.join(" ")).not.toContain("fall to the few"); // the measured count is zero, so the lesson must not promise a few
  expect(lesson.explanation.join(" ")).toContain("none did");
});

test("refresh-after-a-write: browser-target bundle and default server replay agree every second for starter, reference and near miss", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/refresh-after-a-write-${process.pid}.ts`), out = entry.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entry), { recursive: true });
  try {
    await writeFile(entry, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entry, "--target=browser", "--outfile", out], { stdout: "ignore", stderr: "pipe" });
    const diagnostic = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostic);
    const module = await import(pathToFileURL(out).href);
    const browserRun: typeof createModel2Run = module.createModel2Run, browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs;
    for (const design of [STARTER, REF, nearMiss]) {
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(design, d.workload, challengeSeed(d)))));
      expect(browserContract(input, 30)).toEqual(buildContractFromRunInputs(input, 30));
      const browser = browserRun(input, 30), server = createModel2Engine(input, 30);
      for (let second = 1; second <= 30; second++) { browser.advance(); server.advance(); expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence()); }
    }
    console.info("refresh-after-a-write-browser-target-server-parity", JSON.stringify({ cases: 3, secondsPerCase: 30 }));
  } finally { for (const path of [entry, out]) if (await Bun.file(path).exists()) await unlink(path); }
}, 540000);
