import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { idempotencyLayout, idempotencyWorkload } from "./queueIdempotency.fixture";

test("browser-target result write contracts, evidence, actions and live views equal server replay", async () => {
  const entryPath = resolve(import.meta.dir, `../../../.cache/queue-idempotency-entry-${process.pid}.ts`), browserPath = entryPath.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entryPath), { recursive: true });
  try {
    await writeFile(entryPath, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entryPath, "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const browserModule = await import(pathToFileURL(browserPath).href), createBrowserRun: typeof createModel2Run = browserModule.createModel2Run;
    const buildBrowserContract: typeof buildContractFromRunInputs = browserModule.buildContractFromRunInputs;
    let cases = 0;
    for (const mode of ["normal", "visibility", "poison", "outage", "parallel", "capacity", "publish-flow"] as const) for (const enabled of [undefined, false, true]) {
      const layout = idempotencyLayout(enabled, mode === "publish-flow", mode === "capacity" || mode === "publish-flow" ? 3 : undefined);
      const worker = layout.resources.find(r => r.id === "worker")!, queue = layout.resources.find(r => r.id === "queue")!;
      if (mode === "visibility") { queue.asyncQueue!.visibilityTimeoutSeconds = 1; worker.asyncWorker!.cpuMsPerJob = 1500; }
      if (mode === "outage") queue.asyncQueue!.visibilityTimeoutSeconds = 2;
      if (mode === "poison") { worker.asyncWorker!.badJobPercent = 100; queue.asyncQueue!.deadLetterCapacity = 2; }
      if (mode === "parallel") { worker.size = "medium"; worker.asyncWorker!.concurrency = 2; worker.asyncWorker!.prefetch = 4; }
      const workload = { ...idempotencyWorkload, targetThroughput: mode === "visibility" ? 6 : 480, readWriteRatio: mode === "publish-flow" ? 0 : idempotencyWorkload.readWriteRatio };
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, workload, "queue-idempotency-parity"))));
      expect(buildBrowserContract(input, 12)).toEqual(buildContractFromRunInputs(input, 12, buildModel2Contract));
      const browser = createBrowserRun(input, 12), server = createModel2Engine(input, 12, buildModel2Contract);
      for (let second = 1; second <= 12; second++) {
        browser.advance(); server.advance();
        if (mode === "outage" && second === 1) {
          const action = { kind: "intervention" as const, parameters: { interventionId: "consumer-outage", revision: 1, target: { resourceId: "worker" }, parameters: { duration: 5 } } };
          expect(browser.apply(action)).toEqual(server.apply(action));
          while (browser.catchingUp) browser.catchUp(10);
          while (server.catchingUp) server.catchUp(10);
        }
        expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view());
        const e = browser.evidence().asynchronous;
        expect(e.workers[0]!.active).toBeLessThanOrEqual(mode === "parallel" ? 2 : 1);
        expect(e.workers[0]!.creditOwnedLocally).toBeLessThanOrEqual(mode === "parallel" ? 4 : 1);
        if (mode === "outage" && second === 3) expect(e.workers[0]!.available).toBe(false);
      }
      const e = browser.evidence().asynchronous;
      if (mode === "visibility") {
        expect(e.brokers[0]!.redelivered).toBeGreaterThan(0);
        if (enabled) expect(e.workers[0]!.deduplicated).toBeGreaterThan(0);
        else expect(e.objects[0]!.replacedObjects).toBeGreaterThan(0);
      }
      if (mode === "capacity" || mode === "publish-flow") expect(e.brokers[0]!.rejectedPublishes).toBeGreaterThan(0);
      if (mode === "poison") { expect(e.workers[0]!.effects).toBe(0); expect(e.workers[0]!.deduplicated).toBe(0); expect(e.brokers[0]!.deadLettered).toBe(2); }
      if (mode === "outage") expect(e.workers[0]!.available).toBe(true);
      cases++;
    }
    console.info("queue-idempotency-browser-server-parity", JSON.stringify({ cases, simulatedSecondsPerCase: 12 }));
  } finally { for (const path of [entryPath, browserPath]) if (await Bun.file(path).exists()) await unlink(path); }
});
