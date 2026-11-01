import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DeploymentChaosNames, type MonitoringPolicy } from "@infraforge/domain/resource";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { monitoringLayout, monitoringWorkload } from "./monitoringCadence.fixture";

const policies: MonitoringPolicy[] = [
  { version: 2, bufferSamples: 1, batchSamples: 1, exportAttempts: 1 },
  { version: 2, bufferSamples: 4, batchSamples: 2, exportAttempts: 3, collectionIntervalSeconds: 1, exportIntervalSeconds: 60 },
  { version: 2, bufferSamples: 8192, batchSamples: 8192, exportAttempts: 10, collectionIntervalSeconds: 1, exportIntervalSeconds: 1 },
];
test("browser-target buffer contracts, evidence, outages and live views equal server replay", async () => {
  const entryPath = resolve(import.meta.dir, `../../../.cache/monitor-buffer-entry-${process.pid}.ts`), browserPath = entryPath.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entryPath), { recursive: true });
  try {
    await writeFile(entryPath, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entryPath, "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const module = await import(pathToFileURL(browserPath).href);
    const browserRun: typeof createModel2Run = module.createModel2Run, browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs;
    let cases = 0;
    for (const multiple of [false, true]) for (const policy of policies) for (const scenario of ["healthy", "target-outage", "agent-outage"] as const) {
      const layout = monitoringLayout(policy, multiple);
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, monitoringWorkload, "monitor-buffer-parity"))));
      expect(browserContract(input, 65)).toEqual(buildContractFromRunInputs(input, 65, buildModel2Contract));
      const browser = browserRun(input, 65), server = createModel2Engine(input, 65, buildModel2Contract);
      for (let second = 1; second <= 65; second++) {
        browser.advance(); server.advance();
        if (second === 15 && scenario !== "healthy") {
          const action = { kind: "chaos" as const, parameters: { type: DeploymentChaosNames.Crash, resourceId: scenario === "target-outage" ? "vm" : "monitor" } };
          expect(browser.apply(action)).toEqual(server.apply(action));
          while (browser.catchingUp) browser.catchUp(10);
          while (server.catchingUp) server.catchUp(10);
        }
        expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view());
      }
      cases++;
    }
    console.info("monitor-buffer-browser-server-parity", JSON.stringify({ cases, simulatedSecondsPerCase: 65 }));
  } finally { for (const path of [entryPath, browserPath]) if (await Bun.file(path).exists()) await unlink(path); }
});
