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

test("beginner onramps replay identically in browser and server, including waiting age and crash routing", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/beginner-onramps-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const id of ["keep-waiting-work", "check-the-missing-server"]) {
      const d = definition(id);
      for (const design of [d.starter!, REFERENCE[id]!]) {
        const captured = captureRunInputs(design, d.workload, challengeSeed(d)), input = readRunInputs(JSON.parse(JSON.stringify(captured)));
        expect(input).toEqual(captured);
        const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds), scenario = recordedScenario(d, input);
        let next = 0;
        for (let second = 1; second <= d.evaluationSeconds; second++) {
          browser.advance(); server.advance();
          for (const step of scenario?.steps.filter(s => s.atSecond === second) ?? []) {
            const a = browser.apply({kind: "intervention", parameters: step.request}), b = server.apply({kind: "intervention", parameters: step.request});
            expect(a).toEqual(b); expect(a.outcome.intervention).toEqual(scenario!.receipts[next++]!);
            while (browser.catchingUp) browser.catchUp(10); while (server.catchingUp) server.catchUp(10);
          }
          expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
          if (id === "keep-waiting-work") {
            const broker = server.evidence().asynchronous.brokers[0]!, metric = server.view().metrics.queue!;
            expect(metric.queueWork!.ready).toBe(broker.ready); expect(metric.queueWork!.expired).toBe(broker.expired);
            expect(metric.asyncQueue!.readyDepth).toBe(broker.ready);
            expect(metric.asyncQueue!.oldestReadyAgeSeconds).toBe(broker.oldestReadyAgeUs === null ? null : broker.oldestReadyAgeUs / 1_000_000);
            if (design === REFERENCE[id] && second === 140) {
              expect(broker.ready).toBeGreaterThan(30); expect(metric.asyncQueue!.oldestReadyAgeSeconds!).toBeGreaterThan(8);
            }
            if (second === 119) expect(broker.ready).toBe(0);
            if (design === REFERENCE[id]) expect(broker.rejectedPublishes).toBe(0);
          } else if (second === 6) {
            expect(server.view().metrics.app!.health).toBe(ResourceHealth.FAILED);
            // Enough survivor CPU in both runs: routing eligibility, not sizing, changes who gets served.
            expect(server.view().metrics.peer!.cpu).toBe(design === REFERENCE[id] ? 15 : 7.5);
          }
        }
        expect(next).toBe(scenario?.steps.length ?? 0);
      }
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 120000);
