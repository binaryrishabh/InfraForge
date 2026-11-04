import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { dnsLayout, dnsWorkload } from "./dnsDepth.fixture";

test("browser-target DNS resolver cache contracts, evidence, faults and live views equal server replay", async () => {
  const entryPath = resolve(import.meta.dir, `../../../.cache/dns-depth-entry-${process.pid}.ts`), browserPath = entryPath.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entryPath), { recursive: true });
  try {
    await writeFile(entryPath, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entryPath, "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const browserModule = await import(pathToFileURL(browserPath).href), createBrowserRun: typeof createModel2Run = browserModule.createModel2Run;
    const buildBrowserContract: typeof buildContractFromRunInputs = browserModule.buildContractFromRunInputs;
    let cases = 0;
    for (const mode of ["vm", "cdn"] as const) for (const ttl of [undefined, 1, 60, 3600]) for (const scenario of ["healthy", "dns-outage", "endpoint-outage"] as const) {
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(dnsLayout(ttl, mode), dnsWorkload, "dns-depth-parity"))));
      expect(buildBrowserContract(input, 12)).toEqual(buildContractFromRunInputs(input, 12, buildModel2Contract));
      const browser = createBrowserRun(input, 12), server = createModel2Engine(input, 12, buildModel2Contract);
      for (let second = 1; second <= 12; second++) {
        browser.advance(); server.advance();
        if (second === 1 && scenario !== "healthy") {
          const action = { kind: "chaos" as const, parameters: { type: DeploymentChaosNames.Crash, resourceId: scenario === "dns-outage" ? "dns" : "app" } };
          expect(browser.apply(action)).toEqual(server.apply(action));
          while (browser.catchingUp) browser.catchUp(10);
          while (server.catchingUp) server.catchUp(10);
        }
        expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view());
      }
      const resolver = browser.evidence().systems.resolvers[0]!;
      if (scenario === "healthy") {
        expect(browser.evidence().counts.completed).toBe(24);
        expect(resolver.queries).toBe(1); // Established sessions do not re-resolve on expiry.
        expect(resolver.expirations > 0).toBe(ttl === 1);
      }
      cases++;
    }
    console.info("dns-depth-browser-server-parity", JSON.stringify({ cases, simulatedSecondsPerCase: 12 }));
  } finally { for (const path of [entryPath, browserPath]) if (await Bun.file(path).exists()) await unlink(path); }
});
