import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { definition, REFERENCE } from "./challengeHarness";

test("service missions: captured browser and server runs agree second by second, including bad-request failures and refused publishes", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/missions-services-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const id of ["notification-retry-storm", "analytics-burst-buffer"]) {
      const d = definition(id);
      for (const design of [d.starter!, REFERENCE[id]!]) {
        const captured = captureRunInputs(design, d.workload, challengeSeed(d)), input = readRunInputs(JSON.parse(JSON.stringify(captured)));
        expect(input).toEqual(captured);
        const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds);
        let sawFailure = false;
        for (let second = 1; second <= d.evaluationSeconds; second++) {
          browser.advance(); server.advance();
          const view = server.view(); expect(browser.view()).toEqual(view);
          if ([10, 30, 125, 140, d.evaluationSeconds].includes(second) || second === d.evaluationSeconds) expect(browser.evidence()).toEqual(server.evidence());
          const q = server.evidence().asynchronous.brokers[0]!;
          expect(view.metrics.queue!.queueWork).toMatchObject({throughSecond: second, originals: q.accepted, acknowledged: q.acknowledged, ready: q.ready, inFlight: q.inFlight, redeliveries: q.redelivered});
          if ((view.traffic!.failedRps ?? 0) > 0) sawFailure = true;
        }
        expect(server.view().simulatedSeconds).toBe(d.evaluationSeconds);
        // The burst mission's starter is the only one whose producer fails; replay must carry that failure identically.
        expect(sawFailure).toBe(id === "analytics-burst-buffer" && design === d.starter);
      }
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 900000);
