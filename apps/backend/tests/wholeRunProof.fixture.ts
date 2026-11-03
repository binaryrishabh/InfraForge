import { compileProduct, createProductModel2, buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import type { SavedProductDesign } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { captureSnapshot } from "../simulator/snapshot";
import { readRecords } from "../reports/records";
import { compareTraffic } from "../comparison/traffic";

// A subprocess keeps the rendering proof inside the web workspace's import boundary.
function measured(timeout: number) {
  const input = readRunInputs(captureRunInputs({ resources: [
    { id: "lb", type: "Load Balancer", x: 0, y: 0 },
    { id: "app", type: "Virtual Machine", x: 1, y: 0, vmExecution: { version: 1, workers: 1, queuedRequests: 0 } },
    { id: "db", type: "Database", x: 2, y: 0 },
  ], connectionLines: [
    { id: "lb-app", sourceId: "lb", targetId: "app", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 },
    { id: "app-db", sourceId: "app", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432 },
  ] }, { targetThroughput: 72000, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light",
    workloadDynamics: { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0.5 }, clientRetry: { version: 1, maxAttempts: 3, backoffMs: 50, attemptTimeoutMs: timeout } }, "whole-run-proof"));
  const design: SavedProductDesign = { schema: "infraforge-saved-design/1", resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile };
  const built = buildContractFromRunInputs(input, 4);
  if ("refused" in built) throw Error(JSON.stringify(built));
  const compiled = compileProduct(design, { ...built.contract, arrival: { ...built.contract.arrival, generated: true } });
  if (!compiled.ok) throw Error(JSON.stringify(compiled));
  const samples: number[] = [];
  const independent = createProductModel2(compiled.value, undefined, event => {
    if (event.kind === "caller-terminal" && event.detail.outcome === "completed") samples.push(event.detail.responseUs as number);
  });
  independent.advanceTo(4000000);
  const model2 = createModel2Engine(input, 4);
  for (let s = 0; s < 4; s++) model2.advance();
  const snapshot = captureSnapshot("proof", { model2, tickCount: 4, pendingLogs: [], speed: 1, lastCheckpointAt: 0, accumulatedCostUsd: 0,
    topology: input, topologyRevision: 0, actions: new Map(), metricsComputedAt: null, metricsTopologyRevision: 0, acknowledge: null }, "terminal");
  const limits: string[] = [];
  const stored = readRecords(JSON.parse(JSON.stringify({ runInputs: input, stages: [], timeline: [], chaosEvents: [], terminalSnapshot: snapshot })), limits);
  if (limits.length || !stored.terminal) throw Error(JSON.stringify(limits));
  if (stored.terminal.traffic?.wholeRun?.completed !== samples.length) throw Error("Independent completed population differs");
  samples.sort((a, b) => a - b);
  return { timeout, terminal: stored.terminal, exactP99Ms: samples[Math.ceil(samples.length * 0.99) - 1]! / 1000,
    attemptsTimedOut: model2.evidence().clientRetry!.attemptsTimedOut };
}

const runs = [measured(5), measured(20)];
console.log(JSON.stringify({ runs, comparison: compareTraffic(runs[0]!.terminal, runs[1]!.terminal, true) }));
