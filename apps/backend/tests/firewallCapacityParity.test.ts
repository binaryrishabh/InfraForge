import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs, type ContractBuilder } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { firewallLayout, firewallWorkload } from "./firewallCapacity.fixture";

test("browser-target firewall contracts, real capacity refusals, TLS and listener causes and views equal server replay", async () => {
  const entryPath = resolve(import.meta.dir, `../../../.cache/firewall-capacity-entry-${process.pid}.ts`), browserPath = entryPath.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entryPath), { recursive: true });
  try {
    await writeFile(entryPath, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs, buildModel2Contract } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entryPath, "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const module = await import(pathToFileURL(browserPath).href);
    const browserRun: typeof createModel2Run = module.createModel2Run, browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs;
    const browserBuild: ContractBuilder = module.buildModel2Contract;
    let cases = 0, capacityRefusals = 0;
    for (const two of [false, true]) for (const maxFlows of [undefined, 1, 2, 100000]) {
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(firewallLayout(maxFlows, two), { ...firewallWorkload, targetThroughput: 60000 }, "firewall-capacity-parity"))));
      expect(browserContract(input, 3)).toEqual(buildContractFromRunInputs(input, 3, buildModel2Contract));
      const browser = browserRun(input, 3), server = createModel2Engine(input, 3, buildModel2Contract);
      for (let second = 1; second <= 3; second++) { browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view()); }
      capacityRefusals += browser.evidence().systems.security.events.rows.filter(r => r.detail === "flow-capacity:firewall").length;
      if (maxFlows !== undefined) expect(browser.view().metrics.firewall!.security!.firewall!.limit).toBe(maxFlows);
      cases++;
    }
    for (const scenario of ["fresh", "deny", "no-listener", "tls-required", "tls-valid", "certificate-name", "capacity-only"] as const) {
      const layout = firewallLayout(2);
      if (scenario === "capacity-only") delete layout.resources[2]!.firewallSettings;
      if (scenario === "deny") layout.resources[2]!.firewallSettings!.default = "deny";
      if (scenario === "no-listener") layout.resources[0]!.listenerSettings = { version: 1, ports: [] };
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, { ...firewallWorkload, targetThroughput: 60000 }, "firewall-capacity-parity"))));
      const adjust = (builder: ContractBuilder): ContractBuilder => (design, seconds, seed, profiles) => {
        const result = builder(design, seconds, seed, profiles); if ("refused" in result) return result;
        const contract = result.contract;
        if (scenario === "fresh") for (const transport of Object.values(contract.transports)) transport.pool.reuse = false;
        if (["tls-required", "tls-valid", "certificate-name"].includes(scenario)) {
          const listener = contract.nodes.lb!.listeners[0]!; listener.tls = "required";
          listener.certificate = { names: ["app.example"], issuer: "test-ca", notBefore: contract.arrival.start, notAfter: contract.horizon };
          if (scenario !== "tls-required") contract.caller.security.tls = { mode: "authenticated", serverName: scenario === "certificate-name" ? "wrong.example" : "app.example", trustedIssuers: ["test-ca"] };
        }
        return result;
      };
      const browser = browserRun(input, 3, adjust(browserBuild)), server = createModel2Engine(input, 3, adjust(buildModel2Contract));
      for (let second = 1; second <= 3; second++) { browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view()); }
      const evidence = browser.evidence().systems.security;
      const reason = scenario === "deny" ? "policy-denied:firewall:egress:default" : scenario === "no-listener" ? "no-listener" : scenario === "tls-required" ? "tls-required" : scenario === "certificate-name" ? "certificate-name" : undefined;
      if (reason) expect(evidence.events.rows.some(r => r.detail === reason)).toBe(true);
      if (scenario === "tls-valid") expect(evidence.tlsEstablished).toBeGreaterThan(0);
      if (scenario === "fresh") expect(evidence.events.rows.some(r => r.detail === "flow-capacity:firewall")).toBe(true);
      cases++;
    }
    expect(capacityRefusals).toBeGreaterThan(0);
    console.info("firewall-capacity-browser-server-parity", JSON.stringify({ cases, simulatedSecondsPerCase: 3, capacityRefusals }));
  } finally { for (const path of [entryPath, browserPath]) if (await Bun.file(path).exists()) await unlink(path); }
});
