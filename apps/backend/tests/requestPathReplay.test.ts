import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { definition, REFERENCE } from "./challengeHarness";

test("request-path labs replay captured inputs identically in the browser bundle and server at every second", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/request-path-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build",
      resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path],
    { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text();
    if (await build.exited !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const id of ["writes-cost-more-than-reads", "balancer-shares-turns"]) {
      const d = definition(id);
      for (const design of [d.starter!, REFERENCE[id]!]) {
        // The wire round-trip must retain the captured profiles, workload and seed.
        const captured = captureRunInputs(design, d.workload, challengeSeed(d));
        const input = readRunInputs(JSON.parse(JSON.stringify(captured)));
        expect(input).toEqual(captured);
        const browser = browserRun(input, d.evaluationSeconds);
        const server = createModel2Engine(input, d.evaluationSeconds, buildModel2Contract);
        for (let second = 1; second <= d.evaluationSeconds; second++) {
          browser.advance(); server.advance();
          expect(browser.view()).toEqual(server.view());
        }
        expect(browser.evidence()).toEqual(server.evidence());
        expect(server.view().simulatedSeconds).toBe(d.evaluationSeconds);
        expect(server.view().traffic!.completedRps).toBeGreaterThan(0);
        console.info(JSON.stringify({lab: id, reference: design === REFERENCE[id], second: d.evaluationSeconds,
          p95Ms: server.view().traffic!.latencyMs.p95, completedRps: server.view().traffic!.completedRps}));
      }
    }
  } finally {
    if (await Bun.file(path).exists()) await unlink(path);
  }
}, 180000);
