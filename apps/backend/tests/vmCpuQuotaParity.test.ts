import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RESOURCE_PORTS, DEFAULT_ASYNC_QUEUE_SETTINGS, DEFAULT_ASYNC_WORKER_SETTINGS, type Resource, type VmExecution } from "@infraforge/domain/resource";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";

function layout(mode: "plain" | "flow" | "lb" | "autoscaled" | "async", vmExecution?: VmExecution, limitPercent?: number) {
  const resources: Resource[] = [{ id: "app", type: "Virtual Machine", x: 0, y: 0, size: mode === "autoscaled" ? "small" : "large", ...(vmExecution ? { vmExecution } : {}), ...(limitPercent === undefined ? {} : { vmCpuQuota: { version: 1, limitPercent } }) }];
  const links: string[][] = [];
  if (mode === "flow") {
    resources.push({ id: "db", type: "Database", x: 1, y: 0 }); links.push(["app", "db"]);
    resources[0]!.applicationFlow = { schema: "application-flow/2", operations: { read: { steps: [{ id: "cpu", kind: "compute" }, { id: "read", kind: "data", edge: "app-db", operation: "read" }] } } };
  }
  if (mode === "lb" || mode === "autoscaled") {
    resources.push({ id: "lb", type: "Load Balancer", x: 0, y: 1, lbAdmission: { version: 1, maxActive: 32, maxQueued: 32, queueWaitMs: 1000 },
      retry: { enabled: true, maxAttempts: 2, backoffMs: 10, jitterRatio: 0, maxConcurrentRetries: 8, retryOn: ["backendFailure"] } });
    links.push(["lb", "app"]);
    if (mode === "lb") { resources.push({ ...resources[0]!, id: "other", y: 1 }); links.push(["lb", "other"]); }
    else resources[0]!.autoscaling = { enabled: true, minReplicas: 1, maxReplicas: 3, targetCpu: 50 };
  }
  if (mode === "async") {
    resources.push({ id: "queue", type: "Message Queue", x: 1, y: 0, asyncQueue: { ...DEFAULT_ASYNC_QUEUE_SETTINGS } },
      { id: "worker", type: "Virtual Machine", x: 2, y: 0, asyncWorker: { ...DEFAULT_ASYNC_WORKER_SETTINGS } }, { id: "store", type: "Object Storage", x: 1, y: 1 });
    links.push(["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]);
  }
  return { resources, connectionLines: links.map(([sourceId, targetId]) => ({ id: `${sourceId}-${targetId}`, sourceId: sourceId!, targetId: targetId!, sourceType: resources.find(r => r.id === sourceId)!.type, targetType: resources.find(r => r.id === targetId)!.type, port: RESOURCE_PORTS[resources.find(r => r.id === targetId)!.type] })) };
}

test("browser-target authored CPU quota contracts, evidence and live views equal server replay each second", async () => {
  const entryPath = resolve(import.meta.dir, `../../../.cache/vm-cpu-quota-entry-${process.pid}.ts`), browserPath = entryPath.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entryPath), { recursive: true });
  try {
    await writeFile(entryPath, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entryPath, "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const browserModule = await import(pathToFileURL(browserPath).href), createBrowserRun: typeof createModel2Run = browserModule.createModel2Run;
    const buildBrowserContract: typeof buildContractFromRunInputs = browserModule.buildContractFromRunInputs;
    const cases = [
      { mode: "plain", workers: 1, queuedRequests: 0, limitPercent: 1 },
      { mode: "plain", workers: 4, queuedRequests: 32, limitPercent: 25 },
      { mode: "plain", workers: 64, queuedRequests: 1000, limitPercent: 50 },
      { mode: "plain", workers: 4, queuedRequests: 32, limitPercent: 100 },
      { mode: "flow", workers: 4, queuedRequests: 32, limitPercent: 25 },
      { mode: "lb", workers: 1, queuedRequests: 0, limitPercent: 25 },
      { mode: "lb", workers: 4, queuedRequests: 32, limitPercent: 50 },
      { mode: "autoscaled", workers: 4, queuedRequests: 32, limitPercent: 75 },
      { mode: "async", limitPercent: 25 },
    ] as const;
    for (const c of cases) {
      const intent = "workers" in c ? { version: 1 as const, workers: c.workers, queuedRequests: c.queuedRequests } : undefined;
      const seconds = c.mode === "autoscaled" ? 16 : 3;
      const workload = { targetThroughput: (c.mode === "async" ? 8 : c.mode === "autoscaled" ? 260 : 600) * 60, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout(c.mode, intent, c.limitPercent), workload, "quota-browser-parity"))));
      expect(buildBrowserContract(input, seconds)).toEqual(buildContractFromRunInputs(input, seconds, buildModel2Contract));
      const browser = createBrowserRun(input, seconds), server = createModel2Engine(input, seconds, buildModel2Contract);
      for (let second = 1; second <= seconds; second++) {
        browser.advance(); server.advance();
        const e = browser.evidence(); expect(e).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view());
        if (intent) for (const r of e.samples.at(-1)!.resources.filter(r => r.compute)) {
          expect(r.compute!.workers.configured).toBe(intent.workers); expect(r.serving + r.waiting).toBeLessThanOrEqual(intent.workers); expect(r.queued).toBeLessThanOrEqual(intent.queuedRequests);
        }
      }
      const e = browser.evidence();
      const appSamples = e.samples.flatMap(s => s.resources.filter(r => r.compute && (r.id === "app" || r.id.startsWith("app#") || r.id === "other")));
      expect(appSamples.length).toBeGreaterThan(0);
      expect(appSamples.every(r => r.compute!.cpu.quotaRemainingCoreUs !== null)).toBe(true);
      if ((c.mode === "plain" || c.mode === "flow") && c.limitPercent < 50) expect(appSamples.some(r => r.compute!.cpu.throttledWallUs > 0)).toBe(true);
      const computes = e.samples.flatMap(s => s.resources.filter(r => r.compute));
      if (c.mode === "plain" && c.workers === 1) {
        expect(computes.some(r => r.rejected > 0)).toBe(true);
        if (c.queuedRequests > 0) expect(computes.some(r => r.queued > 0)).toBe(true);
      }
      if (c.mode === "autoscaled") expect(e.product.controllers[0]!.populations.ready!).toBeGreaterThan(1);
      if (c.mode === "async") expect(e.asynchronous.workers[0]!.processed).toBeGreaterThan(0);
      console.info("quota-browser-server-parity", JSON.stringify({ ...c, seconds, completed: e.counts.completed, rejected: e.counts.rejected, ready: e.product.controllers[0]?.populations.ready }));
    }
  } finally { for (const path of [entryPath, browserPath]) if (await Bun.file(path).exists()) await unlink(path); }
});
