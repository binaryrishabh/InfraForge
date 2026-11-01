import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Resource, LbHealth } from "@infraforge/domain/resource";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";

test("browser-target and server replay agree each second through health removal, retry/breaker and recovery", async () => {
  const browserPath = resolve(import.meta.dir, `../../../.cache/lb-health-browser-${process.pid}.mjs`);
  await mkdir(dirname(browserPath), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(), exitCode = await build.exited;
    if (exitCode !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const browserModule = await import(pathToFileURL(browserPath).href), createBrowserRun: typeof createModel2Run = browserModule.createModel2Run;
    const base: LbHealth = { version: 1, intervalSeconds: 3, timeoutSeconds: 1, unhealthyAfter: 1, healthyAfter: 1 };
    const cases = [
      { policy: base }, { policy: { ...base, intervalSeconds: 1 } }, { policy: { ...base, timeoutSeconds: 2 } },
      { policy: { ...base, unhealthyAfter: 3 } }, { policy: { ...base, healthyAfter: 3 } },
      { policy: base, resilience: "retry" }, { policy: base, resilience: "breaker" },
    ];
    for (const { policy, resilience } of cases) {
      const resources: Resource[] = [
        { id: "lb", type: "Load Balancer", x: 0, y: 0, lbHealth: policy, lbAdmission: { version: 1, maxActive: 8, maxQueued: 32, queueWaitMs: 1000 },
          ...(resilience ? { retry: { enabled: true, maxAttempts: 2, backoffMs: 10, jitterRatio: 0, maxConcurrentRetries: 4, retryOn: ["backendFailure", "timeout"] as ["backendFailure", "timeout"] } } : {}),
          ...(resilience === "breaker" ? { circuitBreaker: { enabled: true, failureThreshold: 1, cooldownMs: 100 } } : {}) },
        { id: "app", type: "Virtual Machine", x: 1, y: 0 }, { id: "survivor", type: "Virtual Machine", x: 2, y: 0 },
      ];
      const layout = { resources, connectionLines: ["app", "survivor"].map(id => ({ id: `to-${id}`, sourceId: "lb", sourceType: "Load Balancer", targetId: id, targetType: "Virtual Machine", port: 80 })) };
      const workload = { targetThroughput: 600, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, workload, "lb-health-parity"))));
      expect(buildContractFromRunInputs(input, 46)).toEqual(buildContractFromRunInputs(input, 46, buildModel2Contract));
      const browser = createBrowserRun(input, 46), server = createModel2Engine(input, 46, buildModel2Contract);
      let excluded = false, restored = false;
      for (let second = 1; second <= 46; second++) {
        browser.advance(); server.advance();
        if (second === 2) {
          const action = { kind: "chaos" as const, parameters: { type: "crash" as const, resourceId: "app" } };
          expect(browser.apply(action)).toEqual(server.apply(action));
          browser.catchUp(1000); server.catchUp(1000);
          expect(browser.catchingUp).toBe(false); expect(server.catchingUp).toBe(false);
        }
        const evidence = browser.evidence(), lb = evidence.network.loadBalancers[0]!;
        expect(evidence).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view());
        const backend = lb.backends.find(b => b.id === "app")!;
        if (!backend.health) excluded = true;
        if (excluded && backend.health) restored = true;
        expect(lb.active).toBeLessThanOrEqual(8); expect(lb.pending).toBeLessThanOrEqual(32);
      }
      expect(excluded).toBe(true); expect(restored).toBe(true);
      const lb = browser.evidence().network.loadBalancers[0]!;
      expect(lb.backends.every(b => b.health && b.selected > 0)).toBe(true);
      if (resilience === "retry") expect(lb.retries).toBeGreaterThan(0);
      if (resilience === "breaker") expect(browser.evidence().network.paths.find(p => p.source === "lb" && p.target === "app")!.circuitBreaker!.state).toBe("closed");
    }
  } finally { if (await Bun.file(browserPath).exists()) await unlink(browserPath); }
});
