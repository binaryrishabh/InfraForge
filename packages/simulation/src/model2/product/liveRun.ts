import { findSku } from "@infraforge/catalog";
import { GENERIC_MONTHLY_USD } from "../../cost";
import { SIMULATION_CONSTANTS } from "../../tuning";
import { createActionableLiveModel2, type LiveProjection } from "./live";
import { buildModel2Contract, type ContractBuilder } from "./runContract";
export type { ContractBuilder };
import type { ProductContract, SavedProductDesign } from "./contracts";
import { RESOURCE_TYPES, ResourceHealth, type ChaosType, type ResourceHealthType } from "@infraforge/domain/resource";
import type { ResolvedWorkloadProfile } from "@infraforge/domain/workload";
import type { ActionOutcome, ActionRequest } from "@infraforge/contracts/actions";
import type { RunTopology } from "@infraforge/contracts/run-inputs";
import type { LiveView, PoolSnapshot, ResourceMetrics, SimulationLog } from "@infraforge/contracts/telemetry";

/* One Model 2 run, shared by the browser (live) and the server (official re-run): the run's design compiled to a
Model 2 contract, advanced one simulated second at a time and read back in the shapes the live view, evidence and
reports already use. Values Model 2 does not model stay null ("unknown"); nothing is shown as a fake zero. */

export type { LiveView };
export class ActionRefused extends Error {}

// How long each fault lasts, in simulated seconds. One source for manual faults and challenge experiments.
export const FAULT_DURATIONS: Record<ChaosType, number> = {
  crash: SIMULATION_CONSTANTS.CHAOS.CRASH_DURATION, "cpu-spike": SIMULATION_CONSTANTS.CHAOS.CPU_SPIKE_DURATION,
  "memory-leak": SIMULATION_CONSTANTS.CHAOS.MEMORY_LEAK_DURATION, "network-delay": SIMULATION_CONSTANTS.CHAOS.NETWORK_DELAY_DURATION,
  "disk-failure": SIMULATION_CONSTANTS.CHAOS.DISK_FAILURE_DURATION,
};

// Assumptions for live faults, shown with the action's outcome.
const CRASH_RESTART_US = 1_000_000; // process start and readiness after the crash ends
const CPU_SPIKE_SHARE = 0.45; // a competing process holds 45% of the target's cores for the whole fault
const NETWORK_DELAY_US = 200_000; // added delay on every link into the target
const HOURS_PER_MONTH = 730;
// The server replays each action by rebuilding the run up to its second, so a run takes at most this many actions.
export const MAX_RUN_ACTIONS = 20;
const SECOND = 1_000_000;

