import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Resource } from "@infraforge/domain/resource";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";

test("browser-target and official replay agree with a service objective, Poisson retries, live load changes and an LB limiter", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/objective-browser-${process.pid}.mjs`);
  await mkdir(dirname(path), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const limited of [false, true]) {
      const resources: Resource[] = [{ id: "lb", type: "Load Balancer", x: 0, y: 0,
        ...(limited ? { lbRateLimit: { version: 1 as const, burstRequests: 20, sustainedRequestsPerSecond: 200 } } : {}) },
      { id: "app", type: "Virtual Machine", x: 1, y: 0, vmExecution: { version: 1, workers: 1, queuedRequests: 0 } }, { id: "db", type: "Database", x: 2, y: 0 }];
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs({ resources, connectionLines: [
        { id: "lb-app", sourceId: "lb", sourceType: "Load Balancer", targetId: "app", targetType: "Virtual Machine", port: 80 },
        { id: "app-db", sourceId: "app", sourceType: "Virtual Machine", targetId: "db", targetType: "Database", port: 5432 },
      ] }, { targetThroughput: 72000, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0.8, payloadSize: "light",
        workloadObjective: { version: 1, maxResponseMs: 250, targetSuccessPercent: 95 }, clientRetry: { version: 1, maxAttempts: 3, backoffMs: 50 }, workloadDynamics: { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0.5 } }, "objective-browser-parity"))));
      const browser = browserRun(input, 8), server = createModel2Engine(input, 8, buildModel2Contract);
      expect(browser.view()).toEqual(server.view());
      expect(browser.view().traffic.objective!.status).toBe("unknown");
      for (let second = 1; second <= 8; second++) {
        browser.advance(); server.advance(); expect(browser.view()).toEqual(server.view());
        if (second === 5) expect(browser.view().traffic.offeredRps).toBe(0);
        const fraction = second === 2 ? 0.5 : second === 4 ? 0 : second === 5 ? 1 : undefined;
        if (fraction !== undefined) {
          const action = { kind: "load" as const, parameters: { targetLoadFraction: fraction } };
          expect(browser.apply(action)).toEqual(server.apply(action));
          while (browser.catchingUp) browser.catchUp(10); while (server.catchingUp) server.catchUp(10);
        }
      }
      const evidence = browser.evidence(); expect(evidence).toEqual(server.evidence());
      expect(browser.view().traffic.objective).toEqual(evidence.objective);
      const o = evidence.objective!; expect(o.offered).toBe(o.good + o.late + o.failed + o.deadlineExceeded + o.abandoned + o.unresolvedPastThreshold + o.pending);
      expect(evidence.clientRetry!.totalAttempts).toBeGreaterThan(evidence.counts.offered);
      expect(browser.view().traffic.clientRetry!.totalAttempts).toBe(evidence.clientRetry!.totalAttempts);
      if (limited) expect(evidence.network.loadBalancers[0]!.rateLimit!.rejected).toBeGreaterThan(0);
      console.info("objective-browser-server-parity", JSON.stringify({ limited, originals: evidence.counts.offered, attempts: evidence.clientRetry!.totalAttempts, seconds: 8, loadActions: 3, objective: evidence.objective }));
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 180000);
