import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { recordedScenario } from "../challenges/scenario";
import { definition, REFERENCE } from "./challengeHarness";

test("browser bundle and server replay retain exact retry/breaker samples every second without changing raw engine outcomes", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/lb-resilience-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); expect(await build.exited, diagnostics).toBe(0);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const id of ["test-a-circuit-again", "retrying-a-full-pool"]) {
      const d = definition(id);
      for (const design of [d.starter!, REFERENCE[id]!]) {
        const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(design, d.workload, challengeSeed(d)))));
        const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds, buildModel2Contract), scenario = recordedScenario(d, input);
        for (let second = 1; second <= d.evaluationSeconds; second++) {
          browser.advance(); server.advance();
          for (const step of scenario?.steps.filter(s => s.atSecond === second) ?? []) {
            expect(browser.apply({kind: "intervention", parameters: step.request})).toEqual(server.apply({kind: "intervention", parameters: step.request}));
            while (browser.catchingUp) browser.catchUp(10);
            while (server.catchingUp) server.catchUp(10);
          }
          expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
        }
      }
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 120000);
