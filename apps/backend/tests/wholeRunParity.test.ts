import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";

test("whole-run browser/server parity with Poisson, retry timeouts, live load and historical input", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/whole-run-parity-${process.pid}.mjs`);
  await mkdir(dirname(path), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const marked of [false, true]) {
      const input = readRunInputs(captureRunInputs({ resources: [
        { id: "lb", type: "Load Balancer", x: 0, y: 0, lbRateLimit: { version: 1, burstRequests: 20, sustainedRequestsPerSecond: 200 } },
        { id: "app", type: "Virtual Machine", x: 1, y: 0, vmExecution: { version: 1, workers: 1, queuedRequests: 0 } }, { id: "db", type: "Database", x: 2, y: 0 },
      ], connectionLines: [
        { id: "lb-app", sourceId: "lb", targetId: "app", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 },
        { id: "app-db", sourceId: "app", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432 },
      ] }, { targetThroughput: 72000, throughputUnit: "per-minute", trafficShape: "steady", payloadSize: "light", readWriteRatio: 1,
        workloadDynamics: { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0.5 }, clientRetry: { version: 1, maxAttempts: 3, backoffMs: 50, attemptTimeoutMs: 20 } }, "latency-parity"));
      if (!marked) input.adapterProfiles = input.adapterProfiles!.filter(p => p !== "traffic-evidence/2");
      const browser = browserRun(input, 3), server = createModel2Engine(input, 3, buildModel2Contract);
      for (let s = 0; s < 3; s++) {
        browser.advance(); server.advance(); expect(browser.view()).toEqual(server.view());
        if (s === 0) {
          const action = { kind: "load" as const, parameters: { targetLoadFraction: 0.5 } };
          browser.apply(action); server.apply(action);
        }
        const traffic = browser.view().traffic;
        expect(Object.hasOwn(traffic, "wholeRun")).toBe(marked);
        if (marked) expect(traffic.wholeRun!.completed).toBeGreaterThan(0);
        expect(Object.hasOwn(traffic, "latency")).toBe(marked);
        if (marked) expect(traffic.latency!.p99Ms).toBe(traffic.latencyMs.p99!);
      }
      expect(browser.evidence()).toEqual(server.evidence());
      expect(browser.evidence().clientRetry!.totalAttempts).toBeGreaterThan(browser.evidence().clientRetry!.originalsOffered);
      expect(browser.view().metrics.lb!.rateLimit!.rejected).toBeGreaterThan(0);
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 180000);
