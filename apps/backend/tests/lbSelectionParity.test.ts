import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { selectionLayout } from "./lbSelection.test";

test("browser build and server replay match each second for both saved selection policies", async () => {
  const browserPath = resolve(import.meta.dir, `../../../.cache/lb-selection-browser-${process.pid}.mjs`);
  await mkdir(dirname(browserPath), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text();
    if (await build.exited !== 0) throw Error(diagnostics);
    const createBrowserRun: typeof createModel2Run = (await import(pathToFileURL(browserPath).href)).createModel2Run;
    for (const policy of ["round-robin", "least-outstanding"] as const) {
      const workload = { targetThroughput: 12000, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(selectionLayout(policy), workload, "selection-parity"))));
      expect(buildContractFromRunInputs(input, 3)).toEqual(buildContractFromRunInputs(input, 3, buildModel2Contract));
      const browser = createBrowserRun(input, 3), server = createModel2Engine(input, 3, buildModel2Contract);
      for (let second = 0; second < 3; second++) {
        browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view());
      }
      expect(browser.evidence().network.loadBalancers[0]!.attempts).toBeGreaterThan(0);
    }
  } finally { if (await Bun.file(browserPath).exists()) await unlink(browserPath); }
});
