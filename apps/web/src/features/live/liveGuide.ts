import type { ChaosEffect, ResourceMetrics } from "@infraforge/contracts/telemetry";
import type { Resource } from "@infraforge/domain/resource";

/* What a learner should look at next, taken only from what the run has measured so far. It names no outcome the
simulator has not produced: consequences come from each resource's measured health, never from a script. */
export type LiveGuide =
  | { stage: "break"; title: string; body: string; target: { id: string; label: string } | null }
  | { stage: "watch"; title: string; body: string }
  | { stage: "understand"; title: string; body: string };

interface Inputs {
  resources: Pick<Resource, "id" | "type">[];
  metrics: Record<string, Pick<ResourceMetrics, "health">>;
  activeChaos: Pick<ChaosEffect, "chaosType" | "resourceId" | "remainingTicks">[];
  // A fault was applied earlier in this run and has since ended.
  faultSeen: boolean;
  simulatedSeconds: number;
}

const list = (ids: string[]) => ids.length <= 2 ? ids.join(" and ") : `${ids.slice(0, 2).join(", ")} and ${ids.length - 2} more`;

/** The server to crash for the first experiment: when there are several, one that leaves a sibling to take over. */
export function crashTarget(resources: Inputs["resources"]) {
  const servers = resources.filter(r => r.type === "Virtual Machine").map(r => r.id).sort();
  const id = servers.length > 1 ? servers[servers.length - 1]! : servers[0];
  return id ? { id, label: servers.length > 1 ? `Crash ${id} for 30 s` : `Crash ${id}` } : null;
}

export function liveGuide({ resources, metrics, activeChaos, faultSeen, simulatedSeconds }: Inputs): LiveGuide | null {
  if (simulatedSeconds < 3) return null;
  const measured = Object.entries(metrics);
  const failed = measured.filter(([, m]) => m.health === "failed").map(([id]) => id);
  const strained = measured.filter(([, m]) => m.health === "saturated" || m.health === "degraded").map(([id]) => id);
  if (activeChaos.length) {
    const fault = activeChaos[0]!;
    const effects = [failed.length && `${list(failed)} ${failed.length === 1 ? "has" : "have"} failed`, strained.length && `${list(strained)} ${strained.length === 1 ? "is" : "are"} under strain`].filter(Boolean);
    return { stage: "watch", title: `${fault.chaosType ? `${fault.chaosType[0]!.toUpperCase()}${fault.chaosType.slice(1)}` : "Fault"} on ${fault.resourceId} · ${fault.remainingTicks} s left`,
      body: effects.length ? `So far: ${effects.join("; ")}. Open a resource to see its measurements.` : "Nothing else has changed yet. Watch the other resources; effects can take a few seconds to show." };
  }
  if (faultSeen) {
    const unrecovered = [...failed, ...strained];
    return { stage: "understand", title: unrecovered.length ? "The fault is over; recovery is still under way" : "The fault is over and the system has recovered",
      body: `${unrecovered.length ? `${list(unrecovered)} ${unrecovered.length === 1 ? "has" : "have"} not recovered yet; a restart takes time after the fault ends. ` : "Every resource is healthy again. "}Stop the run to open its report. There, “Change traffic and run again” repeats this design with one traffic setting changed so you can compare. It does not repeat your fault.` };
  }
  return { stage: "break", title: "Everything is running. Now break something.",
    body: "Inject a fault and watch where the traffic goes. This is what the design does when a part fails, measured by the simulator.", target: crashTarget(resources) };
}
