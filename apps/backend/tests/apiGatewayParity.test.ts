import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { gatewayLayout, gatewayWorkload } from "./apiGateway.fixture";
test("browser gateway routing, throttles, missing routes, validation and failures equal official replay", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/gateway-${process.pid}.ts`), output = entry.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entry), { recursive: true });
  try {
    await writeFile(entry, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entry, "--target=browser", "--outfile", output], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited) throw Error(diagnostics);
    const module = await import(pathToFileURL(output).href), browserRun: typeof createModel2Run = module.createModel2Run, browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs;
    for (const scenario of ["healthy", "throttle", "missing", "failed", "invalid"] as const) {
      const layout = gatewayLayout(scenario === "throttle" ? 1 : 100);
      if (scenario === "failed") layout.resources[1]!.listenerSettings = { version: 1, ports: [] };
      if (scenario === "missing") layout.resources[0]!.apiGateway!.routes![0]!.path = "/other";
      if (scenario === "invalid") layout.resources[0]!.apiGateway!.maxRequestBytes = 1023;
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, gatewayWorkload, "gateway-parity"))));
      expect(browserContract(input, 2)).toEqual(buildContractFromRunInputs(input, 2, buildModel2Contract));
      const browser = browserRun(input, 2), server = createModel2Engine(input, 2, buildModel2Contract);
      for (let second = 1; second <= 2; second++) { browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view()); }
      const e = browser.evidence(), g = e.asynchronous.gateways![0]!;
      if (scenario === "healthy") expect(g.completed).toBe(20);
      if (scenario === "throttle") expect(g.throttled).toBe(8);
      if (scenario === "failed") expect(g.upstreamFailed).toBe(10);
      if (scenario === "missing") expect(g.missingRoute).toBe(10);
      if (scenario === "invalid") expect(g.invalid).toBe(20);
      expect(e.resources.find(r => r.id === "writeApp")!.completed).toBe(scenario === "invalid" ? 0 : 10);
    }
  } finally { for (const path of [entry, output]) if (await Bun.file(path).exists()) await unlink(path); }
});
