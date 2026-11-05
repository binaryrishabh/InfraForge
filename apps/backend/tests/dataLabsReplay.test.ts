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

test("data labs replay captured inputs and scripted slowdown identically in browser bundle and server", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/data-labs-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text();
    if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const id of ["move-reads-off-the-writer", "budget-app-database-sessions", "replicas-do-not-take-writes"]) {
      const d = definition(id);
      for (const design of [d.starter!, REFERENCE[id]!]) {
        const captured = captureRunInputs(design, d.workload, challengeSeed(d)), input = readRunInputs(JSON.parse(JSON.stringify(captured)));
        expect(input).toEqual(captured);
        const plan = recordedScenario(d, input), browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds);
        for (let second = 1; second <= d.evaluationSeconds; second++) {
          browser.advance(); server.advance();
          expect(browser.view()).toEqual(server.view());
          expect(browser.evidence()).toEqual(server.evidence());
          for (const step of plan?.steps.filter(s => s.atSecond === second) ?? []) {
            const request = {kind: "intervention" as const, parameters: step.request};
            expect(browser.apply(request)).toEqual(server.apply(request));
          }
        }
        expect(server.view().simulatedSeconds).toBe(6);
        expect(server.view().traffic!.completedRps).toBeGreaterThan(0);
        console.info(JSON.stringify({lab: id, reference: design === REFERENCE[id], p95Ms: server.view().traffic!.latencyMs.p95, completedRps: server.view().traffic!.completedRps}));
      }
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 180000);
