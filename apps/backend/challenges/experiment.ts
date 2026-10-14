import { z } from "zod";
import { computeTopology } from "@infraforge/domain/topology";
import { DeploymentChaosNames, RESOURCE_TYPES, type ChaosType } from "@infraforge/domain/resource";
import type { RunAction } from "@infraforge/contracts/actions";
import type { ChallengeDefinition, ChallengeExperiment, RecordedExperiment } from "@infraforge/contracts/challenges";
import { FAULT_DURATIONS } from "../simulator/faults";
import type { Topology } from "./criteria";

export const FAULT_LABEL: Record<ChaosType, string> = {
  crash: "Crash", "cpu-spike": "CPU spike", "memory-leak": "Memory leak", "network-delay": "Network delay", "disk-failure": "Disk failure",
};
export const EXPERIMENT_TRIGGER = "challenge-experiment";

// The plan an attempt records when it is created; duration is the model's, never authored.
export function recordedExperiment(definition: ChallengeDefinition): RecordedExperiment | null {
  const e = definition.experiment;
  if (!e) return null;
  return { version: 1, fault: e.fault, atSimulatedSecond: e.atSimulatedSecond, durationSimulatedSeconds: FAULT_DURATIONS[e.fault],
    targetResourceId: e.target.resourceId, targetType: e.target.type };
}

const recordedSchema = z.object({
  version: z.literal(1), fault: z.enum(DeploymentChaosNames),
  atSimulatedSecond: z.number().int().min(1).max(3600), durationSimulatedSeconds: z.number().int().min(1).max(3600),
  targetResourceId: z.string().min(1).max(256), targetType: z.enum(Object.values(RESOURCE_TYPES) as [string, ...string[]]),
}).strict();
export function readRecordedExperiment(value: unknown): RecordedExperiment | null {
  const parsed = recordedSchema.safeParse(value);
  return parsed.success ? parsed.data as RecordedExperiment : null;
}

/* Preconditions checked on the attempt's captured design, the same way in preflight
and when the attempt is created. The target is a named resource kept from the
starter; when it is missing nothing else is substituted. */
export function experimentReadiness(experiment: ChallengeExperiment, topology: Topology): { ready: boolean; detail: string } {
  const { resourceId, type } = experiment.target;
  const target = topology.resources.find((r) => r.id === resourceId);
  if (!target) return { ready: false, detail: `The experiment targets ${resourceId} (${type}), which is no longer in this design. Keep it, or start over from the starter.` };
  if (target.type !== type) return { ready: false, detail: `The experiment needs ${resourceId} to stay a ${type}.` };
  if (!computeTopology(topology.resources, topology.connectionLines).reachable.includes(resourceId)) {
    return { ready: false, detail: `${resourceId} must stay connected to traffic from an entry point, or the fault would not touch the running system.` };
  }
  if (type === RESOURCE_TYPES.VirtualMachine) {
    const pooled = topology.connectionLines.some((line) => {
      if (line.targetId !== resourceId) return false;
      const source = topology.resources.find((r) => r.id === line.sourceId);
      return source?.type === RESOURCE_TYPES.LoadBalancer && source.autoscaling?.enabled !== false;
    });
    if (!pooled) return { ready: false, detail: `${resourceId} must stay behind a load balancer that manages its app servers as a pool (autoscaling on). In this model only a pool sends requests away from a crashed server.` };
  }
  return { ready: true, detail: `${FAULT_LABEL[experiment.fault]} on ${resourceId} at second ${experiment.atSimulatedSecond}, active for ${FAULT_DURATIONS[experiment.fault]} simulated seconds.` };
}

export const isExperimentAction = (action: Pick<RunAction, "kind" | "parameters">) =>
  action.kind === "chaos" && (action.parameters as { trigger?: string }).trigger === EXPERIMENT_TRIGGER;
