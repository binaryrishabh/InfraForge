import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { recordedScenario } from "../challenges/scenario";
import { createModel2Engine } from "../simulator/model2Engine";
import { definition, REFERENCE } from "./challengeHarness";

test("single-flight starter, reference and capacity near miss match browser/server every second and exact slowdown receipts", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/single-flight-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text();
    if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    const d = definition("share-a-cache-fill"), near = structuredClone(d.starter!);
    near.resources.find(r => r.id === "cache")!.cachePolicy!.capacityEntries = 32;
    for (const design of [d.starter!, REFERENCE[d.id]!, near]) {
      const captured = captureRunInputs(design, d.workload, challengeSeed(d));
      const input = readRunInputs(JSON.parse(JSON.stringify(captured)));
      expect(input).toEqual(captured);
      const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds);
      const scenario = recordedScenario(d, input)!;
      let applied = 0;
      for (let second = 1; second <= d.evaluationSeconds; second++) {
        browser.advance(); server.advance();
        for (const step of scenario.steps.filter(s => s.atSecond === second)) {
          const a = browser.apply({kind: "intervention", parameters: step.request});
          const b = server.apply({kind: "intervention", parameters: step.request});
          expect(a).toEqual(b); expect(a.outcome.intervention).toEqual(scenario.receipts[applied++]!);
          while (browser.catchingUp) browser.catchUp(10);
          while (server.catchingUp) server.catchUp(10);
        }
        expect(browser.view()).toEqual(server.view());
        expect(browser.evidence()).toEqual(server.evidence());
      }
      expect(applied).toBe(1);
      expect(server.evidence().product.interventions!.every(i => i.phase === "completed")).toBe(true);
      expect(server.view().traffic.wholeRun!.completed).toBe(1000);
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 120000);
