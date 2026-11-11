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
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const ID = "serve-stale-on-error";
const edit = (fn: (s: ChallengeStarter) => void) => { const s = structuredClone(definition(ID).starter!); fn(s); return s; };
const cachePolicy = (s: ChallengeStarter) => s.resources.find(r => r.id === "cache")!.cachePolicy!;
function variants() {
  const d = definition(ID), starter = d.starter!;
  const bigDb = edit(s => { s.resources.find(r => r.id === "db")!.size = "large"; });
  const retries = edit(s => { s.resources.find(r => r.id === "lb")!.retry!.maxAttempts = 5; });
  const shortBound = edit(s => { cachePolicy(s).staleSeconds = 5; });
  return { d, designs: [starter, REFERENCE[ID]!, bigDb, retries, shortBound] };
}

test("serve-stale-on-error: a stale bound alone serves counted stale answers; bigger database, retries and a short bound do not; reports round-trip", () => {
  const { d, designs } = variants();
  expect(validateInfrastructureName(d.title)).toBeNull();
  expect(specHash(d)).toBe(/"serve-stale-on-error@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!);
  for (const design of designs) expect(preflight(d, design).errors).toEqual([]);
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const i of [1, 2, 3, 4]) expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({ classification: "one-change", count: 1 });
  expect(inputs[0]!.adapterProfiles ?? []).not.toContain("cache-stale/1");
  expect(inputs[1]!.adapterProfiles).toContain("cache-stale/1");
  const rows = designs.map(s => attemptRow(d, s, answers(d, { health: "healthy" }))), reports = rows.map(r => buildRunReport(r));
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met", "not-met", "not-met"]);
  expect(reports.map(r => r.terminal!.traffic!.wholeRun!.failed)).toEqual([5840, 1, 5840, 5839, 4841]);
  const cache = reports.map(r => r.terminal!.resources.find(x => x.id === "cache")!.cache!);
  expect(cache.map(c => [c.staleServed, c.maxStaleAgeUs])).toEqual([[undefined, undefined], [5998, 29988782], [undefined, undefined], [undefined, undefined], [1000, 4998782]]);
  for (const [i, row] of rows.entries()) {
    const saved = { ...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot)) };
    expect(buildRunReport(saved).terminal).toEqual(reports[i]!.terminal);
    expect(buildRunReport(saved).challenge).toEqual(reports[i]!.challenge);
  }
});

test("serve-stale-on-error: invalid bounds are refused and missing stale evidence is never met", () => {
  const { d, designs } = variants();
  for (const bad of [0, -1, 1.5, 100000]) expect(() => captureRunInputs(edit(s => { cachePolicy(s).staleSeconds = bad; }), d.workload, "x")).toThrow();
  const input = JSON.parse(JSON.stringify(captureRunInputs(designs[1]!, d.workload, "x")));
  input.adapterProfiles = input.adapterProfiles.filter((p: string) => p !== "cache-stale/1");
  expect(() => createModel2Engine(readRunInputs(input), 33)).toThrow("cache-stale");
  const row: any = attemptRow(d, designs[1]!, answers(d, { health: "healthy" }));
  const stripped = JSON.parse(JSON.stringify(row.terminalSnapshot)); delete stripped.metrics.cache.cache.staleServed;
  expect(buildRunReport({ ...row, terminalSnapshot: stripped }).challenge!.criteria[2]!.status).toBe("not-evaluated");
});

test("serve-stale-on-error: browser-target bundle and default server replay agree every second for all variants", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/stale-on-error-${process.pid}.ts`), out = entry.replace(/\.ts$/, ".mjs");
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
      
      expect(browserContract(input, 33)).toEqual(buildContractFromRunInputs(input, 33));
      const browser = browserRun(input, 33), server = createModel2Engine(input, 33);
      for (let second = 1; second <= 33; second++) { browser.advance(); server.advance(); expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence()); }
    }
    console.info("stale-on-error-browser-target-server-parity", JSON.stringify({ cases: 5, secondsPerCase: 33 }));
  } finally { for (const path of [entry, out]) if (await Bun.file(path).exists()) await unlink(path); }
}, 540000);
