import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import type { Resource, VmMemory } from "@infraforge/domain/resource";
import type { WorkloadProfile } from "@infraforge/domain/workload";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { VmMemorySchema } from "../reports/vmMemorySchema";
import { readRecords } from "../reports/records";

const tightMemory: VmMemory = { version: 1, baselineMiB: 1024, requestMiB: 128, activeMiB: 0 };
function memoryDesign(memory?: VmMemory) {
  const resources: Resource[] = [
    { id: "lb", type: "Load Balancer", x: 0, y: 0, lbAdmission: { version: 1, maxActive: 128, maxQueued: 128, queueWaitMs: 1000 } },
    { id: "app", type: "Virtual Machine", x: 1, y: 0, vmExecution: { version: 1, workers: 1, queuedRequests: 1000 }, ...(memory ? { vmMemory: memory } : {}) },
    { id: "db", type: "Database", x: 2, y: 0 },
  ];
  const connections = [{ id: "lb-app", sourceId: "lb", sourceType: "Load Balancer" as const, targetId: "app", targetType: "Virtual Machine" as const, port: 80 },
    { id: "app-db", sourceId: "app", sourceType: "Virtual Machine" as const, targetId: "db", targetType: "Database" as const, port: 5432 }];
  const workload: WorkloadProfile = { targetThroughput: 36000, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light" };
  return { resources, connections, workload };
}

test("browser memory evidence/live equals official replay with load actions and client retries", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/memory-browser-${process.pid}.mjs`);
  await mkdir(dirname(path), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const mode of ["historical", "generous", "tight", "active", "retry", "lb-retry", "flow", "replicas"] as const) {
      const d = memoryDesign(mode === "historical" ? undefined : mode === "generous" ? { ...tightMemory, baselineMiB: 0, requestMiB: 1 } : mode === "active" ? { ...tightMemory, activeMiB: 16 } : tightMemory);
      if (mode === "retry") d.workload.clientRetry = { version: 1, maxAttempts: 3, backoffMs: 50 };
      if (mode === "lb-retry") d.resources.find(r => r.id === "lb")!.retry = { enabled: true, maxAttempts: 2, backoffMs: 10, jitterRatio: 0, maxConcurrentRetries: 8, retryOn: ["backendFailure"] };
      if (mode === "flow") d.resources.find(r => r.id === "app")!.applicationFlow = { schema: "application-flow/2", operations: { read: { steps: [{ id: "cpu", kind: "compute" }, { id: "data", kind: "data", edge: "app-db", operation: "read" }] } } };
      if (mode === "replicas") d.resources.find(r => r.id === "app")!.autoscaling = { enabled: true, minReplicas: 1, maxReplicas: 3, targetCpu: 50 };
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs({ resources: d.resources, connectionLines: d.connections }, d.workload, "memory-browser-parity"))));
      const browser = browserRun(input, 4), server = createModel2Engine(input, 4, buildModel2Contract);
      expect(browser.view()).toEqual(server.view());
      for (let second = 1; second <= 4; second++) {
        browser.advance(); server.advance(); expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
        const block = browser.view().metrics.app!.vmMemory;
        if (mode === "historical") { expect(block).toBeUndefined(); expect(browser.evidence()).not.toHaveProperty("vmMemory"); }
        else {
          expect(VmMemorySchema.safeParse(block).success).toBe(true);
          const limits: string[] = [], records = readRecords({ stages: [], timeline: [], chaosEvents: [], simulationState: browser.view() }, limits);
          expect(records.checkpoint!.resources.find(r => r.id === "app")!.vmMemory).toEqual(block);
        }
        const fraction = second === 2 ? 0 : second === 3 ? 0.5 : undefined;
        if (fraction !== undefined) {
          const action = { kind: "load" as const, parameters: { targetLoadFraction: fraction } };
          expect(browser.apply(action)).toEqual(server.apply(action));
          while (browser.catchingUp) browser.catchUp(10); while (server.catchingUp) server.catchUp(10);
          expect(browser.evidence()).toEqual(server.evidence());
        }
      }
      const evidence = browser.evidence();
      if (mode === "retry") { expect(evidence.clientRetry!.ineligibleByReason["memory-limit"]).toBeGreaterThan(0); expect(evidence.clientRetry!.retriesIssued).toBe(0); }
      if (mode === "lb-retry") expect(evidence.network.loadBalancers[0]!.retries).toBeGreaterThan(0);
      if (mode === "generous") expect(evidence.vmMemory!.resources[0]!.allocationRejected).toBe(0);
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 180000);

test("memory checkpoint schema is strict and preserves unknowns and negative headroom", () => {
  const unknown = { id: "app", residentBytes: null, limitBytes: null, headroomBytes: null, holdingRequests: null, activeRequests: null, allocationRejected: null, comparison: "unknown", peakResidentBytes: null };
  expect(VmMemorySchema.parse({ version: 1, resources: [unknown] }).resources[0]!.residentBytes).toBeNull();
  const known = { ...unknown, residentBytes: 3, limitBytes: 2, headroomBytes: -1, comparison: "exceeds", peakResidentBytes: 3 };
  expect(VmMemorySchema.safeParse({ version: 1, resources: [known] }).success).toBe(true);
  for (const patch of [{ extra: 1 }, { headroomBytes: 0 }, { comparison: "within" }, { peakResidentBytes: 2 }, { residentBytes: -1 }, { holdingRequests: 0, activeRequests: 1 }]) expect(VmMemorySchema.safeParse({ version: 1, resources: [{ ...known, ...patch }] }).success).toBe(false);
  expect(VmMemorySchema.safeParse({ version: 1, resources: [unknown, unknown] }).success).toBe(false);
});
