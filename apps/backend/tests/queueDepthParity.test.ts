import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { capacityLayout, capacityWorkload } from "./queueCapacity.fixture";

test("browser-target delay captures, effect accounting, failure recovery and live readings equal server replay", async () => {
  const entryPath = resolve(import.meta.dir, `../../../.cache/queue-depth-entry-${process.pid}.ts`), browserPath = entryPath.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entryPath), { recursive: true });
  try {
    await writeFile(entryPath, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entryPath, "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const module = await import(pathToFileURL(browserPath).href), browserRun: typeof createModel2Run = module.createModel2Run;
    const browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs;
    for (const mode of ["old", "zero", "delayed", "long", "crash", "idempotent", "poison", "parallel"] as const) {
      const layout = capacityLayout(3), worker = layout.resources.find(r => r.id === "worker")!, queue = layout.resources.find(r => r.id === "queue")!;
      if (mode !== "old") worker.asyncWorker!.acknowledgementDelayMs = mode === "zero" ? 0 : 2000;
      queue.asyncQueue!.visibilityTimeoutSeconds = mode === "long" || mode === "crash" ? 5 : 1;
      if (mode === "idempotent") worker.asyncWorker!.idempotentResults = true;
      if (mode === "poison") worker.asyncWorker!.badJobPercent = 100;
      if (mode === "parallel") { worker.size = "medium"; worker.asyncWorker!.concurrency = 2; worker.asyncWorker!.prefetch = 4; }
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, { ...capacityWorkload, targetThroughput: mode === "parallel" ? 480 : 6 }, "queue-depth-parity"))));
      expect(browserContract(input, 9)).toEqual(buildContractFromRunInputs(input, 9, buildModel2Contract));
      const browser = browserRun(input, 9), server = createModel2Engine(input, 9, buildModel2Contract);
      for (let second = 1; second <= 9; second++) {
        browser.advance(); server.advance();
        if (mode === "crash" && second === 1) {
          const action = { kind: "intervention" as const, parameters: { interventionId: "consumer-outage", revision: 1, target: { resourceId: "worker" }, parameters: { duration: 2 } } };
          expect(browser.apply(action)).toEqual(server.apply(action));
          while (browser.catchingUp) browser.catchUp(10);
          while (server.catchingUp) server.catchUp(10);
        }
        expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view());
        const e = browser.evidence().asynchronous;
        expect(e.brokers[0]!.messages.length).toBeLessThanOrEqual(3);
        expect(e.workers[0]!.active).toBeLessThanOrEqual(mode === "parallel" ? 2 : 1);
        expect(e.workers[0]!.creditOwnedLocally).toBeLessThanOrEqual(mode === "parallel" ? 4 : 1);
      }
      const e = browser.evidence().asynchronous, q = e.brokers[0]!, w = e.workers[0]!;
      if (["old", "zero", "long"].includes(mode)) expect(q).toMatchObject({ accepted: 1, deliveries: 1, acknowledged: 1, deadLettered: 0 });
      if (mode === "delayed" || mode === "idempotent") {
        expect(q).toMatchObject({ accepted: 1, deliveries: 3, acknowledged: 0, deadLettered: 1 });
        expect(w.effects).toBe(mode === "idempotent" ? 1 : 3);
        expect(e.objects[0]!.replacedObjects).toBe(mode === "idempotent" ? 0 : 2);
      }
      if (mode === "crash") { expect(q).toMatchObject({ accepted: 1, deliveries: 2, acknowledged: 1 }); expect(w).toMatchObject({ lostOnCrash: 1, effects: 2, available: true }); }
      if (mode === "poison") { expect(q).toMatchObject({ deadLettered: 1, nacked: 3, leaseExpired: 0 }); expect(w.effects).toBe(0); }
      if (mode === "parallel") expect(q.rejectedPublishes).toBeGreaterThan(0);
    }
    console.info("queue-depth-browser-server-parity", JSON.stringify({ cases: 8, simulatedSecondsPerCase: 9 }));
  } finally { for (const path of [entryPath, browserPath]) if (await Bun.file(path).exists()) await unlink(path); }
});
