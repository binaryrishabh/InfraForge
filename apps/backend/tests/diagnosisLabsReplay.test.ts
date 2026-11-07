import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { definition, REFERENCE } from "./challengeHarness";

test("diagnose-query-admission: browser and server replay every tick, including the failing near miss", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/diagnosis-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    const d = definition("diagnose-query-admission"), near = structuredClone(d.starter!);
    near.resources.find(r => r.id === "db")!.skuId = "db.m5.xlarge";
    for (const design of [d.starter!, REFERENCE[d.id]!, near]) {
      const captured = captureRunInputs(design, d.workload, challengeSeed(d)), input = readRunInputs(JSON.parse(JSON.stringify(captured)));
      expect(input).toEqual(captured);
      const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds);
      for (let second = 1; second <= d.evaluationSeconds; second++) {
        browser.advance(); server.advance();
        expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
      }
      const metrics = server.view().metrics.db!;
      expect(metrics.database!.waiting).toBe(0); expect(metrics.database!.sessionRefused).toBe(0);
      expect(metrics.database!.queued).toBe(design === REFERENCE[d.id] ? 0 : 9);
      const database = server.evidence().data.databases.find(r => r.id === "db")!;
      expect(metrics.database!.queued).toBe(database.queued);
      expect(database.active.filter(query => query.phase !== "lock").length).toBe(metrics.database!.serving!);
      // Queued transactions still own sessions; connection acquisition wait itself is not asserted.
      expect(database.sessions.active).toBe(database.queued + database.active.length);
      expect(database.sessions.total).toBe(metrics.connections!);
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 120000);
