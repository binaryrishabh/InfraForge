import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { definition, REFERENCE } from "./challengeHarness";

test("fit-a-request-in-memory: browser and official replay agree at every tick for both fixes and the near miss", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/memory-lab-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    const d = definition("fit-a-request-in-memory"), near = structuredClone(d.starter!), app = near.resources.find(r => r.id === "app")!;
    near.resources.push({...structuredClone(app), id: "app2", y: app.y + 168});
    near.connectionLines.push({...near.connectionLines[0]!, id: "lb-app2", targetId: "app2"}, {...near.connectionLines[1]!, id: "app2-db", sourceId: "app2"});
    for (const design of [d.starter!, REFERENCE[d.id]!, REFERENCE[`${d.id}-request`]!, near]) {
      const captured = captureRunInputs(design, d.workload, challengeSeed(d)), input = readRunInputs(JSON.parse(JSON.stringify(captured)));
      expect(input).toEqual(captured);
      const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds);
      for (let second = 1; second <= d.evaluationSeconds; second++) {
        browser.advance(); server.advance();
        expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
        expect(server.view().metrics.app!.vmMemory!.resources[0]).toEqual(server.evidence().vmMemory!.resources.find(r => r.id === "app")!);
      }
      const e = server.evidence(), fixed = design === REFERENCE[d.id] || design === REFERENCE[`${d.id}-request`];
      expect(e.vmMemory!.resources.every(r => fixed ? r.allocationRejected === 0 : r.allocationRejected! > 0)).toBe(true);
      expect(server.view().traffic!.wholeRun!.completed).toBe(fixed ? 600 : 0);
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 120000);
