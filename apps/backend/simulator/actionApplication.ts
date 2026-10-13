import { applyManualScale, buildPoolSnapshots, reconcileTopology } from "@infraforge/simulation/engine";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import { findSku } from "@infraforge/catalog";
import type { ActionOutcome, ActionRequest } from "@infraforge/contracts/actions";
import { ActionExecutionError, type SimulationInstance, type RunningAction } from "./instance";

export function applyAction(instance: SimulationInstance, id: string, request: ActionRequest): { status: "running" | "completed"; outcome: ActionOutcome } {
  const state = instance.state;
  let outcome: ActionOutcome = {};
  let running: RunningAction | undefined;
  switch (request.kind) {
    case "load":
      outcome = { previousTarget: state.targetLoadFraction, appliedTarget: request.parameters.targetLoadFraction };
      state.targetLoadFraction = request.parameters.targetLoadFraction;
      instance.pendingLogs.push({ timestamp: new Date().toISOString(), source: "load-tester", severity: state.targetLoadFraction > 1 ? "warn" : "info",
        message: `Load target applied at ${Math.round(state.targetLoadFraction * 100)}% of declared workload.` });
      break;
    case "speed":
      outcome = { previousSpeed: instance.speed, appliedSpeed: request.parameters.speed };
      instance.speed = request.parameters.speed;
      break;
    case "chaos": {
      const { type, resourceId } = request.parameters;
      if (!Object.hasOwn(state.resourceTypes, resourceId)) throw new ActionExecutionError("Chaos target was removed before application.");
      const durations = { crash: SIMULATION_CONSTANTS.CHAOS.CRASH_DURATION, "cpu-spike": SIMULATION_CONSTANTS.CHAOS.CPU_SPIKE_DURATION,
        "memory-leak": SIMULATION_CONSTANTS.CHAOS.MEMORY_LEAK_DURATION, "network-delay": SIMULATION_CONSTANTS.CHAOS.NETWORK_DELAY_DURATION,
        "disk-failure": SIMULATION_CONSTANTS.CHAOS.DISK_FAILURE_DURATION };
      const duration = durations[type];
      state.activeChaos.push({ chaosType: type, resourceId, durationTicks: duration, remainingTicks: duration });
      outcome = { durationSimulatedSeconds: duration };
      running = { id, request, outcome, endSecond: state.simulatedSeconds + duration };
      break;
    }
    case "vertical-scale": {
      const { resourceId, skuId } = request.parameters;
      const sku = findSku(skuId), current = state.resourceSkus[resourceId];
      if (!sku || sku.category !== state.resourceTypes[resourceId] || (current && current.provider !== sku.provider)) {
        throw new ActionExecutionError("Vertical-scale target or compatible SKU is no longer available.");
      }
      if (state.verticalScaling.some((v) => v.resourceId === resourceId)) throw new ActionExecutionError("This resource is already restarting.");
      const duration = SIMULATION_CONSTANTS.VERTICAL_SCALING.RESTART_TICKS;
      state.verticalScaling.push({ resourceId, toSkuId: skuId, downtimeTicks: duration, remainingTicks: duration });
      outcome = { fromSkuId: current?.skuId ?? null, requestedSkuId: skuId };
      running = { id, request, outcome };
      break;
    }
    case "pool-scale": {
      const { lbId, delta } = request.parameters;
      const pool = state.pools[lbId];
      if (!Object.hasOwn(state.pools, lbId)) throw new ActionExecutionError("The pool was removed before application.");
      const previousReplicaCount = buildPoolSnapshots(state).pools[lbId]!.currentReplicas;
      const oldIds = new Set(state.spawnedVms.map((v) => v.id));
      const victim = state.spawnedVms.filter((v) => v.poolId === lbId && v.status === "active").at(-1);
      const result = applyManualScale(state, lbId, delta);
      if (result.state === state) throw new ActionExecutionError("Pool scaling refused: replica limits or another scaling operation prevent it.");
      instance.state = result.state;
      const replicaId = delta === 1 ? result.state.spawnedVms.find((v) => v.poolId === lbId && !oldIds.has(v.id))!.id : victim!.id;
      outcome = { delta, previousReplicaCount, replicaId };
      running = { id, request, outcome, replicaId };
      instance.pendingLogs.push(result.log);
      break;
    }
    case "topology": {
      const { resources, connectionLines, acceptedRevision, expectedRevision } = request.parameters;
      if (!acceptedRevision || instance.topologyRevision !== expectedRevision) throw new ActionExecutionError("Topology application order does not match its accepted revision.");
      instance.state = reconcileTopology(state, resources, connectionLines);
      instance.topology = { resources, connectionLines };
      instance.topologyRevision = acceptedRevision;
      outcome = { acceptedRevision, appliedRevision: acceptedRevision };
      break;
    }
    case "teardown": throw new ActionExecutionError("Teardown requires the terminal-snapshot transaction.");
  }
  if (running) instance.actions.set(id, running);
  return { status: running ? "running" : "completed", outcome };
}
