// Offline calibration only. Never imported by the shipped API or browser.
import { createInitialState, tick } from "@infraforge/simulation/engine";
import { DeploymentChaosNames, type ChaosType } from "@infraforge/domain/resource";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import { engineSeed } from "../deployments/runInputs";
import { FAULT_DURATIONS } from "../simulator/faults";
import { definition } from "./challengeHarness";
import { tier } from "./challengeHarness";

export function observeCandidate(design: ChallengeStarter, options: { fault: ChaosType; target: string; rps: number;
  seed?: string; at?: number; afterwards?: number; }) {
  const at = options.at ?? 60, end = at + FAULT_DURATIONS[options.fault], evaluation = end + (options.afterwards ?? 30);
  let state = createInitialState("calibration", design.resources, design.connectionLines,
    { ...definition("cache-failure").workload, targetThroughput: options.rps * 3600 }, engineSeed(options.seed ?? "challenge:after-the-cache-returns:v1"));
  const samples = [];
  for (let second = 1; second <= evaluation; second++) {
    state = tick(state, {}).state;
    if (second >= at - 1) samples.push({ second, health: state.overallHealth, metrics: state.metrics,
      active: state.activeChaos.length, pending: Object.values(state.pools).map((p) => p.pending),
      replicas: state.spawnedVms.filter((v) => v.status === "active").length });
    if (second === at) state = { ...state, activeChaos: [{ resourceId: options.target, chaosType: options.fault,
      remainingTicks: FAULT_DURATIONS[options.fault], durationTicks: FAULT_DURATIONS[options.fault] }] };
  }
  return { end, evaluation, samples };
}

if (import.meta.main) {
  const counts = { runs: 0, baselineHealthy: 0, targetHealthySystemUnhealthy: 0, stillUnhealthy: 0, settled: 0 };
  const examples = [];
  for (const fault of Object.values(DeploymentChaosNames))
    for (const target of ["cache", "app-2", "db"])
      for (const rps of [180, 220, 250, 280, 310, 340])
        for (const dbSku of [undefined, "db.m5.large", "db.m5.xlarge"])
          for (const maxReplicas of [4, 6])
            for (const afterwards of [15, 30])
              for (const at of [60, 75]) {
                const original = definition("cache-failure").starter!;
                const design = { ...original, resources: original.resources.map((r) => r.id === "db" ? { ...r, skuId: dbSku } :
                  r.id === "lb" ? { ...r, autoscaling: { enabled: true, minReplicas: 4, maxReplicas, targetCpu: 60 } } : r) };
                const result = observeCandidate(design, { fault, target, rps, at, afterwards });
                counts.runs++;
                if (result.samples.find((p) => p.second === at)!.health !== "healthy") continue;
                counts.baselineHealthy++;
                const post = result.samples.filter((p) => p.second > result.end), final = post.at(-1)!;
                const split = post.some((p) => p.metrics[target]?.health === "healthy" && p.health !== "healthy");
                if (split) counts.targetHealthySystemUnhealthy++;
                if (final.health !== "healthy") counts.stillUnhealthy++; else counts.settled++;
                if (split && final.health !== "healthy" && fault === "crash" && target === "cache") examples.push({ fault, target, rps, dbSku, maxReplicas, at, afterwards,
                  firstTarget: post.find((p) => p.metrics[target]?.health === "healthy")?.second,
                  firstSystem: post.find((p) => p.health === "healthy")?.second ?? null, final: final.health });
              }
  console.info(JSON.stringify({ counts, examples: examples.slice(0, 12) }, null, 2));
  const laterPressure = [];
  let extraRuns = 0;
  for (const n of [3, 4, 5]) for (const rps of [260, 300, 340, 380, 420, 460])
    for (const targetCpu of [40, 50, 60, 75]) for (const fault of Object.values(DeploymentChaosNames))
      for (const afterwards of [30, 45, 60]) {
        const original = tier(n, { cache: true });
        const design = { ...original, resources: original.resources.map((r) => r.id === "lb" ?
          { ...r, autoscaling: { enabled: true, minReplicas: n, maxReplicas: 8, targetCpu } } : r) };
        const result = observeCandidate(design, { fault, target: "cache", rps, afterwards });
        extraRuns++;
        const baseline = result.samples.find((p) => p.second === 60)!, post = result.samples.filter((p) => p.second > result.end), final = post.at(-1)!;
        if (result.evaluation > 150 || baseline.health !== "healthy" || final.health === "healthy") continue;
        laterPressure.push({ n, rps, targetCpu, fault, afterwards, firstTarget: post.find((p) => p.metrics.cache?.health === "healthy")?.second ?? null,
          firstSystem: post.find((p) => p.health === "healthy")?.second ?? null, final: final.health, db: final.metrics.db, replicas: final.replicas });
      }
  console.info(JSON.stringify({ extraRuns, laterPressure: laterPressure.slice(0, 25), count: laterPressure.length }, null, 2));
}
