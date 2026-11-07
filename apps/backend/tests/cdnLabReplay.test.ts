import { expect, test } from "bun:test";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { definition, REFERENCE } from "./challengeHarness";

test("CDN lab starter, TTL-only reference and shorter near miss replay with identical browser/server evidence", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/cdn-lab-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    const d = definition("keep-an-asset-cached"), near = structuredClone(d.starter!);
    near.resources[0]!.cdnCachePolicy!.ttlSeconds = 10;
    for (const design of [d.starter!, REFERENCE[d.id]!, near]) {
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(design, d.workload, challengeSeed(d)))));
      const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds);
      for (let s = 1; s <= d.evaluationSeconds; s++) {
        browser.advance(); server.advance();
        if (s === 2) { const action = {kind: "chaos" as const, parameters: {type: DeploymentChaosNames.Crash, resourceId: "store"}}; expect(browser.apply(action)).toEqual(server.apply(JSON.parse(JSON.stringify(action)))); }
        expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
      }
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 60000);
