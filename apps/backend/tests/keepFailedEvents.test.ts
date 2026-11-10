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
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const ID = "keep-failed-events";
function variants() {
  const d = definition(ID), starter = d.starter!, near = structuredClone(starter);
  near.resources.find(r => r.id === "bus")!.eventBus!.maxAttempts = 6;
  return { d, designs: [starter, REFERENCE[ID]!, near] };
}

test("keep-failed-events: capacity alone keeps the failed events; more attempts do not; reports round-trip", () => {
  const { d, designs } = variants();
  expect(validateInfrastructureName(d.title)).toBeNull();
  expect(specHash(d)).toBe(/"keep-failed-events@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!);
  for (const design of designs) expect(preflight(d, design).errors).toEqual([]);
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const i of [1, 2]) expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({ classification: "one-change", count: 1 });
  const rows = designs.map(s => attemptRow(d, s, answers(d, { health: "healthy" }))), reports = rows.map(r => buildRunReport(r));
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  const bus = reports.map(r => r.terminal!.resources.find(x => x.id === "bus")!.eventBus!.subscriptions[0]!);
  expect(bus.map(s => [s.deadLettered, s.deadLetterOverflow])).toEqual([[5, 55], [60, 0], [5, 54]]);
  for (const [i, row] of rows.entries()) {
    const saved = { ...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot)) };
    expect(buildRunReport(saved).terminal).toEqual(reports[i]!.terminal);
    expect(buildRunReport(saved).challenge).toEqual(reports[i]!.challenge);
  }
});

test("keep-failed-events: missing or altered evidence is not evaluated, never met", () => {
  const { d, designs } = variants(), row: any = attemptRow(d, designs[1]!, answers(d, { health: "healthy" }));
  const stripped = JSON.parse(JSON.stringify(row.terminalSnapshot)); delete stripped.metrics.bus.eventBus;
  expect(buildRunReport({ ...row, terminalSnapshot: stripped }).challenge!.criteria[1]!.status).toBe("not-evaluated");
  const wrongBus = JSON.parse(JSON.stringify(row.runInputs)); wrongBus.resources = wrongBus.resources.filter((r: any) => r.id !== "bus");
  expect(buildRunReport({ ...row, runInputs: wrongBus }).challenge!.criteria[1]!.status).not.toBe("met");
});

test("keep-failed-events: browser-target bundle and default server replay agree every second for all three variants", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/keep-failed-${process.pid}.ts`), out = entry.replace(/\.ts$/, ".mjs");
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
      
      expect(browserContract(input, 90)).toEqual(buildContractFromRunInputs(input, 90));
      const browser = browserRun(input, 90), server = createModel2Engine(input, 90);
      for (let second = 1; second <= 90; second++) { browser.advance(); server.advance(); expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence()); }
    }
    console.info("keep-failed-browser-target-server-parity", JSON.stringify({ cases: 3, secondsPerCase: 90 }));
  } finally { for (const path of [entry, out]) if (await Bun.file(path).exists()) await unlink(path); }
}, 240000);
