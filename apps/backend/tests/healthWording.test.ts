import { expect, test } from "bun:test";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";

// Failures are counted when requests finish and arrivals when they arrive. These runs use the real product engine
// to show the two counts can describe different requests, so the health message must not present them as a ratio.
const topology = { resources: [
  { id: "lb", type: "Load Balancer", x: 0, y: 0 },
  { id: "app", type: "Virtual Machine", x: 1, y: 0, vmExecution: { version: 1, workers: 1, queuedRequests: 64 } },
  { id: "db", type: "Database", x: 2, y: 0 },
], connectionLines: [
  { id: "lb-app", sourceId: "lb", targetId: "app", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 },
  { id: "app-db", sourceId: "app", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432 },
] } as never;
const base = { targetThroughput: 72000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 1, payloadSize: "light" };

function run(workload: object, seconds: number, dropLoadAt?: number) {
  const engine = createModel2Engine(captureRunInputs(topology, workload as never, "health-wording"), 40);
  return Array.from({ length: seconds }, (_, i) => {
    if (i + 1 === dropLoadAt) engine.apply({ kind: "load", parameters: { targetLoadFraction: 0 } } as never);
    const logs = engine.advance(), view = engine.view();
    return { traffic: view.traffic!, health: view.overallHealth, healthLogs: logs.map(l => l.message).filter(m => m.startsWith("System health")) };
  });
}

test("after the load stops, failures from earlier arrivals are reported as failures, not as a share of zero arrivals", () => {
  const seconds = run(base, 8, 5);
  const drained = seconds.find(s => s.traffic.offeredRps === 0 && s.traffic.failedRps > 0);
  expect(drained).toBeDefined();
  // The classification still sees the failing resources; only the explanation changes.
  expect(drained!.health).not.toBe("healthy");
  expect(drained!.healthLogs).toHaveLength(1);
  const [message] = drained!.healthLogs;
  expect(message).toContain(`${drained!.traffic.failedRps} request${drained!.traffic.failedRps === 1 ? "" : "s"} finished as failures`);
  expect(message).toContain("0 requests newly arrived");
  expect(message).toContain("these can be different requests");
  expect(message).not.toMatch(/\d+ of \d+ requests failed/);
});

test("with retries a second can finish more failures than it received arrivals, and nothing claims otherwise", () => {
  const seconds = run({ ...base, clientRetry: { version: 1, maxAttempts: 3, backoffMs: 500, attemptTimeoutMs: 200 },
    workloadDynamics: { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0.5 } }, 12);
  expect(seconds.some(s => s.traffic.failedRps > s.traffic.offeredRps)).toBe(true);
  // Every second that finished failures was classified as something other than healthy.
  for (const s of seconds.filter(s => s.traffic.failedRps > 0)) expect(s.health).not.toBe("healthy");
  for (const message of seconds.flatMap(s => s.healthLogs)) expect(message).not.toMatch(/\d+ of \d+ requests failed/);
});