export function createModel2Run(input: RunTopology & { workloadProfile: ResolvedWorkloadProfile; seed: string }, horizonSeconds: number, build: ContractBuilder = buildModel2Contract) {
  const design: SavedProductDesign = { schema: "infraforge-saved-design/1", resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile };
  const built = build(design, horizonSeconds, input.seed);
  if ("refused" in built) throw new ActionRefused(`Model 2 cannot run this design yet: ${built.refused.join(" ")}`);
  // Live runs generate arrivals as they advance, so long runs and rebuilds after actions stay small and fast.
  const contract: ProductContract = { ...built.contract, arrival: { ...built.contract.arrival, generated: true } }, nodeIds = input.resources.map((r) => r.id);
  const run = createActionableLiveModel2(design, contract, nodeIds);
  const types = new Map(input.resources.map((r) => [r.id, r.type]));
  const pools = poolLayout(input, contract);
  let target = 1;
  let chaos: Array<{ type: ChaosType; resourceId: string; endsAt: number; duration: number }> = [];
  let last: LiveProjection | null = null;

  const view = (): LiveView => ({
    simulatedSeconds: run.simulatedSeconds, loadFraction: target, targetLoadFraction: target,
    metrics: Object.fromEntries(nodeIds.map((id) => [id, metric(last?.metrics[id])])),
    overallHealth: last?.overallHealth ?? "healthy",
    pools: Object.fromEntries(pools.map((p) => [p.lbId, poolSnapshot(p, last)])),
    activeChaos: chaos.map((c) => ({ chaosType: c.type, resourceId: c.resourceId, durationTicks: c.duration, remainingTicks: Math.max(0, c.endsAt - run.simulatedSeconds) })),
    traffic: last ? { offeredRps: last.offeredRps, completedRps: last.completedRps, failedRps: last.failedRps, latencyMs: last.latencyMs }
      : { offeredRps: 0, completedRps: 0, failedRps: 0, latencyMs: { p50: null, p95: null } },
  });

  return {
    get simulatedSeconds() { return run.simulatedSeconds; },
    get horizonSeconds() { return run.horizon / SECOND; },
    view,
    // After an action the run is rebuilt and catches up to the shown second, here within a wall-time budget.
    // Returns true once it can advance again. The shown second does not move while catching up.
    get catchingUp() { return run.catchingUp; },
    catchUp(budgetMs: number) {
      const started = Date.now();
      while (run.catchingUp && Date.now() - started < budgetMs) run.catchUp(1);
      return !run.catchingUp;
    },
    // One simulated second (finishing any catch-up first). Returns what changed, as log lines.
    advance(): SimulationLog[] {
      while (run.catchingUp) run.catchUp(10);
      run.advanceSecond();
      const previous = last;
      last = run.project();
      chaos = chaos.filter((c) => c.endsAt > run.simulatedSeconds);
      return transitions(previous, last, types);
    },
    burnRatePerHourUsd() {
      let monthly = 0;
      for (const r of input.resources) {
        const price = (r.skuId ? findSku(r.skuId)?.monthlyPriceUsd : undefined) ?? GENERIC_MONTHLY_USD[r.type] ?? 10;
        monthly += price * Math.max(1, last?.metrics[r.id]?.replicas?.total ?? 1);
      }
      return monthly / HOURS_PER_MONTH;
    },
    // Applies a live action from the second just shown. Refusals say plainly what Model 2 cannot do yet.
    apply(request: ActionRequest): { outcome: ActionOutcome; endSecond?: number } {
      // Ids follow accepted actions only, so the browser and the server number the same timeline the same way.
      const now = run.simulatedSeconds, actionId = `a${run.actions.length + 1}`;
      if (request.kind !== "speed" && request.kind !== "teardown" && run.actions.length >= MAX_RUN_ACTIONS) throw new ActionRefused(`A run takes at most ${MAX_RUN_ACTIONS} actions. Stop and start a new run to keep experimenting.`);
      const attempt = (action: Parameters<typeof run.apply>[0]) => {
        try { run.apply(action); } catch (error) { throw new ActionRefused(`Model 2 cannot apply this here: ${(error as Error).message}`); }
      };
      switch (request.kind) {
        case "load": {
          const previous = target;
          attempt({ id: actionId, kind: "load", fraction: request.parameters.targetLoadFraction });
          target = request.parameters.targetLoadFraction;
          return { outcome: { previousTarget: previous, appliedTarget: target } };
        }
        case "chaos": {
          const { type, resourceId } = request.parameters, duration = FAULT_DURATIONS[type];
          if (!types.has(resourceId)) throw new ActionRefused("Chaos target is not part of this run.");
          if (type === "memory-leak" || type === "disk-failure") throw new ActionRefused(`Model 2 does not model ${type === "memory-leak" ? "memory leaks" : "disk failures"} yet.`);
          const baseline = request.parameters.trigger === "challenge-experiment" ? { baselineOverallHealth: last?.overallHealth ?? "healthy" } : {};
          if (type === "crash") attempt({ id: actionId, kind: "crash", node: resourceId, durationUs: duration * SECOND, restartUs: CRASH_RESTART_US });
          else if (type === "cpu-spike") {
            const cores = coresOf(contract, resourceId);
            if (!cores) throw new ActionRefused("A CPU spike needs a resource whose CPU Model 2 models.");
            attempt({ id: actionId, kind: "cpu-spike", node: resourceId, durationUs: duration * SECOND, coreUs: Math.round(CPU_SPIKE_SHARE * cores * duration * SECOND), cores: CPU_SPIKE_SHARE * cores });
          } else {
            const links = linksInto(contract, resourceId);
            if (!links.length) throw new ActionRefused("No network link leads into this resource.");
            attempt({ id: actionId, kind: "network-delay", links, durationUs: duration * SECOND, delayUs: NETWORK_DELAY_US });
          }
          chaos.push({ type, resourceId, endsAt: now + duration, duration });
          return { outcome: { durationSimulatedSeconds: duration, ...baseline }, endSecond: now + duration };
        }
        case "pool-scale": {
          const { lbId, delta } = request.parameters, pool = pools.find((p) => p.lbId === lbId);
          if (!pool?.scaled) throw new ActionRefused("This load balancer has no adjustable replica pool.");
          const current = (last?.metrics[pool.scaled]?.replicas?.total ?? pool.min - pool.fixed) + pool.fixed, desired = current + delta;
          if (desired < pool.min || desired > pool.max) throw new ActionRefused(`The pool stays between ${pool.min} and ${pool.max} replicas.`);
          attempt({ id: actionId, kind: "replicas", node: pool.scaled, desired: desired - pool.fixed });
          return { outcome: { delta, previousReplicaCount: current } };
        }
        case "vertical-scale": throw new ActionRefused("Resizing during a Model 2 run is not available yet. Stop, change the size and start a new run.");
        case "topology": throw new ActionRefused("Changing the design during a Model 2 run is not available yet. Stop and start a new run with the new design.");
        case "speed": case "teardown": throw new ActionRefused(`The ${request.kind} action is handled by the run, not the engine.`);
      }
    },
    // A replica change is finished once the pool holds the requested count, all ready.
    poolSettled(lbId: string, previous: number, delta: number) {
      const pool = pools.find((p) => p.lbId === lbId), r = pool?.scaled ? last?.metrics[pool.scaled]?.replicas : undefined;
      return !!r && r.total + pool!.fixed === previous + delta && r.ready === r.total ? r.total + pool!.fixed : null;
    },
    get actions() { return run.actions; },
  };
}
export type Model2Run = ReturnType<typeof createModel2Run>;

