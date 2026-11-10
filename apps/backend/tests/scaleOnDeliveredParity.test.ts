import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { challengeSeed } from "../challenges/registry";
import { buildRunReport } from "../reports/report";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const ID = "scale-on-delivered-samples";
/** Starter, the hidden one-change reference, and the near miss that only lowers the CPU target. */
function variants() {
  const d = definition(ID), starter = d.starter!, near = structuredClone(starter);
  const app = near.resources.find(r => r.id === "app")!;
  app.autoscaling = { ...app.autoscaling!, targetCpu: Math.max(1, Math.floor(app.autoscaling!.targetCpu! / 2)) };
  return { d, designs: [starter, REFERENCE[ID]!, near] };
}

test("scale-on-delivered-samples: browser-target bundle and default server replay agree every second for all three variants", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/scale-delivered-${process.pid}.ts`), out = entry.replace(/\.ts$/, ".mjs");
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
      expect(input.adapterProfiles).toContain("autoscaling-observed/1");
      expect(browserContract(input, 90)).toEqual(buildContractFromRunInputs(input, 90));
      const browser = browserRun(input, 90), server = createModel2Engine(input, 90);
      for (let second = 1; second <= 90; second++) { browser.advance(); server.advance(); expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence()); }
    }
    console.info("scale-on-delivered-browser-target-server-parity", JSON.stringify({ cases: 3, secondsPerCase: 90 }));
  } finally { for (const path of [entry, out]) if (await Bun.file(path).exists()) await unlink(path); }
}, 240000);

test("scale-on-delivered-samples: saved runs round-trip through JSON with identical terminal evidence and challenge verdicts", () => {
  const { d, designs } = variants();
  const rows = designs.map(design => attemptRow(d, design, answers(d, { "scale-out": "yes" })));
  const reports = rows.map(r => buildRunReport(r));
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  for (const [i, row] of rows.entries()) {
    const saved = { ...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot)) };
    expect(buildRunReport(saved).terminal).toEqual(reports[i]!.terminal);
    expect(buildRunReport(saved).challenge).toEqual(reports[i]!.challenge);
    const pool = reports[i]!.terminal!.resources.find(r => r.id === "app")!.startup!.controllers![0]!;
    expect(pool.signal).toMatchObject({ source: "observed-core-time", backend: "monitor/backend" });
  }
});
