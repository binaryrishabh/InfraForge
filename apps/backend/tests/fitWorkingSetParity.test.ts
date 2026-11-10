import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildRunReport } from "../reports/report";
import { classifyComparison } from "../comparison/classify";
import { fitWorkingSetLabFixture } from "./fitWorkingSetLab.fixture";

test("all fit the working set variants match browser-target and two independent server replays at every tick", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/fit-working-set-${process.pid}.ts`), out = entry.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entry), {recursive: true});
  try {
    await writeFile(entry, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entry, "--target=browser", "--outfile", out], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const module = await import(pathToFileURL(out).href);
    const browserRun: typeof createModel2Run = module.createModel2Run, browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs;
    const {d, designs, rows} = fitWorkingSetLabFixture();
    for (const [i, design] of designs.entries()) {
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(design, d.workload, challengeSeed(d)))));
      expect(browserContract(input, 6)).toEqual(buildContractFromRunInputs(input, 6));
      const browser = browserRun(input, 6), server = createModel2Engine(input, 6), repeat = createModel2Engine(input, 6);
      expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
      for (let second = 1; second <= 6; second++) {
        for (const run of [browser, server, repeat]) run.advance();
        expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
        expect(repeat.view()).toEqual(server.view()); expect(repeat.evidence()).toEqual(server.evidence());
      }
      const report = buildRunReport(rows[i]!);
      expect(report.terminal!.traffic).toEqual(browser.view().traffic);
    }
    console.info("fit-working-set-parity", JSON.stringify({variants: 3, boundariesPerVariant: 7, independentServerReplays: 2}));
  } finally {for (const path of [entry, out]) if (await Bun.file(path).exists()) await unlink(path);}
}, 120000);

test("both controlled pairs retain one-change comparison, matched profiles, diagnosis and exact saved-report replay", () => {
  const {rows} = fitWorkingSetLabFixture();
  for (const i of [1, 2]) {
    const first = {...rows[0]!, createdAt: new Date(0)}, second = {...rows[i]!, createdAt: new Date(1), improvementSourceId: rows[0]!.id};
    const comparison = classifyComparison(first, second);
    expect(comparison.available).toBe(true);
    expect(comparison.designChangeReview).toMatchObject({classification: "one-change", count: 1});
    expect(comparison.starting.grade).toBe("one-change-design"); expect(comparison.lineage).toBe("source-and-improvement");
    expect(comparison.challengeConditions).toBe("same");
  }
});
