import type { Resource } from "@infraforge/domain/resource";
import { autoscalingSignalError } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { ControllerProfile, ProductContract } from "./contracts";
import type { SystemsInput } from "../systems/contracts";

export const AUTOSCALING_OBSERVED_PROFILE = "autoscaling-observed/1" as const;
/** True for the enabled pool policy that chose delivered monitoring samples (a load balancer's copy is disabled and ignored). */
export const changedAutoscalingSignal = (r: Resource) => r.autoscaling?.enabled === true && r.autoscaling.signal !== undefined;
export const autoscalingSignalChanges = (resources: readonly Resource[]) => resources.some(changedAutoscalingSignal);

/** Refuses a saved selection whose agent is missing or does not observe the pool, instead of falling back to direct truth. */
export function autoscalingSignalDesignError(r: Resource, resources: readonly Resource[], connections: readonly { sourceId: string; targetId: string }[]): string | undefined {
  const shape = autoscalingSignalError(r.autoscaling);
  if (shape) return shape;
  const signal = r.autoscaling?.signal;
  if (!signal) return;
  if (r.type !== "Virtual Machine") return "A scaling signal belongs to an app server pool.";
  const monitor = resources.find(x => x.id === signal.monitorId);
  if (monitor?.type !== "Monitoring Agent") return "The scaling signal must name a Monitoring Agent on the canvas.";
  if (!connections.some(e => e.sourceId === monitor.id && e.targetId === r.id)) return "The named Monitoring Agent must be connected to the autoscaled app server so every replica is observed.";
}

export function observedControllerSignal(r: Resource, q: (id: string, value: number, unit: "us", sentence?: string, authored?: boolean) => Quantity<"us">): ControllerProfile["signal"] {
  const s = r.autoscaling!.signal!;
  return { kind: "observed-core-time", backend: `$${s.monitorId}/backend`, freshFor: q(`${r.id}.controller.signalFresh`, s.freshForSeconds * 1000000, "us", "Saved freshness bound for delivered monitoring samples; stale or missing samples hold the pool.", true), stale: "hold" };
}

export function validateAutoscalingSignalProfile(resources: readonly Resource[], contract: ProductContract) {
  const profiles = contract.version.match(/\/autoscaling-observed\/[^/]+/g) ?? [];
  if (profiles.some(p => p !== `/${AUTOSCALING_OBSERVED_PROFILE}`) || profiles.length !== Number(autoscalingSignalChanges(resources))) throw Error("A saved scaling signal requires its explicit autoscaling-observed/1 contract version and matching saved intent");
}

/** Binds saved intent to the reviewed controller signal and to real monitor coverage of every replica; no fallback to direct truth. */
export function validateAutoscalingSignalBindings(resources: readonly Resource[], contract: ProductContract, pools: readonly { id: string; replicas: readonly string[] }[], input: SystemsInput) {
  for (const r of resources.filter(x => x.autoscaling?.enabled && contract.nodes[x.id]?.controller)) {
    const signal = contract.nodes[r.id]!.controller!.signal, saved = r.autoscaling!.signal;
    // Unmarked historical contracts keep their reviewed signal; only a saved selection is enforced here.
    if (!saved) continue;
    if (signal.kind !== "observed-core-time" || signal.backend !== `$${saved.monitorId}/backend` || signal.stale !== "hold" || requireKnown(signal.freshFor, "us") !== saved.freshForSeconds * 1000000) throw Error("Controller signal must match the saved observed scaling signal");
    const monitor = input.resources.find(c => c.id === saved.monitorId), pool = pools.find(p => p.id === r.id);
    if (monitor?.kind !== "monitor" || !pool || pool.replicas.some(id => !monitor.targets.includes(id))) throw Error("The scaling signal's Monitoring Agent must target every replica of the pool");
  }
}
