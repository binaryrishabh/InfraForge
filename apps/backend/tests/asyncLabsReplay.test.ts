import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { QueueWorkSchema } from "../reports/queueWorkSchema";
import { definition, REFERENCE } from "./challengeHarness";

test("async labs: browser and server agree each second; captured queue populations equal actual broker and worker state", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/async-labs-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text();
    if (await build.exited !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const id of ["keep-up-with-the-queue", "leave-time-to-acknowledge", "open-one-subscriber"]) {
      const d = definition(id);
      for (const design of [d.starter!, REFERENCE[id]!]) {
        const captured = captureRunInputs(design, d.workload, challengeSeed(d)), input = readRunInputs(JSON.parse(JSON.stringify(captured)));
        expect(input).toEqual(captured);
        const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds, buildModel2Contract);
        for (let second = 1; second <= d.evaluationSeconds; second++) {
          browser.advance(); server.advance();
          expect(browser.view()).toEqual(server.view());
          const evidence = server.evidence(); expect(browser.evidence()).toEqual(evidence);
          for (const q of evidence.asynchronous.brokers) {
            const work = server.view().metrics[q.id]!.queueWork!;
            expect(QueueWorkSchema.parse(work)).toEqual(work);
            const workers = evidence.asynchronous.workers.filter(w => w.id === "worker" && q.id === "queue" || w.id === "worker2" && q.id === "queue2");
            expect(work).toEqual({version: 1, throughSecond: second, originals: q.accepted, deliveries: q.deliveries,
              acknowledged: q.acknowledged, effects: workers.reduce((sum, w) => sum + w.effects, 0),
              ready: q.ready, inFlight: q.inFlight, scheduled: q.scheduled, redeliveries: q.redelivered,
              deadLettered: q.deadLettered, discarded: q.discarded, expired: q.expired});
          }
          if (id === "leave-time-to-acknowledge" && second === 1) expect(server.view().metrics.queue!.queueWork).toMatchObject({originals: 1, effects: 1, acknowledged: 0, inFlight: 1});
        }
        if (id === "leave-time-to-acknowledge") {
          const e = server.evidence(), original = design === d.starter;
          expect(e.asynchronous.objects[0]!.replacedObjects).toBe(original ? 4 : 0);
          expect(e.asynchronous.brokers[0]!.staleReceipts).toBe(original ? 6 : 0);
        }
      }
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 120000);
