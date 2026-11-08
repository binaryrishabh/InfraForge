import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { restoreADatabaseWriterV1 as d } from "../challenges/definitions/restore-a-database-writer/v1";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { recordedScenario, verifiedScenario } from "../challenges/scenario";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildRunReport } from "../reports/report";
import { REFERENCE, answers, attemptRow } from "./challengeHarness";

test("captured incident plans replay tick for tick in browser target and server through failure, promotion and return", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/database-recovery-browser-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserFactory: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    const late = structuredClone(d.starter!); late.resources[1]!.databaseRecoveryPlan!.promoteAtSecond = 8;
    const delayed = structuredClone(REFERENCE[d.id]!); delayed.resources[1]!.databaseReplication!.replicationDelayMs = 60000;
    for (const design of [d.starter!, REFERENCE[d.id]!, late, delayed]) {
      const captured = captureRunInputs(design, d.workload, challengeSeed(d)), input = readRunInputs(JSON.parse(JSON.stringify(captured)));
      const plan = recordedScenario(d, input)!, serverPlan = verifiedScenario(JSON.parse(JSON.stringify(plan)), d, input);
      const browser = browserFactory(input, 14), server = createModel2Engine(input, 14);
      for (let second = 1; second <= 14; second++) {
        browser.advance(); server.advance(); expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
        for (const step of plan.steps.filter(s => s.atSecond === second)) browser.apply({kind: "intervention", parameters: step.request});
        for (const step of serverPlan.steps.filter(s => s.atSecond === second)) server.apply({kind: "intervention", parameters: step.request});
      }
      const report = buildRunReport(attemptRow(d, design, answers(d, {"overall-health": "healthy"})));
      expect(report.terminal!.traffic).toEqual(browser.view().traffic);
      expect(report.terminal!.resources.find(r => r.id === "db")!.databaseReplication).toEqual(browser.view().metrics.db!.databaseReplication);
      expect(report.databaseRecoveryPlan!.hash).toBe(plan.recoveryPlanHash!);
      for (const action of report.actions) expect(Buffer.byteLength(JSON.stringify(action.outcome, null, 1), "utf8")).toBeLessThan(32768);
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
});
