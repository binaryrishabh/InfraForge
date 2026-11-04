import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { schedulerLayout, schedulerWorkload } from "./scheduler.fixture";

test("browser bundle and server replay agree for healthy and failed scheduled invocations", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/scheduler-${process.pid}.ts`), output = entry.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entry), { recursive: true });
  try {
    await writeFile(entry, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entry, "--target=browser", "--outfile", output], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited) throw Error(diagnostics);
    const module = await import(pathToFileURL(output).href), browserRun: typeof createModel2Run = module.createModel2Run, browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs;
    for (const fail of [false, true]) {
      const layout = schedulerLayout();
      if (fail) layout.resources[0]!.listenerSettings = { version: 1, ports: [] };
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, schedulerWorkload, "scheduler-parity"))));
      expect(browserContract(input, 3)).toEqual(buildContractFromRunInputs(input, 3, buildModel2Contract));
      const browser = browserRun(input, 3), server = createModel2Engine(input, 3, buildModel2Contract);
      for (let second = 1; second <= 3; second++) { browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view()); }
      const e = browser.evidence().asynchronous.schedulers![0]!;
      expect(browser.view().metrics.timer!.scheduler!.completed).toBe(e.completed);
      const a = browser.view().metrics.timer!.scheduler!.attemptAccounting!;
      expect(a.started).toBe(e.fired - e.retried);
      expect(e.fired).toBe(e.completed + a.failedAttempts + a.pendingAttempts);
      expect(a.pendingAttempts + a.retryWaiting).toBe(e.active);
      expect(e.due).toBe(100);
      if (fail) { expect(e.failed).toBeGreaterThan(0); expect(e.missed).toBe(100); }
      else expect(e.completed).toBe(100);
    }
  } finally { for (const path of [entry, output]) if (await Bun.file(path).exists()) await unlink(path); }
});
