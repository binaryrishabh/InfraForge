import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { definition, REFERENCE } from "./challengeHarness";

test("capacity budget: browser bundle and server replay agree every tick for starter, all passing allocations and budget near miss", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/capacity-budget-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    const d = definition("split-the-capacity-budget"), app = REFERENCE[`${d.id}-app-headroom`]!, db = REFERENCE[`${d.id}-db-headroom`]!;
    const overBudget = {...app, resources: app.resources.map(r => r.id === "db" ? db.resources.find(r => r.id === "db")! : r)};
    for (const design of [d.starter!, REFERENCE[d.id]!, app, db, overBudget]) {
      const input = captureRunInputs(design, d.workload, challengeSeed(d));
      expect(readRunInputs(JSON.parse(JSON.stringify(input)))).toEqual(input);
      const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds);
      for (let second = 1; second <= d.evaluationSeconds; second++) {
        browser.advance(); server.advance();
        expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
      }
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 120000);
