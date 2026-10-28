/* Generates the run shown on the public landing page.

The browser never runs the simulator, so the landing page carries one recorded run.
This script produces it the way a learner's first, unchanged attempt at "Lose an app
server" is produced: the challenge's starter design, its fixed workload and seed, Model 2,
and the scheduled crash applied through the worker's own action path at exactly its second. Every completed tick is kept. scripts/tests/landingSample.test.ts
fails if the committed file no longer matches what this produces.

  bun --no-env-file scripts/landing-sample.ts --write */
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findChallenge, challengeSeed } from "../apps/backend/challenges/registry";
import { captureRunInputs, MODEL2_ENGINE_VERSION } from "../apps/backend/deployments/runInputs";
import { applyAction } from "../apps/backend/simulator/actionApplication";
import { createModel2Engine } from "../apps/backend/simulator/model2Engine";
import { buildModel2Contract } from "../apps/backend/simulator/contractBuilder";
import type { SimulationInstance } from "../apps/backend/simulator/instance";

export const samplePath = fileURLToPath(new URL("../apps/web/src/features/landing/sampleRun.json", import.meta.url));
const HEALTH = ["healthy", "degraded", "saturated", "failed", "unknown"] as const;
const SYSTEM = ["healthy", "degraded", "saturated", "critical"] as const;

export function generateLandingSample() {
  const definition = findChallenge("lose-an-app-server", 2)?.definition;
  if (!definition?.starter || !definition.experiment) throw new Error("The landing challenge or its experiment is missing");
  const seed = challengeSeed(definition);
  const input = captureRunInputs(definition.starter, definition.workload, seed);
  const instance: SimulationInstance = {
    model2: createModel2Engine(input, definition.evaluationSeconds, buildModel2Contract),
    tickCount: 0, pendingLogs: [], speed: 1, lastCheckpointAt: 0, accumulatedCostUsd: 0,
    topology: { resources: input.resources, connectionLines: input.connectionLines }, topologyRevision: 0,
    actions: new Map(), acknowledge: null, metricsComputedAt: null, metricsTopologyRevision: 0,
  };
  const { fault, atSimulatedSecond, target } = definition.experiment;
  const ids = input.resources.map((r) => r.id);
  const points: Array<{ t: number; system: number; resources: Array<[number, number | null]> }> = [];
  let faultDuration = 0;
  while (instance.model2.simulatedSeconds < definition.evaluationSeconds) {
    // The worker stops at the experiment second and applies the fault before the next second.
    if (instance.model2.simulatedSeconds === atSimulatedSecond) {
      const applied = applyAction(instance, "landing-experiment", { kind: "chaos", parameters: { type: fault, resourceId: target.resourceId, trigger: "challenge-experiment" } });
      faultDuration = Number(applied.outcome.durationSimulatedSeconds ?? 0);
    }
    instance.model2.advance();
    const s = instance.model2.view();
    // CPU is null where Model 2 does not model it (DNS, load balancer): Unknown, never zero.
    points.push({ t: s.simulatedSeconds, system: SYSTEM.indexOf(s.overallHealth as typeof SYSTEM[number]),
      resources: ids.map((id) => { const m = s.metrics[id]!;
        return [HEALTH.indexOf(m.health as typeof HEALTH[number]), m.cpu === null || m.cpu === undefined ? null : Math.round(m.cpu * 10) / 10]; }) });
  }
  return {
    schema: "infraforge-landing-sample/1", model: MODEL2_ENGINE_VERSION,
    challenge: { id: definition.id, version: definition.version, title: definition.title }, seed,
    workload: definition.workloadNote,
    stations: input.resources.map((r) => ({ id: r.id, type: r.type, label: r.name ?? r.id })),
    connections: input.connectionLines.map((c) => [c.sourceId, c.targetId]),
    fault: { type: fault, target: target.resourceId, at: atSimulatedSecond, duration: faultDuration },
    evaluation: definition.evaluationSeconds,
    // Each point is one completed second: [health index, CPU percent or null] per station, in station order.
    points,
  };
}

if (import.meta.main) {
  const sample = JSON.stringify(generateLandingSample()) + "\n";
  if (process.argv.includes("--write")) writeFileSync(samplePath, sample);
  else if (readFileSync(samplePath, "utf8") !== sample) { console.error("Landing sample is stale; run with --write"); process.exitCode = 1; }
  else console.log("Landing sample matches the engine");
}
