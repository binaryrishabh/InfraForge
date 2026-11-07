import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { QueueWorkSchema } from "../reports/queueWorkSchema";
import { definition, REFERENCE } from "./challengeHarness";

test("diagnose-consumer-credit: browser and replay agree every tick; live age and ack wait prove the mechanism", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/consumer-diagnosis-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    const d = definition("diagnose-consumer-credit"), near = structuredClone(d.starter!), buffer = structuredClone(d.starter!);
    near.resources.find(r => r.id === "queue")!.asyncQueue!.visibilityTimeoutSeconds = 60;
    buffer.resources.find(r => r.id === "queue")!.asyncQueue!.capacityMessages = 5000;
    for (const design of [d.starter!, REFERENCE[d.id]!, near, buffer]) {
      const captured = captureRunInputs(design, d.workload, challengeSeed(d)), input = readRunInputs(JSON.parse(JSON.stringify(captured)));
      expect(input).toEqual(captured);
      const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds);
      const fixed = design === REFERENCE[d.id]; let earlierAge = 0, earlierReady = 0;
      for (let second = 1; second <= d.evaluationSeconds; second++) {
        browser.advance(); server.advance();
        expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
        const e = server.evidence(), q = e.asynchronous.brokers[0]!, w = e.asynchronous.workers[0]!, metrics = server.view().metrics.queue!;
        expect(QueueWorkSchema.parse(metrics.queueWork)).toEqual(metrics.queueWork!);
        expect(metrics.queueWork).toMatchObject({originals: q.accepted, deliveries: q.deliveries, acknowledged: q.acknowledged,
          ready: q.ready, inFlight: q.inFlight, scheduled: q.scheduled, redeliveries: q.redelivered, effects: w.effects});
        expect(q.rejectedPublishes).toBe(0); expect(q.redelivered).toBe(0); expect(q.leaseExpired).toBe(0);
        expect(q.consumers[0]!.outstanding).toHaveLength(w.creditOwnedLocally);
        expect(q.oldestReadyAgeUs).toBe(q.ready ? Math.max(...q.messages.filter(m => m.state === "ready").map(m => second * 1_000_000 - m.acceptedAt)) : null);
        if (second === 4) { earlierAge = q.oldestReadyAgeUs ?? 0; earlierReady = q.ready; }
        if (second === 12) {
          expect(w.local.every(p => p.phase === "ack-wait")).toBe(true);
          expect(w.active).toBe(0); expect(w.creditOwnedLocally).toBe(fixed ? 12 : 1);
          expect(q.acknowledged).toBe(fixed ? 84 : 7);
          if (fixed) { expect(q.ready).toBe(0); expect(q.oldestReadyAgeUs).toBeNull(); }
          else { expect(q.ready).toBeGreaterThan(earlierReady); expect(q.oldestReadyAgeUs!).toBeGreaterThan(earlierAge); expect(q.oldestReadyAgeUs!).toBeGreaterThan(10_000_000); }
          console.info(JSON.stringify({lab: d.id, variant: fixed ? "reference" : design === near ? "longer-visibility" : design === buffer ? "larger-buffer" : "starter",
            second, earlierAgeUs: earlierAge, oldestReadyAgeUs: q.oldestReadyAgeUs, localPhases: w.local.map(p => p.phase), creditOwned: w.creditOwnedLocally}));
        }
      }
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 120000);
