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

test("browser-target queue capacity contracts, evidence and live views equal server replay each second", async () => {
  const entryPath = resolve(import.meta.dir, `../../../.cache/queue-capacity-entry-${process.pid}.ts`), browserPath = entryPath.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entryPath), { recursive: true });
  try {
    await writeFile(entryPath, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entryPath, "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const browserModule = await import(pathToFileURL(browserPath).href), createBrowserRun: typeof createModel2Run = browserModule.createModel2Run;
    const buildBrowserContract: typeof buildContractFromRunInputs = browserModule.buildContractFromRunInputs;
    for (const publishFlow of [false, true]) for (const capacity of [undefined, 1, 3, 100, 100000]) {
      const workload = { ...capacityWorkload, readWriteRatio: publishFlow ? 0 : capacityWorkload.readWriteRatio };
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(capacityLayout(capacity, publishFlow), workload, "queue-capacity-parity"))));
      expect(buildBrowserContract(input, 12)).toEqual(buildContractFromRunInputs(input, 12, buildModel2Contract));
      const browser = createBrowserRun(input, 12), server = createModel2Engine(input, 12, buildModel2Contract);
      for (let second = 1; second <= 12; second++) {
        browser.advance(); server.advance();
        const e = browser.evidence(); expect(e).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view());
        const q = e.asynchronous.brokers[0]!;
        expect(q.ready + q.inFlight + q.scheduled).toBeLessThanOrEqual(capacity ?? 1000);
      }
      const q = browser.evidence().asynchronous.brokers[0]!;
      if (capacity !== undefined && capacity <= 3) expect(q.rejectedPublishes).toBeGreaterThan(0);
      else expect(q.rejectedPublishes).toBe(0);
    }
  } finally { for (const path of [entryPath, browserPath]) if (await Bun.file(path).exists()) await unlink(path); }
});
