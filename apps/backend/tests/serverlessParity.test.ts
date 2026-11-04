import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { functionLayout, functionWorkload } from "./serverless.fixture";

test("browser bundle and server replay agree for function reuse, expiry, throttle, timeout, failure and database pressure", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/serverless-${process.pid}.ts`), output = entry.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entry), { recursive: true });
  try {
    await writeFile(entry, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entry, "--target=browser", "--outfile", output], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited) throw Error(diagnostics);
    const module = await import(pathToFileURL(output).href), browserRun: typeof createModel2Run = module.createModel2Run, browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs;
    for (const mode of ["healthy", "expire", "throttle", "timeout", "failure", "database"] as const) {
      const layout = functionLayout(), policy = layout.resources[0]!.serverless!;
      if (mode === "expire") { policy.durationMs = 10; policy.initializationMs = 10; policy.idleExpiryMs = 1; }
      if (mode === "throttle") policy.concurrency = 1;
      if (mode === "timeout") policy.timeoutMs = 1;
      if (mode === "failure") policy.failurePercent = 100;
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, functionWorkload, "function-parity"))));
      expect(browserContract(input, 3)).toEqual(buildContractFromRunInputs(input, 3, buildModel2Contract));
      const browser = browserRun(input, 3), server = createModel2Engine(input, 3, buildModel2Contract);
      if (mode === "database") {
        const action = { kind: "intervention" as const, parameters: { interventionId: "session-capacity", revision: 1, target: { resourceId: "db" }, parameters: { sessions: 1, duration: 2 } } };
        expect(browser.apply(action)).toEqual(server.apply(action));
      }
      for (let second = 1; second <= 3; second++) { browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view()); }
      const e = browser.evidence().asynchronous.functions![0]!;
      expect(browser.view().metrics.fn!.serverless!.completed).toBe(e.completed);
      expect(browser.view().metrics.fn!.cpu).toBeNull(); expect(browser.view().metrics.fn!.memory).toBeNull();
      if (mode === "healthy") { expect(e.completed).toBeGreaterThan(0); expect(e.warmStarts).toBeGreaterThan(0); }
      if (mode === "expire") expect(e.expired).toBeGreaterThan(0);
      if (mode === "throttle") expect(e.throttled).toBeGreaterThan(0);
      if (mode === "timeout") expect(e.timedOut).toBeGreaterThan(0);
      if (mode === "failure") expect(e.failed).toBeGreaterThan(0);
      if (mode === "database") { expect(e.downstreamFailed).toBeGreaterThan(0); expect(browser.evidence().data.databases[0]!.sessionEvents!.refused).toBeGreaterThan(0); }
    }
  } finally { for (const path of [entry, output]) if (await Bun.file(path).exists()) await unlink(path); }
});
