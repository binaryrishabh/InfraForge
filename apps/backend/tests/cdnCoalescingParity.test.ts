import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DeploymentChaosNames, type CdnCachePolicy } from "@infraforge/domain/resource";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { cdnLayout, cdnWorkload } from "./cdnTtl.fixture";

const policies: CdnCachePolicy[] = [{ version: 2, coalesce: true }, { version: 2, coalesce: false }, { version: 2, coalesce: true, maxWaiters: 3 }];
test("proof 20: browser-target coalescing contracts, evidence, faults and live views equal server replay", async () => {
  const entryPath = resolve(import.meta.dir, `../../../.cache/cdn-coalescing-entry-${process.pid}.ts`), browserPath = entryPath.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entryPath), { recursive: true });
  try {
    await writeFile(entryPath, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entryPath, "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const module = await import(pathToFileURL(browserPath).href);
    const browserRun: typeof createModel2Run = module.createModel2Run, browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs;
    let cases = 0;
    for (const mode of ["repeated", "dns"] as const) for (const policy of policies) for (const ttlSeconds of [undefined, 1]) for (const scenario of ["healthy", "outage", "purge"] as const) {
      const layout = cdnLayout(undefined, mode); layout.resources[0]!.cdnCachePolicy = { ...policy, ...(ttlSeconds === undefined ? {} : { ttlSeconds }) };
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, cdnWorkload, "cdn-coalescing-parity"))));
      expect(browserContract(input, 12)).toEqual(buildContractFromRunInputs(input, 12, buildModel2Contract));
      const browser = browserRun(input, 12), server = createModel2Engine(input, 12, buildModel2Contract);
      for (let second = 1; second <= 12; second++) {
        browser.advance(); server.advance();
        if (second === 1 && scenario !== "healthy") {
          const action = { kind: "chaos" as const, parameters: { type: DeploymentChaosNames.Crash, resourceId: scenario === "outage" ? "store" : "cdn" } };
          expect(browser.apply(action)).toEqual(server.apply(action));
          while (browser.catchingUp) browser.catchUp(10);
          while (server.catchingUp) server.catchUp(10);
        }
        expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view());
      }
      cases++;
    }
    console.info("cdn-coalescing-browser-server-parity", JSON.stringify({ cases, simulatedSecondsPerCase: 12 }));
  } finally { for (const path of [entryPath, browserPath]) if (await Bun.file(path).exists()) await unlink(path); }
});
