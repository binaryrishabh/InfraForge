/* Generates the run shown on the public landing page.

The browser never runs the simulator, so the landing page carries one recorded run.
This script produces it the way a learner's first, unchanged attempt at "Lose an app
server" is produced: the challenge's starter design, its fixed workload and seed, the
Model 1 engine, and the scheduled crash applied through the worker's own action path at
exactly its second. Every completed tick is kept. scripts/tests/landingSample.test.ts
fails if the committed file no longer matches what this produces.

  bun --no-env-file scripts/landing-sample.ts --write */
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInitialState, tick } from "@infraforge/simulation/engine";
import { SIMULATION_MODEL_VERSION } from "@infraforge/simulation/tuning";
import { findChallenge, challengeSeed } from "../apps/backend/challenges/registry";
import { captureRunInputs, engineSeed } from "../apps/backend/deployments/runInputs";
import { applyAction } from "../apps/backend/simulator/actionApplication";
import type { SimulationInstance } from "../apps/backend/simulator/instance";

export const samplePath = fileURLToPath(new URL("../apps/web/src/features/landing/sampleRun.json", import.meta.url));
const HEALTH = ["healthy", "degraded", "saturated", "failed"] as const;
const SYSTEM = ["healthy", "degraded", "saturated", "critical"] as const;

export function generateLandingSample() {
  const definition = findChallenge("lose-an-app-server", 1)?.definition;
  if (!definition?.starter || !definition.experiment) throw new Error("The landing challenge or its experiment is missing");
  const seed = challengeSeed(definition);
  const input = captureRunInputs(definition.starter, definition.workload, seed);
  const instance: SimulationInstance = {
    state: createInitialState("landing-sample", input.resources, input.connectionLines, input.workloadProfile, engineSeed(seed)),
    tickCount: 0, pendingLogs: [], speed: 1, lastCheckpointAt: 0, accumulatedCostUsd: 0,
    topology: { resources: input.resources, connectionLines: input.connectionLines }, topologyRevision: 0,
    actions: new Map(), acknowledge: null, metricsComputedAt: null, metricsTopologyRevision: 0,
  };
  const { fault, atSimulatedSecond, target } = definition.experiment;
  const ids = input.resources.map((r) => r.id);
  const points: Array<{ t: number; system: number; resources: Array<[number, number]> }> = [];
  let faultDuration = 0;
  while (instance.state!.simulatedSeconds < definition.evaluationSeconds) {
    // The worker stops at the experiment second and applies the fault before the next tick.
    if (instance.state!.simulatedSeconds === atSimulatedSecond) {
      const applied = applyAction(instance, "landing-experiment", { kind: "chaos", parameters: { type: fault, resourceId: target.resourceId, trigger: "challenge-experiment" } });
      faultDuration = Number(applied.outcome.durationSimulatedSeconds ?? 0);
    }
    instance.state = tick(instance.state!, {}).state;
    const s = instance.state!;
    // Model 1 records every CPU value; this sample is re-recorded on Model 2 before launch.
    points.push({ t: s.simulatedSeconds, system: SYSTEM.indexOf(s.overallHealth as typeof SYSTEM[number]),
      resources: ids.map((id) => [HEALTH.indexOf(s.metrics[id]!.health as typeof HEALTH[number]), Math.round(s.metrics[id]!.cpu! * 10) / 10]) });
  }
  return {
    schema: "infraforge-landing-sample/1", model: SIMULATION_MODEL_VERSION,
    challenge: { id: definition.id, version: definition.version, title: definition.title }, seed,
    workload: definition.workloadNote,
    stations: input.resources.map((r) => ({ id: r.id, type: r.type, label: r.name ?? r.id })),
    connections: input.connectionLines.map((c) => [c.sourceId, c.targetId]),
    fault: { type: fault, target: target.resourceId, at: atSimulatedSecond, duration: faultDuration },
    evaluation: definition.evaluationSeconds,
    // Each point is one completed tick: [health index, CPU percent] per station, in station order.
    points,
  };
}

if (import.meta.main) {
  const sample = JSON.stringify(generateLandingSample()) + "\n";
  if (process.argv.includes("--write")) writeFileSync(samplePath, sample);
  else if (readFileSync(samplePath, "utf8") !== sample) { console.error("Landing sample is stale; run with --write"); process.exitCode = 1; }
  else console.log("Landing sample matches the engine");
}
