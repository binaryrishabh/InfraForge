import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { definition, REFERENCE } from "./challengeHarness";

test("depth labs: browser bundle and server replay agree on every tick and retained resource counter", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/depth-labs-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const id of ["protect-one-api-route", "queue-overlapping-jobs", "bound-function-pool-pressure"]) {
      const d = definition(id);
      for (const design of [d.starter!, REFERENCE[id]!]) {
        const captured = captureRunInputs(design, d.workload, challengeSeed(d)), input = readRunInputs(JSON.parse(JSON.stringify(captured)));
        expect(input).toEqual(captured);
        const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds);
        for (let second = 1; second <= d.evaluationSeconds; second++) {
          browser.advance(); server.advance();
          expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
          const view = server.view(), raw = server.evidence().asynchronous;
          if (id === "protect-one-api-route") expect(view.metrics.gateway!.gateway).toMatchObject({received: raw.gateways![0]!.received, admitted: raw.gateways![0]!.admitted, completed: raw.gateways![0]!.completed});
          else if (id === "queue-overlapping-jobs") expect(view.metrics.timer!.scheduler).toMatchObject({due: raw.schedulers![0]!.due, completed: raw.schedulers![0]!.completed, missed: raw.schedulers![0]!.missed});
          else expect(view.metrics.fn!.serverless).toMatchObject({coldStarts: raw.functions![0]!.coldStarts, completed: raw.functions![0]!.completed, throttled: raw.functions![0]!.throttled});
        }
      }
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 120000);
