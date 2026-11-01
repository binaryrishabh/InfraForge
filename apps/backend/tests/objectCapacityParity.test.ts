import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { objectLayout, objectModes, objectWorkload } from "./objectCapacity.fixture";

test("browser-target object capacity contracts, byte ownership, refusals and live views equal server replay", async () => {
  const entryPath = resolve(import.meta.dir, `../../../.cache/object-capacity-entry-${process.pid}.ts`), browserPath = entryPath.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entryPath), { recursive: true });
  try {
    await writeFile(entryPath, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entryPath, "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const module = await import(pathToFileURL(browserPath).href);
    const browserRun: typeof createModel2Run = module.createModel2Run, browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs;
    let cases = 0, capacityRefusals = 0;
    for (const mode of objectModes) for (const capacityMiB of [undefined, 1, 2, ...(mode === "plain" ? [8589934591] : [])]) {
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(objectLayout(mode, capacityMiB), objectWorkload(mode), "object-capacity-parity"))));
      expect(browserContract(input, 30)).toEqual(buildContractFromRunInputs(input, 30, buildModel2Contract));
      const browser = browserRun(input, 30), server = createModel2Engine(input, 30, buildModel2Contract);
      for (let second = 1; second <= 30; second++) {
        browser.advance(); server.advance();
        expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view());
      }
      capacityRefusals += browser.evidence().asynchronous.objects.find(s => s.id === "store")!.service.reasons["object-capacity"] ?? 0;
      cases++;
    }
    expect(capacityRefusals).toBeGreaterThan(0);
    console.info("object-capacity-browser-server-parity", JSON.stringify({ cases, simulatedSecondsPerCase: 30, capacityRefusals }));
  } finally { for (const path of [entryPath, browserPath]) if (await Bun.file(path).exists()) await unlink(path); }
});
