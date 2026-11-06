import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { ResourceHealth } from "@infraforge/domain/resource";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { recordedScenario } from "../challenges/scenario";
import { createModel2Engine } from "../simulator/model2Engine";
import { definition, REFERENCE } from "./challengeHarness";

test("architecture labs: browser and server agree on both valid designs, every tick and exact VM crash receipts", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/architecture-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const [id, alternative] of [["cache-or-database", "capacity"], ["one-vm-or-a-pool", "small"], ["limit-or-capacity", "workers"]]) {
      const d = definition(id!);
      for (const design of [d.starter!, REFERENCE[id!]!, REFERENCE[`${id}-${alternative}`]!]) {
        const captured = captureRunInputs(design, d.workload, challengeSeed(d)), input = readRunInputs(JSON.parse(JSON.stringify(captured)));
        expect(input).toEqual(captured);
        const browser = browserRun(input,d.evaluationSeconds), server = createModel2Engine(input,d.evaluationSeconds), scenario = recordedScenario(d,input);
        let next = 0;
        for (let second = 1; second <= d.evaluationSeconds; second++) {
          browser.advance(); server.advance();
          for (const step of scenario?.steps.filter(s => s.atSecond === second) ?? []) {
            const a = browser.apply({kind: "intervention", parameters: step.request}), b = server.apply({kind: "intervention", parameters: step.request});
            expect(a).toEqual(b); expect(a.outcome.intervention).toEqual(scenario!.receipts[next++]!);
            while (browser.catchingUp) browser.catchUp(10); while (server.catchingUp) server.catchUp(10);
          }
          expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
          if (id === "one-vm-or-a-pool" && second >= 3 && second <= 4) {
            expect(server.view().metrics.app!.health).toBe(ResourceHealth.FAILED);
            expect(server.view().activeChaos.some(f => f.resourceId === "app")).toBe(true);
          }
          if (id === "cache-or-database" && design === REFERENCE[id]) {
            const c = server.evidence().data.caches.find(c => c.id === "cache")!;
            expect(c.hits).toBeGreaterThan(0); expect(c.misses).toBeGreaterThan(0);
            expect(c.logicallyLiveEntries).toBeLessThanOrEqual(16); expect(c.evictions).toBe(0);
            expect(c.hits + c.misses).toBe(c.executedLookups);
          }
        }
        expect(next).toBe(scenario?.steps.length ?? 0);
      }
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 240000);
