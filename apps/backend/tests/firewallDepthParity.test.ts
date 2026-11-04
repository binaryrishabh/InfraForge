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

test("browser bundle and server replay agree through firewall expiry, deny, recovery and capacity refusals", async () => {
  const entryPath = resolve(import.meta.dir, `../../../.cache/firewall-depth-entry-${process.pid}.ts`), browserPath = entryPath.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entryPath), { recursive: true });
  try {
    await writeFile(entryPath, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs, buildModel2Contract } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entryPath, "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const module = await import(pathToFileURL(browserPath).href);
    const browserRun: typeof createModel2Run = module.createModel2Run, browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs, browserBuild: ContractBuilder = module.buildModel2Contract;
    const completed: number[] = [];
    for (const idle of [1, 5]) {
      const layout = firewallLayout(1); layout.resources[2]!.firewallState = { version: 1, idleTimeoutSeconds: idle };
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, { ...firewallWorkload, targetThroughput: 30 }, "firewall-depth-parity"))));
      expect(browserContract(input, 8)).toEqual(buildContractFromRunInputs(input, 8, buildModel2Contract));
      const browser = browserRun(input, 8), server = createModel2Engine(input, 8, buildModel2Contract);
      for (let second = 1; second <= 8; second++) {
        browser.advance(); server.advance();
        if (second === 1) {
          const action = { kind: "intervention" as const, parameters: { interventionId: "deny-port", revision: 1, target: { resourceId: "firewall" }, parameters: { port: 80, duration: 4 } } };
          expect(browser.apply(action)).toEqual(server.apply(action));
          while (browser.catchingUp) browser.catchUp(10); while (server.catchingUp) server.catchUp(10);
        }
        expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view());
      }
      const e = browser.evidence(); completed.push(e.counts.completed);
      expect(e.counts.offered).toBe(4);
      expect(e.systems.security.policies[0]!.denied).toBe(idle === 1 ? 2 : 0);
      expect(e.network.paths.find(p => p.id === "external-entry")!.pool.created).toBe(1);
      expect(e.systems.security.policies[0]!.generation).toBe(3);
      expect(browser.view().metrics.firewall!.security!.firewall!.expired).toBe(idle === 1 ? 2 : 0);
    }
    expect(completed).toEqual([2, 4]);
    const refusals: number[] = [];
    for (const maxFlows of [1, 2]) {
      const layout = firewallLayout(maxFlows); layout.resources[2]!.firewallState = { version: 1, idleTimeoutSeconds: 1 };
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, { ...firewallWorkload, targetThroughput: 60000 }, "firewall-depth-parity"))));
      const fresh = (builder: ContractBuilder): ContractBuilder => (...args) => { const f = builder(...args); if (!("refused" in f)) for (const t of Object.values(f.contract.transports)) t.pool.reuse = false; return f; };
      const browser = browserRun(input, 1, fresh(browserBuild)), server = createModel2Engine(input, 1, fresh(buildModel2Contract));
      browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view());
      refusals.push(browser.evidence().systems.security.policies[0]!.capacityRefused!);
      expect(browser.view().metrics.firewall!.security!.firewall!["flow-capacity"]).toBe(refusals.at(-1)!);
    }
    expect(refusals[0]!).toBeGreaterThan(refusals[1]!);
    console.info("firewall-depth-browser-server-parity", JSON.stringify({ cases: 4, gapCompleted: completed, capacityRefusals: refusals }));
  } finally { for (const path of [entryPath, browserPath]) if (await Bun.file(path).exists()) await unlink(path); }
});