function metric(m: LiveProjection["metrics"][string] | undefined): ResourceMetrics {
  if (!m) return { cpu: null, memory: null, health: ResourceHealth.UNKNOWN };
  return { ...(m.asyncQueue ? { asyncQueue: m.asyncQueue } : {}), cpu: m.cpu === null ? null : round(m.cpu), memory: m.memory === null ? null : round(m.memory), health: m.health as ResourceHealthType,
    ...(m.rps === null ? {} : { rps: m.rps }), ...(m.connections === null ? {} : { connections: m.connections }), ...(m.replicas ? { replicas: m.replicas } : {}) };
}
const round = (value: number) => Math.round(value * 10) / 10;

/* Load balancer pools as people drew them: the app servers behind each balancer, and the one Model 2 scales.
Model 2 scales the first app server and keeps its drawn siblings fixed, so every count here is the balancer's total. */
function poolLayout(input: RunTopology, contract: ProductContract) {
  const behind = (lb: string) => input.connectionLines.filter((c) => c.sourceId === lb && input.resources.find((r) => r.id === c.targetId)?.type === RESOURCE_TYPES.VirtualMachine).map((c) => c.targetId);
  return input.resources.filter((r) => r.type === RESOURCE_TYPES.LoadBalancer).map((lb) => {
    const scaled = Object.entries(contract.nodes).find(([, n]) => n.controller && n.controller.loadBalancer.replace(/^\$/, "").split("/")[0] === lb.id)?.[0];
    const controller = scaled ? contract.nodes[scaled]!.controller! : undefined;
    const count = (q: { kind: string; value?: number } | undefined, fallback: number) => q?.kind === "known" && typeof q.value === "number" ? q.value : fallback;
    const vms = behind(lb.id), fixed = scaled ? vms.length - 1 : vms.length;
    return { lbId: lb.id, vms, scaled, fixed, min: count(controller?.min, 0) + fixed, max: count(controller?.max, 0) + fixed,
      targetCpu: Math.round(count(controller?.target, 0) * 100), startSeconds: Math.ceil((count(controller?.provision, 0) + count(controller?.startup, 0)) / SECOND),
      drainSeconds: Math.ceil(count(controller?.drain, 0) / SECOND) };
  });
}
function poolSnapshot(p: ReturnType<typeof poolLayout>[number], last: LiveProjection | null): PoolSnapshot {
  const replicas = p.vms.reduce((n, id) => n + (last?.metrics[id]?.replicas?.total ?? 1), 0);
  const scaled = p.scaled ? last?.metrics[p.scaled]?.replicas : undefined;
  // Pending is the authored start or drain time, an upper bound: Model 2 does not predict the exact remaining time.
  const pending = scaled && scaled.ready < scaled.total ? { action: "up" as const, secondsRemaining: p.startSeconds } : null;
  return { lbId: p.lbId, baseVmIds: p.vms, currentReplicas: replicas, minReplicas: p.min, maxReplicas: p.max, targetCpu: p.targetCpu, pending };
}
function coresOf(contract: ProductContract, node: string) {
  const n = contract.nodes[node], primary = n?.resources.find((r) => r.role === n.primary.replace(/^\$self\/?/, "") || r.role === "main");
  const config = primary?.config as { kind?: string; cores?: { kind: string; value?: number } } | undefined;
  return config?.kind === "compute" && config.cores?.kind === "known" ? config.cores.value ?? null : null;
}
function linksInto(contract: ProductContract, node: string) {
  return Object.values(contract.transports).flatMap((t) => t.links).filter((l) => l.to === `$${node}` || l.to.startsWith(`$${node}/`)).map((l) => l.id);
}
// What changed in one second, in plain words.
function transitions(before: LiveProjection | null, after: LiveProjection, types: Map<string, string>): SimulationLog[] {
  const logs: SimulationLog[] = [], timestamp = new Date().toISOString();
  for (const [id, m] of Object.entries(after.metrics)) {
    const was = before?.metrics[id];
    if (m.health !== (was?.health ?? "unknown") && !(m.health === "healthy" && !was)) logs.push({ timestamp, source: "model-2", resourceId: id,
      severity: m.health === "failed" ? "error" : m.health === "healthy" ? "info" : "warn", message: `${types.get(id) ?? "Resource"} ${id} is now ${m.health}.` });
    if (was?.replicas && m.replicas && was.replicas.total !== m.replicas.total) logs.push({ timestamp, source: "model-2", resourceId: id, severity: "info",
      message: `${id} now has ${m.replicas.total} replica${m.replicas.total === 1 ? "" : "s"} (${m.replicas.ready} ready).` });
  }
  if (before && before.overallHealth !== after.overallHealth) logs.push({ timestamp, source: "model-2", severity: after.overallHealth === "critical" ? "error" : after.overallHealth === "healthy" ? "info" : "warn",
    message: `System health is now ${after.overallHealth}: ${after.failedRps} of ${after.offeredRps} requests failed in the last second.` });
  return logs;
}
