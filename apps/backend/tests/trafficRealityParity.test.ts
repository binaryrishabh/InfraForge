import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Resource } from "@infraforge/domain/resource";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";

test("browser-target and official replay agree for Poisson + variable CPU, repeating peak, load/zero actions and optional LB limiter", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/traffic-browser-${process.pid}.mjs`);
  await mkdir(dirname(path), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const limited of [false, true]) {
      const resources: Resource[] = [{ id: "lb", type: "Load Balancer", x: 0, y: 0,
        ...(limited ? { lbRateLimit: { version: 1 as const, burstRequests: 3, sustainedRequestsPerSecond: 4 } } : {}) },
      { id: "app", type: "Virtual Machine", x: 1, y: 0 }, { id: "db", type: "Database", x: 2, y: 0 }];
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs({ resources, connectionLines: [
        { id: "lb-app", sourceId: "lb", sourceType: "Load Balancer", targetId: "app", targetType: "Virtual Machine", port: 80 },
        { id: "app-db", sourceId: "app", sourceType: "Virtual Machine", targetId: "db", targetType: "Database", port: 5432 },
      ] }, { targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "peak", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "light",
        workloadDynamics: { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0.5 } }, "traffic-browser-parity"))));
      const browser = browserRun(input, 144), server = createModel2Engine(input, 144, buildModel2Contract);
      let sawPeak = false, sawLimited = false, sawZero = false;
      for (let second = 1; second <= 144; second++) {
        browser.advance(); server.advance(); expect(browser.view()).toEqual(server.view());
        const v = browser.view();
        if (second >= 120 && second < 130 && v.traffic.offeredRps >= 15) sawPeak = true;
        if (limited && (v.metrics.lb!.rateLimit?.rejected ?? 0) > 0) sawLimited = true;
        if (second === 132 && v.traffic.offeredRps === 0) sawZero = true;
        const fraction = second === 122 ? 0.5 : second === 130 ? 0 : second === 132 ? 1 : undefined;
        if (fraction !== undefined) {
          const action = { kind: "load" as const, parameters: { targetLoadFraction: fraction } };
          expect(browser.apply(action)).toEqual(server.apply(action));
          while (browser.catchingUp) browser.catchUp(10); while (server.catchingUp) server.catchUp(10);
        }
      }
      expect(browser.evidence()).toEqual(server.evidence()); expect(sawPeak).toBe(true); expect(sawZero).toBe(true); if (limited) expect(sawLimited).toBe(true);
    }
    console.info("traffic-browser-server-parity", JSON.stringify({ cases: 2, simulatedSecondsPerCase: 144, actionsPerCase: 3 }));
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 180000);
