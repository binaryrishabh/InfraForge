import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { definition, REFERENCE } from "./challengeHarness";

test("missions: captured browser and server runs agree through the burst and queue drain", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/missions-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const id of ["catalogue-link-flash", "flash-sale-order-backlog"]) {
      const d = definition(id);
      for (const design of [d.starter!, REFERENCE[id]!]) {
        const captured = captureRunInputs(design, d.workload, challengeSeed(d)), input = readRunInputs(JSON.parse(JSON.stringify(captured)));
        expect(input).toEqual(captured);
        const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds);
        for (let second = 1; second <= d.evaluationSeconds; second++) {
          browser.advance(); server.advance();
          const view = server.view(); expect(browser.view()).toEqual(view);
          // Retained terminal data and selected real state samples have the same source.
          if ([119, 125, 140, d.evaluationSeconds].includes(second)) expect(browser.evidence()).toEqual(server.evidence());
          if (id === "flash-sale-order-backlog") {
            expect(view.metrics.app!.health).toBe("healthy");
            expect(view.traffic!.failedRps).toBe(0);
            expect(view.traffic!.latencyMs.p95!).toBeLessThan(10);
            const q = server.evidence().asynchronous.brokers[0]!;
            expect(view.metrics.queue!.queueWork).toMatchObject({throughSecond: second, originals: q.accepted, acknowledged: q.acknowledged, ready: q.ready, inFlight: q.inFlight, redeliveries: q.redelivered});
          }
          if (second === 119) expect(view.traffic!.offeredRps).toBe(id === "catalogue-link-flash" ? 200 : 4);
          if (second === 125) {
            // Integer-microsecond arrival spacing can place one boundary caller
            // in the adjoining interval; compare both engines exactly above.
            const rate = id === "catalogue-link-flash" ? 800 : 16;
            expect(view.traffic!.offeredRps).toBeGreaterThanOrEqual(rate - 1);
            expect(view.traffic!.offeredRps).toBeLessThanOrEqual(rate);
          }
        }
        expect(server.view().simulatedSeconds).toBe(d.evaluationSeconds);
        expect(server.evidence().workloadVersion).toBeDefined();
      }
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 600000);
