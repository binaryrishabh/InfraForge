import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { eventBusLayout, eventBusWorkload } from "./eventBus.fixture";

test("browser bundle and official server replay agree for healthy and failed subscriptions", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/event-bus-${process.pid}.ts`), output = entry.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entry), { recursive: true });
  try {
    await writeFile(entry, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entry, "--target=browser", "--outfile", output], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited) throw Error(diagnostics);
    const module = await import(pathToFileURL(output).href), browserRun: typeof createModel2Run = module.createModel2Run, browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs;
    for (const fail of [false, true]) for (const flow of [false, true]) {
      const layout = eventBusLayout();
      if (fail) layout.resources.find(r => r.id === "queue")!.listenerSettings = { version: 1, ports: [] };
      if (flow) layout.resources[0]!.applicationFlow = { schema: "application-flow/3", operations: { write: { steps: [{ id: "cpu", kind: "compute" }, { id: "send", kind: "publish", edge: "e0" }] } } };
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, { ...eventBusWorkload, readWriteRatio: flow ? 0 : 0.8 }, "event-bus-parity"))));
      expect(browserContract(input, 3)).toEqual(buildContractFromRunInputs(input, 3, buildModel2Contract));
      const browser = browserRun(input, 3), server = createModel2Engine(input, 3, buildModel2Contract);
      for (let second = 1; second <= 3; second++) { browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view()); }
      const e = browser.evidence().asynchronous;
      expect(e.eventBuses![0]!.subscriptions[1]!.delivered).toBe(24);
      expect(e.workers[1]!.effects).toBeGreaterThan(0);
      if (fail) { expect(e.eventBuses![0]!.subscriptions[0]!.deadLettered).toBeGreaterThan(0); expect(e.workers[0]!.effects).toBe(0); }
    }
  } finally { for (const path of [entry, output]) if (await Bun.file(path).exists()) await unlink(path); }
});
